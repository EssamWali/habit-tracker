import { db } from './db'
import type { DayEntry, Habit, HabitSchedule, OutboxItem, SyncedTable } from './types'

export const nowStamp = () => new Date().toISOString()

/** Outbox key for a row: the server's primary key, flattened to a string. */
const keyOf = (table: SyncedTable, row: Habit | HabitSchedule | DayEntry): string =>
  table === 'day_entries'
    ? `${(row as DayEntry).habit_id}|${(row as DayEntry).day}`
    : (row as Habit | HabitSchedule).id

/**
 * The single write path. Applies the row to the local mirror and enqueues it
 * for push in one transaction, so the UI updates instantly and the network is
 * never on the critical path. A crash between the two is impossible: either
 * both land or neither does.
 *
 * Writes are always upserts. Deletion is a tombstone (deleted_at), never a row
 * removal, so a device that was offline learns the row died instead of
 * resurrecting it on its next push.
 */
async function write<T extends Habit | HabitSchedule | DayEntry>(table: SyncedTable, row: T): Promise<T> {
  const stamped = { ...row, updated_at: nowStamp() }
  const item: OutboxItem = { table, key: keyOf(table, stamped), payload: stamped, created_at: stamped.updated_at }

  await db.transaction('rw', [db[table], db.outbox], async () => {
    await (db[table] as any).put(stamped)
    await db.outbox.put(item)
  })
  return stamped
}

export const putHabit = (h: Habit) => write('habits', h)
export const putSchedule = (s: HabitSchedule) => write('habit_schedules', s)
export const putDayEntry = (e: DayEntry) => write('day_entries', e)

/** Tombstone a habit. Cascades are the server's job; the mirror follows on pull. */
export const removeHabit = (h: Habit) => write('habits', { ...h, deleted_at: nowStamp() })

/** Un-tick a day: a tombstone, not a delete. */
export const clearDayEntry = (e: DayEntry) => write('day_entries', { ...e, deleted_at: nowStamp() })

/** Rows the app should treat as present. Tombstones stay in the mirror so sync
 *  can reason about them, but must never reach the UI. */
export const alive = <T extends { deleted_at: string | null }>(rows: T[] | undefined): T[] =>
  (rows ?? []).filter(r => r.deleted_at === null)

export const outboxDepth = () => db.outbox.count()
