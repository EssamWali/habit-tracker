import Dexie from 'dexie'
import { db } from './db'
import { today } from './day'
import type { CadenceType, Day, DayEntry, Habit, HabitSchedule, OutboxItem, SyncedTable, Weight } from './types'

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

/** Habits for a user, ordered by sort_order. */
export const habitRange = (userId: string) =>
  db.habits.where('[user_id+sort_order]').between([userId, Dexie.minKey], [userId, Dexie.maxKey])

/**
 * Create a habit and its initial schedule row.
 *
 * The next sort_order is read from the database inside the same transaction as
 * the write, not from React state. Deriving it from a rendered list is a race:
 * two quick taps both read the same stale count and collide.
 *
 * Every habit gets a habit_schedules row at effective_from = start_date, since
 * ADR 0004 means there is no cadence anywhere else to fall back on.
 */
export async function createHabit(
  userId: string,
  opts: { name?: string; colour?: string } = {},
): Promise<Habit> {
  return db.transaction('rw', [db.habits, db.habit_schedules, db.outbox], async () => {
    const last = await habitRange(userId).last()
    const sort_order = last ? last.sort_order + 1 : 0
    const start = today()
    const stamp = nowStamp()

    const habit: Habit = {
      id: crypto.randomUUID(), user_id: userId,
      name: opts.name ?? `Habit ${sort_order + 1}`,
      colour: opts.colour ?? 'emerald',
      start_date: start, archived_at: null, sort_order,
      updated_at: stamp, deleted_at: null,
    }
    const schedule: HabitSchedule = {
      id: crypto.randomUUID(), habit_id: habit.id, user_id: userId,
      effective_from: start, cadence_type: 'daily',
      weekdays: null, weekly_target: null, weight: 2,
      updated_at: stamp, deleted_at: null,
    }

    await db.habits.put(habit)
    await db.habit_schedules.put(schedule)
    await db.outbox.put({ table: 'habits', key: habit.id, payload: habit, created_at: stamp })
    await db.outbox.put({ table: 'habit_schedules', key: schedule.id, payload: schedule, created_at: stamp })
    return habit
  })
}

/**
 * Toggle a Habit's Completion for a Day.
 *
 * Un-ticking writes a tombstone rather than deleting the row: a device that was
 * offline has to learn the Completion was removed, and a deleted row carries no
 * such news (ADR 0002).
 *
 * The read and the write share a transaction so two fast taps cannot both
 * observe the same prior state and end up agreeing on the wrong result.
 */
export async function toggleDay(userId: string, habitId: string, day: Day): Promise<void> {
  await db.transaction('rw', [db.day_entries, db.outbox], async () => {
    const existing = await db.day_entries.get([habitId, day])
    const stamp = nowStamp()

    const row: DayEntry = existing
      ? { ...existing, kind: 'completed', deleted_at: existing.deleted_at === null ? stamp : null, updated_at: stamp }
      : { habit_id: habitId, day, user_id: userId, kind: 'completed', value: null, note: null, updated_at: stamp, deleted_at: null }

    await db.day_entries.put(row)
    await db.outbox.put({ table: 'day_entries', key: `${habitId}|${day}`, payload: row, created_at: stamp })
  })
}

/** Patch a Habit's own fields. Cadence and weight do NOT live here (ADR 0004). */
export const updateHabit = (
  habit: Habit,
  patch: Partial<Pick<Habit, 'name' | 'colour' | 'start_date' | 'sort_order' | 'archived_at'>>,
) => write('habits', { ...habit, ...patch })

/**
 * Change a Habit's cadence or weight from today onward.
 *
 * This writes a NEW effective-dated row rather than editing the existing one —
 * the point of ADR 0004 is that history stays scored under the schedule that
 * was actually in force at the time.
 *
 * Editing twice in one day reuses that day's row instead of inserting a second:
 * the server has a unique constraint on (habit_id, effective_from), so a second
 * insert would be rejected on push and the change would never sync.
 */
export async function setSchedule(
  habit: Habit,
  patch: {
    cadence_type: CadenceType
    weekdays: number[] | null
    weekly_target: number | null
    weight: Weight
  },
): Promise<void> {
  const day = today()
  await db.transaction('rw', [db.habit_schedules, db.outbox], async () => {
    const existing = await db.habit_schedules
      .where('[habit_id+effective_from]')
      .equals([habit.id, day])
      .first()

    const stamp = nowStamp()
    const row: HabitSchedule = existing
      ? { ...existing, ...patch, updated_at: stamp, deleted_at: null }
      : {
          id: crypto.randomUUID(), habit_id: habit.id, user_id: habit.user_id,
          effective_from: day, ...patch, updated_at: stamp, deleted_at: null,
        }

    await db.habit_schedules.put(row)
    await db.outbox.put({ table: 'habit_schedules', key: row.id, payload: row, created_at: stamp })
  })
}

/** Archive: history preserved, Misses stop accruing from today, reversible. */
export const archiveHabit = (habit: Habit) => updateHabit(habit, { archived_at: today() })

export const restoreHabit = (habit: Habit) => updateHabit(habit, { archived_at: null })

/**
 * Move a Habit one place up or down.
 *
 * Every position is rewritten sequentially rather than swapping two rows, so
 * sort_order stays a dense 0..n-1 sequence and cannot drift into ties after
 * repeated moves.
 *
 * Concurrent reordering on two offline devices is the one case per-row
 * last-write-wins handles poorly: the rows are independent keys, so halves of
 * two different orderings can interleave into a third. It resolves to a stable
 * order rather than corrupting anything, and re-ordering fixes it — an
 * acceptable cost for a preference that is cheap to restate.
 */
export async function moveHabit(habits: readonly Habit[], id: string, delta: -1 | 1): Promise<void> {
  const index = habits.findIndex(h => h.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= habits.length) return

  const next = [...habits]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved!)

  await db.transaction('rw', [db.habits, db.outbox], async () => {
    const stamp = nowStamp()
    for (let i = 0; i < next.length; i++) {
      const habit = next[i]!
      if (habit.sort_order === i) continue
      const row: Habit = { ...habit, sort_order: i, updated_at: stamp }
      await db.habits.put(row)
      await db.outbox.put({ table: 'habits', key: row.id, payload: row, created_at: stamp })
    }
  })
}

/** Persist an explicit ordering. Positions are dense 0..n-1 by construction. */
export async function setHabitOrder(habits: readonly Habit[], orderedIds: readonly string[]): Promise<void> {
  const byId = new Map(habits.map(h => [h.id, h]))
  await db.transaction('rw', [db.habits, db.outbox], async () => {
    const stamp = nowStamp()
    for (let i = 0; i < orderedIds.length; i++) {
      const habit = byId.get(orderedIds[i]!)
      if (!habit || habit.sort_order === i) continue
      const row: Habit = { ...habit, sort_order: i, updated_at: stamp }
      await db.habits.put(row)
      await db.outbox.put({ table: 'habits', key: row.id, payload: row, created_at: stamp })
    }
  })
}
