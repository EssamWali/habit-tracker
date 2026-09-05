import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { alive, habitRange } from './store'

/**
 * Live reads straight from IndexedDB. These re-render on local writes with no
 * network involvement, which is the whole point of V0-4: the UI is a view over
 * the mirror, and sync is something that happens to the mirror behind it.
 */
export function useHabits(userId: string | undefined) {
  return useLiveQuery(
    // Ordered by the [user_id+sort_order] index. Querying by user_id alone
    // would order by primary key, which is a random UUID.
    async () => (userId ? alive(await habitRange(userId).toArray()) : []),
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

/**
 * Which Habits are completed on a given Day, as a set of habit ids.
 * Tombstoned entries are filtered out, so an un-ticked Cell reads as absent.
 */
export function useCompletedOn(userId: string | undefined, day: string) {
  return useLiveQuery(
    async () => {
      if (!userId) return new Set<string>()
      const rows = await db.day_entries.where('day').equals(day).toArray()
      return new Set(alive(rows).filter(r => r.user_id === userId).map(r => r.habit_id))
    },
    [userId, day],
    new Set<string>(),
  )
}
