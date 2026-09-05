import { useCallback, useEffect, useRef, useState } from 'react'
import { syncNow } from './sync'

export type SyncStatus =
  | { state: 'idle'; lastSync: string | null; pushed?: number; pulled?: number }
  | { state: 'syncing' }
  | { state: 'offline' }
  | { state: 'error'; message: string; retryInSeconds: number }

const BASE_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 5 * 60_000

/**
 * Drives sync in the background. Nothing in the UI awaits this: reads come from
 * the local mirror, so a failing or slow sync degrades to stale data rather
 * than a broken screen.
 *
 * Failures back off exponentially to five minutes. Reconnecting fires an
 * immediate attempt and resets the backoff, since the usual reason for a run of
 * failures is simply having been offline.
 */
export function useSync(userId: string | undefined) {
  const [status, setStatus] = useState<SyncStatus>({ state: 'idle', lastSync: null })
  const failures = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const running = useRef(false)

  const run = useCallback(async () => {
    if (!userId || running.current) return

    if (!navigator.onLine) {
      setStatus({ state: 'offline' })
      timer.current = setTimeout(run, BASE_INTERVAL_MS)
      return
    }

    running.current = true
    setStatus({ state: 'syncing' })
    let delay = BASE_INTERVAL_MS

    try {
      const { pushed, pulled } = await syncNow(userId)
      failures.current = 0
      setStatus({ state: 'idle', lastSync: new Date().toISOString(), pushed, pulled })
    } catch (err) {
      failures.current++
      delay = Math.min(BASE_INTERVAL_MS * 2 ** (failures.current - 1), MAX_BACKOFF_MS)
      setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
        retryInSeconds: Math.round(delay / 1000),
      })
    } finally {
      running.current = false
      timer.current = setTimeout(run, delay)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    run()

    const kick = () => {
      failures.current = 0
      clearTimeout(timer.current)
      run()
    }

    // Reconnecting almost always means the backoff is stale.
    window.addEventListener('online', kick)

    // Browsers throttle timers in backgrounded tabs, so the interval can
    // stretch to minutes while the app sits closed. Syncing the moment it
    // becomes visible is what makes picking up the phone feel instant.
    const onVisible = () => { if (document.visibilityState === 'visible') kick() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(timer.current)
    }
  }, [userId, run])

  return { status, syncNow: run }
}
