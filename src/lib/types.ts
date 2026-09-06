/**
 * Row types mirroring docs/data-model.md exactly. The local store is a
 * faithful mirror of the server schema, not a reshaped view of it — that is
 * what lets sync be a dumb row-level upsert rather than a translation layer.
 */

export type CadenceType = 'daily' | 'weekdays' | 'weekly_quota'
export type EntryKind = 'completed' | 'frozen'
export type Weight = 1 | 2 | 3

/** ISO calendar date, `YYYY-MM-DD`. Never a timestamp (ADR 0003). */
export type Day = string

/** ISO instant. Client-set; the last-write-wins comparand (ADR 0002). */
export type Stamp = string

export interface Profile {
  id: string
  day_start_minutes: number
  theme: 'system' | 'light' | 'dark'
  reminder_enabled: boolean
  reminder_minutes: number | null
  updated_at: Stamp
}

export interface Habit {
  id: string
  user_id: string
  name: string
  colour: string
  start_date: Day
  archived_at: Day | null
  sort_order: number
  updated_at: Stamp
  deleted_at: Stamp | null
}

export interface HabitSchedule {
  id: string
  habit_id: string
  user_id: string
  effective_from: Day
  cadence_type: CadenceType
  weekdays: number[] | null
  weekly_target: number | null
  weight: Weight
  updated_at: Stamp
  deleted_at: Stamp | null
}

export interface DayEntry {
  habit_id: string
  day: Day
  user_id: string
  kind: EntryKind
  value: number | null
  note: string | null
  updated_at: Stamp
  deleted_at: Stamp | null
}

/** Tables pulled by the generic cursor-paged loop. */
export type SyncedTable = 'habits' | 'habit_schedules' | 'day_entries'

/**
 * Tables the outbox can carry. profiles rides the same durable queue as
 * everything else — a Day Start changed on a plane must survive a reload — but
 * it is pulled separately, being one row per user rather than a growing set.
 */
export type OutboxTable = SyncedTable | 'profiles'

/**
 * A pending mutation. Every write is an upsert — deletes are tombstones
 * (deleted_at), never row removals, so an offline device can learn that a row
 * died rather than silently resurrecting it on next push.
 */
export interface OutboxItem {
  seq?: number
  table: OutboxTable
  /** Primary key: `id` for habits/schedules/profiles, `habit_id|day` for entries. */
  key: string
  payload: Habit | HabitSchedule | DayEntry | Profile
  created_at: Stamp
}
