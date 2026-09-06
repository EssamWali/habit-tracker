import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from './lib/useSession'
import { supabase } from './lib/supabase'
import { ensureUserScope } from './lib/db'
import { useProfile } from './lib/useLocalStore'
import { dayStartOf, isPlaceholder, saveProfile } from './lib/profile'
import HabitList from './HabitList'
import SignIn from './SignIn'
import Settings from './Settings'
import ThemeToggle from './ThemeToggle'
import { readStoredTheme, useTheme, type ThemePreference } from './lib/theme'

export default function App() {
  const auth = useSession()
  const [online, setOnline] = useState(navigator.onLine)
  const [scoped, setScoped] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const userId = auth.status === 'signedIn' ? auth.session.user.id : null
  const profile = useProfile(userId ?? undefined)

  // The theme lives in one place now. It used to be a hook called separately by
  // App and HabitList, which gave each its own copy of the state: toggling in
  // the header re-stamped the document but left HabitList's habit colours
  // resolved against the old theme until something else re-rendered it.
  const persistTheme = useCallback((t: ThemePreference) => {
    if (userId) saveProfile(userId, { theme: t })
  }, [userId])
  const theme = useTheme(userId ? (profile?.theme ?? null) : null, persistTheme)

  // First launch on a device: seed the profile with whatever theme was chosen
  // before signing in. Without this the server's 'system' default arrives on
  // the first pull and silently undoes the user's choice — and choosing again
  // is the only way to get it onto their other devices anyway.
  const seeded = useRef(false)
  useEffect(() => {
    if (!userId || !profile || seeded.current) return
    seeded.current = true
    if (!isPlaceholder(profile)) return
    const local = readStoredTheme()
    if (local !== 'system') saveProfile(userId, { theme: local })
  }, [userId, profile])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // Drop the mirror if a different account signs in on this device.
  useEffect(() => {
    if (auth.status === 'loading') return
    ensureUserScope(userId).then(() => setScoped(true))
  }, [auth.status, userId])

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>Habit Tracker</h1>
          <p className="muted">v1 core loop</p>
        </div>
        <div className="header-right">
          <ThemeToggle preference={theme.preference} onChoose={theme.choose} />
          <span className={online ? 'pill pill--online' : 'pill pill--offline'}>
            {online ? 'online' : 'offline'}
          </span>
        </div>
      </header>

      {auth.status === 'loading' && <p className="muted">Restoring session…</p>}
      {auth.status === 'signedOut' && <SignIn />}

      {auth.status === 'signedIn' && (
        <>
          <div className="card">
            <h2>Signed in</h2>
            <p className="muted">{auth.session.user.email}</p>
            <div className="row-actions">
              <button
                className="btn btn--quiet"
                aria-expanded={showSettings}
                onClick={() => setShowSettings(v => !v)}
              >Settings</button>
              <button className="btn btn--quiet" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          </div>

          {showSettings && profile && (
            <Settings
              profile={profile}
              userId={auth.session.user.id}
              themePreference={theme.preference}
              onChooseTheme={theme.choose}
            />
          )}

          {scoped && (
            <HabitList
              userId={auth.session.user.id}
              dayStartMinutes={dayStartOf(profile)}
              resolvedTheme={theme.resolved}
            />
          )}
        </>
      )}
    </main>
  )
}
