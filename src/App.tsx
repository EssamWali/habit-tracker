import { useEffect, useState } from 'react'
import { useSession } from './lib/useSession'
import { supabase } from './lib/supabase'
import { ensureUserScope } from './lib/db'
import { putHabit, putSchedule } from './lib/store'
import { useHabits, useOutboxDepth } from './lib/useLocalStore'
import SignIn from './SignIn'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function LocalStorePanel({ userId }: { userId: string }) {
  const habits = useHabits(userId)
  const pending = useOutboxDepth()

  // Temporary: V0-6 replaces this with the real create-habit flow. It exists
  // now so V0-4's acceptance is observable — a write with the network disabled
  // must appear in the UI immediately and queue for later push.
  async function addLocalHabit() {
    const id = crypto.randomUUID()
    const start = today()
    await putHabit({
      id, user_id: userId, name: `Habit ${habits.length + 1}`, colour: 'emerald',
      start_date: start, archived_at: null, sort_order: habits.length,
      updated_at: '', deleted_at: null,
    })
    await putSchedule({
      id: crypto.randomUUID(), habit_id: id, user_id: userId, effective_from: start,
      cadence_type: 'daily', weekdays: null, weekly_target: null, weight: 2,
      updated_at: '', deleted_at: null,
    })
  }

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
      <button className="btn btn--quiet" onClick={addLocalHabit}>Add a habit locally</button>
      <p className="muted note">
        Reads come from IndexedDB, writes queue in the outbox. Both work with the
        network off; nothing here touches Supabase yet.
      </p>
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
