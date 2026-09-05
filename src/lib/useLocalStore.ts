import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { alive } from './store'

/**
 * Live reads straight from IndexedDB. These re-render on local writes with no
 * network involvement, which is the whole point of V0-4: the UI is a view over
 * the mirror, and sync is something that happens to the mirror behind it.
 */
export function useHabits(userId: string | undefined) {
  return useLiveQuery(
    async () => (userId ? alive(await db.habits.where('user_id').equals(userId).toArray()) : []),
    [userId],
    [],
  )
}

export function useDayEntries(userId: string | undefined) {
  return useLiveQuery(
    async () => (userId ? alive(await db.day_entries.where('user_id').equals(userId).toArray()) : []),
    [userId],
    [],
  )
}

export function useOutboxDepth() {
  return useLiveQuery(() => db.outbox.count(), [], 0)
}
