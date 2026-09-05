import { addDays, daysBetween, isoWeekday, parseDay, startOfIsoWeek } from './calendar'
import type { CadenceType, Day, Habit, HabitSchedule, Weight } from './types'

/**
 * R1–R2. Pure functions over rows: no database, no clock. `today` is a
 * parameter so behaviour is deterministic under test.
 */

export const OUT_OF_RANGE = 'out_of_range' as const
export type OutOfRange = typeof OUT_OF_RANGE

export interface ResolvedSchedule {
  cadence_type: CadenceType
  weekdays: number[] | null
  weekly_target: number | null
  weight: Weight
}

/**
 * R1 · The schedule in force on `day` — never the habit's current one.
 *
 * ADR 0004: judging a historical day against today's cadence would let a bad
 * month be laundered by loosening the schedule after the fact.
 *
 * OUT_OF_RANGE covers all three boundaries: before the Start Date, on or after
 * an Archive, and any day in the future.
 */
export function resolveSchedule(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  day: Day,
  today: Day,
): ResolvedSchedule | OutOfRange {
  if (daysBetween(day, today) < 0) return OUT_OF_RANGE
  if (daysBetween(habit.start_date, day) < 0) return OUT_OF_RANGE
  if (habit.archived_at && daysBetween(habit.archived_at, day) >= 0) return OUT_OF_RANGE

  let winner: HabitSchedule | undefined
  for (const s of schedules) {
    if (s.habit_id !== habit.id || s.deleted_at !== null) continue
    if (daysBetween(s.effective_from, day) < 0) continue          // not yet in force
    if (!winner || daysBetween(winner.effective_from, s.effective_from) > 0) winner = s
  }
  if (!winner) return OUT_OF_RANGE

  return {
    cadence_type: winner.cadence_type,
    weekdays: winner.weekdays,
    weekly_target: winner.weekly_target,
    weight: winner.weight,
  }
}

/**
 * R2 · Whether a Habit counts toward the Aggregate denominator on `day`.
 *
 * This is NOT the question "was this a Miss". A weekly-quota habit is treated
 * as owed on every day until its quota is met, which is the right pressure for
 * the Aggregate but would make every un-gymmed Monday a failure. Miss, Streak
 * and Flawless Month are evaluated per week for those habits — see R3/R4.
 */
export function isScheduled(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  day: Day,
  today: Day,
  completed: ReadonlySet<Day>,
): boolean {
  const s = resolveSchedule(habit, schedules, day, today)
  if (s === OUT_OF_RANGE) return false

  switch (s.cadence_type) {
    case 'daily':
      return true

    case 'weekdays':
      return s.weekdays?.includes(isoWeekday(parseDay(day))) ?? false

    case 'weekly_quota':
      return completionsEarlierInWeek(day, completed) < (s.weekly_target ?? 1)
  }
}

/** Completions strictly before `day` within its ISO week. */
export function completionsEarlierInWeek(day: Day, completed: ReadonlySet<Day>): number {
  let count = 0
  for (let d = startOfIsoWeek(day); daysBetween(d, day) > 0; d = addDays(d, 1)) {
    if (completed.has(d)) count++
  }
  return count
}
