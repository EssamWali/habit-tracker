import { useEffect, useState } from 'react'
import { useSession } from './lib/useSession'
import { supabase } from './lib/supabase'
import SignIn from './SignIn'

export default function App() {
  const auth = useSession()
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>Habit Tracker</h1>
          <p className="muted">v0 walking skeleton</p>
        </div>
        <span className={online ? 'pill pill--online' : 'pill pill--offline'}>
          {online ? 'online' : 'offline'}
        </span>
      </header>

      {auth.status === 'loading' && <p className="muted">Restoring session…</p>}

      {auth.status === 'signedOut' && <SignIn />}

      {auth.status === 'signedIn' && (
        <div className="card">
          <h2>Signed in</h2>
          <p className="muted">{auth.session.user.email}</p>
          {!online && (
            <p className="muted">
              Session restored from local storage with no network — V0-3 acceptance.
            </p>
          )}
          <button className="btn btn--quiet" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      )}
    </main>
  )
}
