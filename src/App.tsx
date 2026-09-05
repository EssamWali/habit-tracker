import { useEffect, useState } from 'react'
import { useSession } from './lib/useSession'
import { supabase } from './lib/supabase'
import { ensureUserScope } from './lib/db'
import { createHabit } from './lib/store'
import { useHabits, useOutboxDepth } from './lib/useLocalStore'
import { useSync } from './lib/useSync'
import SignIn from './SignIn'

function syncLabel(status: ReturnType<typeof useSync>['status']): string {
  switch (status.state) {
    case 'syncing': return 'syncing…'
    case 'offline': return 'offline — queued'
    case 'error': return `failed, retrying in ${status.retryInSeconds}s`
    case 'idle': return status.lastSync
      ? `synced (pushed ${status.pushed ?? 0}, pulled ${status.pulled ?? 0})`
      : 'idle'
  }
}

function LocalStorePanel({ userId }: { userId: string }) {
  const habits = useHabits(userId)
  const pending = useOutboxDepth()
  const { status, syncNow } = useSync(userId)

  // Temporary: V0-6 replaces this with the real create-habit flow. It exists
  // now so V0-4's acceptance is observable — a write with the network disabled
  // must appear in the UI immediately and queue for later push.
  const addLocalHabit = () => createHabit(userId)

  return (
    <div className="card">
      <h2>Local store</h2>
      <dl className="stats">
        <div><dt>habits</dt><dd>{habits.length}</dd></div>
        <div><dt>queued to push</dt><dd>{pending}</dd></div>
      </dl>
      {habits.length > 0 && (
        <ul className="list">
          {habits.map(h => <li key={h.id}>{h.name}</li>)}
        </ul>
      )}
      <p className={status.state === 'error' ? 'error' : 'muted note'}>
        {syncLabel(status)}
        {status.state === 'error' && <><br />{status.message}</>}
      </p>
      <button className="btn btn--quiet" onClick={addLocalHabit}>Add a habit locally</button>
      <button className="btn btn--quiet" onClick={syncNow} disabled={status.state === 'syncing'}>
        Sync now
      </button>
    </div>
  )
}

export default function App() {
  const auth = useSession()
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
        <span className={online ? 'pill pill--online' : 'pill pill--offline'}>
          {online ? 'online' : 'offline'}
        </span>
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
          {scoped && <LocalStorePanel userId={auth.session.user.id} />}
        </>
      )}
    </main>
  )
}
