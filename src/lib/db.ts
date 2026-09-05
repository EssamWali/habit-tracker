import Dexie, { type EntityTable } from 'dexie'
import type { DayEntry, Habit, HabitSchedule, OutboxItem, Profile } from './types'

/**
 * The local mirror. Every read in the app goes through here and never directly
 * to Supabase, which is what makes the UI work offline: the network is a
 * background sync concern (V0-5), not something a render waits on.
 */
class HabitDB extends Dexie {
  profiles!: EntityTable<Profile, 'id'>
  habits!: EntityTable<Habit, 'id'>
  habit_schedules!: EntityTable<HabitSchedule, 'id'>
  day_entries!: EntityTable<DayEntry, 'habit_id'>
  outbox!: EntityTable<OutboxItem, 'seq'>
  meta!: EntityTable<{ key: string; value: string }, 'key'>

  constructor() {
    super('habit-tracker')
    this.version(1).stores({
      profiles: 'id',
      habits: 'id, user_id, updated_at, [user_id+sort_order]',
      habit_schedules: 'id, habit_id, user_id, [habit_id+effective_from]',
      // Compound primary key mirrors the server's (habit_id, day). One key per
      // Cell is precisely what makes last-write-wins safe (ADR 0002).
      day_entries: '[habit_id+day], habit_id, day, user_id, [user_id+day]',
      outbox: '++seq, table, key, created_at',
      meta: 'key',
    })
  }
}

export const db = new HabitDB()

const LAST_USER = 'last_user_id'

/**
 * Guards against one account seeing another's cached rows on a shared device.
 * Called on every auth resolution: if the signed-in user differs from whoever
 * this database was last populated for, the mirror is dropped and rebuilt.
 *
 * Returns true when data was cleared, so callers can force a full resync.
 */
export async function ensureUserScope(userId: string | null): Promise<boolean> {
  const previous = (await db.meta.get(LAST_USER))?.value ?? null
  if (previous === userId) return false

  await db.transaction('rw', [db.profiles, db.habits, db.habit_schedules, db.day_entries, db.outbox, db.meta], async () => {
    await Promise.all([
      db.profiles.clear(),
      db.habits.clear(),
      db.habit_schedules.clear(),
      db.day_entries.clear(),
      db.outbox.clear(),
    ])
    await db.meta.clear()
    if (userId) await db.meta.put({ key: LAST_USER, value: userId })
  })
  return true
}

/**
 * Pull cursors are per table, not global. A single cursor advanced by whichever
 * table synced last would skip rows in the tables that lagged behind it.
 */
export async function getSyncCursor(table: string): Promise<string> {
  return (await db.meta.get(`cursor:${table}`))?.value ?? '1970-01-01T00:00:00Z'
}

export async function setSyncCursor(table: string, stamp: string): Promise<void> {
  await db.meta.put({ key: `cursor:${table}`, value: stamp })
}
