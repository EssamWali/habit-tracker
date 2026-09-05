import { useEffect, useState } from 'react'

/**
 * v0 shell. Deliberately bare: V0-1 only has to prove the PWA installs and
 * boots with no network. The connectivity readout exists so that acceptance
 * is observable on the phone rather than inferred from devtools.
 */
export default function App() {
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
      <h1>Habit Tracker</h1>
      <p className="muted">v0 walking skeleton</p>
      <p className={online ? 'status status--online' : 'status status--offline'}>
        {online ? 'online' : 'offline — shell served from cache'}
      </p>
    </main>
  )
}
