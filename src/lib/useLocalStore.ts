import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { Day, EntryKind, Profile } from './types'
import { alive, habitRange } from './store'
import { withDefaults } from './profile'

/**
 * Live reads straight from IndexedDB. These re-render on local writes with no
 * network involvement, which is the whole point of V0-4: the UI is a view over
 * the mirror, and sync is something that happens to the mirror behind it.
 */
export function useHabits(userId: string | undefined, includeArchived = false) {
  return useLiveQuery(
    // Ordered by the [user_id+sort_order] index. Querying by user_id alone
    // would order by primary key, which is a random UUID.
    async () => {
      if (!userId) return []
      const rows = alive(await habitRange(userId).toArray())
      return includeArchived ? rows : rows.filter(h => h.archived_at === null)
    },
    [userId, includeArchived],
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

/**
 * Every Completion the user has, grouped by habit. One pass over the mirror is
 * plenty at v0 scale — ten habits over five years is a few tens of thousands of
 * tiny rows, and it keeps the heatmap a pure function of local state.
 */
export function useCompletionsByHabit(userId: string | undefined) {
  return useLiveQuery(
    async () => {
      const map = new Map<string, Set<string>>()
      if (!userId) return map
      const rows = alive(await db.day_entries.where('user_id').equals(userId).toArray())
      for (const r of rows) {
        if (r.kind !== 'completed') continue
        let set = map.get(r.habit_id)
        if (!set) map.set(r.habit_id, (set = new Set()))
        set.add(r.day)
      }
      return map
    },
    [userId],
    new Map<string, Set<string>>(),
  )
}

/**
 * Notes, grouped by habit and keyed by day.
 *
 * Kept apart from useEntriesByHabit rather than folded into it: that map feeds
 * the derivation rules, which are typed over EntryKind and have no business
 * knowing about free text. Notes are presentation.
 */
export function useNotesByHabit(userId: string | undefined) {
  return useLiveQuery(
    async () => {
      const map = new Map<string, Map<Day, string>>()
      if (!userId) return map
      for (const r of alive(await db.day_entries.where('user_id').equals(userId).toArray())) {
        if (!r.note) continue
        let inner = map.get(r.habit_id)
        if (!inner) map.set(r.habit_id, (inner = new Map()))
        inner.set(r.day, r.note)
      }
      return map
    },
    [userId],
    new Map<string, Map<Day, string>>(),
  )
}

/** All live schedule rows for a user. Consumers resolve per day via R1. */
export function useSchedules(userId: string | undefined) {
  return useLiveQuery(
    async () => (userId ? alive(await db.habit_schedules.where('user_id').equals(userId).toArray()) : []),
    [userId],
    [],
  )
}

/** Every entry, grouped by habit and keyed by day — what R3 and R4 consume. */
export function useEntriesByHabit(userId: string | undefined) {
  return useLiveQuery(
    async () => {
      const map = new Map<string, Map<string, EntryKind>>()
      if (!userId) return map
      for (const r of alive(await db.day_entries.where('user_id').equals(userId).toArray())) {
        let inner = map.get(r.habit_id)
        if (!inner) map.set(r.habit_id, (inner = new Map()))
        inner.set(r.day, r.kind)
      }
      return map
    },
    [userId],
    new Map<string, Map<string, EntryKind>>(),
  )
}

/**
 * The user's settings, with defaults standing in until the row arrives.
 *
 * This never returns null, because everything downstream of it — Day Start
 * above all — is needed to render the first frame. Waiting for a pull would
 * mean the app has no idea what "today" is until the network answers, which is
 * precisely the dependency the local-first design exists to remove.
 */
export function useProfile(userId: string | undefined): Profile | null {
  return useLiveQuery(
    async () => (userId ? withDefaults(await db.profiles.get(userId), userId) : null),
    [userId],
    null,
  )
}
