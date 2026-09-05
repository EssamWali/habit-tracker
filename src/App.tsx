import { useEffect, useState } from 'react'
import { useSession } from './lib/useSession'
import { supabase } from './lib/supabase'
import { ensureUserScope } from './lib/db'
import HabitList from './HabitList'
import SignIn from './SignIn'
import ThemeToggle from './ThemeToggle'
import { useTheme } from './lib/theme'

export default function App() {
  const auth = useSession()
  const theme = useTheme()
  const [online, setOnline] = useState(navigator.onLine)
  const [scoped, setScoped] = useState(false)

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
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null
  useEffect(() => {
    if (auth.status === 'loading') return
    ensureUserScope(userId).then(() => setScoped(true))
  }, [auth.status, userId])

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>Habit Tracker</h1>
          <p className="muted">v0 walking skeleton</p>
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
            <button className="btn btn--quiet" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
          {scoped && <HabitList userId={auth.session.user.id} />}
        </>
      )}
    </main>
  )
}
