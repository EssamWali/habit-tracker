import { addDays, daysBetween, isoWeekday, parseDay, startOfIsoWeek } from './calendar'
import type { CadenceType, Day, EntryKind, Habit, HabitSchedule, Weight } from './types'

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

/* ------------------------------------------------------------------ R3 --- */

export type CellState = 'completed' | 'frozen' | 'missed' | 'unscheduled' | 'out_of_range'

/**
 * R3 · What a Cell shows.
 *
 * The weekly_quota branch is the one that matters: those habits have NO daily
 * Misses. isScheduled treats them as owed every day until quota, which is right
 * for the Aggregate denominator but would make every un-gymmed Monday a
 * failure. Their failures are recorded per week, in R4.
 */
export function cellState(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  day: Day,
  today: Day,
  entries: ReadonlyMap<Day, EntryKind>,
  completed: ReadonlySet<Day>,
): CellState {
  const s = resolveSchedule(habit, schedules, day, today)
  if (s === OUT_OF_RANGE) return 'out_of_range'

  const kind = entries.get(day)
  if (kind) return kind === 'completed' ? 'completed' : 'frozen'

  if (s.cadence_type === 'weekly_quota') return 'unscheduled'
  return isScheduled(habit, schedules, day, today, completed) ? 'missed' : 'unscheduled'
}

/* ------------------------------------------------------------------ R4 --- */

export interface StreakResult {
  /** The run still open at the most recent unit, in units (days or weeks). */
  current: number
  longest: number
  /** Completions rendered gold. */
  gold: Set<Day>
  /** Completions rendered at the second tier. */
  tier2: Set<Day>
}

const THRESHOLD = {
  day: { gold: 7, tier2: 30 },
  week: { gold: 4, tier2: 12 },
} as const

type Outcome = 'complete' | 'freeze' | 'fail' | 'pending'
interface Unit { outcome: Outcome; days: Day[] }

/**
 * R4 · Streaks and gold.
 *
 * The unit of iteration is cadence-relative: Scheduled Days for daily and
 * weekday habits, ISO weeks for weekly-quota ones. Thresholds follow — 7/30
 * consecutive completions, or 4/12 consecutive quota-meeting weeks.
 *
 * Three deliberate rules:
 *
 * - **Gold is a property of runs, not of state.** All maximal runs are computed
 *   over full history and any reaching threshold marks its completions. Both
 *   "gold applies retroactively to the whole run" and "gold survives breaking
 *   the streak" fall out of that, with nothing stored and nothing to migrate.
 *
 * - **A Freeze preserves a run without extending it.** You did not do the
 *   habit, so it neither breaks the streak nor adds to its length: a run of 7
 *   may span 8 scheduled days.
 *
 * - **The current unit is pending, not failed.** An unfinished today would
 *   otherwise read as a broken streak every morning.
 *
 * A change of cadence *type* ends the current run. The unit of measurement
 * changes with it, so carrying a count of days into a regime measured in weeks
 * would be comparing unlike things. Changing which weekdays, or the weekly
 * target, does not break a run — the unit is unchanged.
 */
export function streaks(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  entries: ReadonlyMap<Day, EntryKind>,
  today: Day,
): StreakResult {
  const completed = new Set<Day>()
  for (const [day, kind] of entries) if (kind === 'completed') completed.add(day)

  const gold = new Set<Day>()
  const tier2 = new Set<Day>()
  let longest = 0
  let current = 0

  for (const segment of segments(habit, schedules, today)) {
    const units = segment.type === 'weekly_quota'
      ? weeklyUnits(segment, entries, completed, today)
      : dailyUnits(segment, habit, schedules, entries, completed, today)

    const scale = segment.type === 'weekly_quota' ? THRESHOLD.week : THRESHOLD.day
    let run: Unit['days'] = []
    let length = 0

    const close = () => {
      if (length >= scale.gold) for (const d of run) gold.add(d)
      if (length >= scale.tier2) for (const d of run) tier2.add(d)
      longest = Math.max(longest, length)
      run = []
      length = 0
    }

    for (const unit of units) {
      if (unit.outcome === 'fail') { current = 0; close(); continue }
      if (unit.outcome === 'pending') continue        // neither extends nor breaks
      if (unit.outcome === 'freeze') continue         // preserves without extending
      length++
      run.push(...unit.days)
      current = length
    }
    close()
  }

  return { current, longest, gold, tier2 }
}

interface Segment { from: Day; to: Day; type: CadenceType; target?: number | null }

/** History split into maximal spans of a single cadence type. */
function segments(habit: Habit, schedules: readonly HabitSchedule[], today: Day): Segment[] {
  const out: Segment[] = []
  for (let day = habit.start_date; daysBetween(day, today) >= 0; day = addDays(day, 1)) {
    const s = resolveSchedule(habit, schedules, day, today)
    if (s === OUT_OF_RANGE) continue
    const last = out[out.length - 1]
    if (last && last.type === s.cadence_type) last.to = day
    else out.push({ from: day, to: day, type: s.cadence_type, target: s.weekly_target })
  }
  return out
}

function dailyUnits(
  segment: Segment, habit: Habit, schedules: readonly HabitSchedule[],
  entries: ReadonlyMap<Day, EntryKind>, completed: ReadonlySet<Day>, today: Day,
): Unit[] {
  const units: Unit[] = []
  for (let day = segment.from; daysBetween(day, segment.to) >= 0; day = addDays(day, 1)) {
    if (!isScheduled(habit, schedules, day, today, completed)) continue
    const kind = entries.get(day)
    const outcome: Outcome = kind === 'completed' ? 'complete'
      : kind === 'frozen' ? 'freeze'
      : day === today ? 'pending'
      : 'fail'
    units.push({ outcome, days: kind === 'completed' ? [day] : [] })
  }
  return units
}

function weeklyUnits(
  segment: Segment, entries: ReadonlyMap<Day, EntryKind>,
  completed: ReadonlySet<Day>, today: Day,
): Unit[] {
  const units: Unit[] = []
  const target = segment.target ?? 1
  const currentWeek = startOfIsoWeek(today)

  for (let week = startOfIsoWeek(segment.from); daysBetween(week, segment.to) >= 0; week = addDays(week, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
    const inSegment = days.filter(d =>
      daysBetween(segment.from, d) >= 0 && daysBetween(d, segment.to) >= 0)
    if (inSegment.length === 0) continue

    const hits = inSegment.filter(d => completed.has(d))
    // A Freeze anywhere in the week protects it: the unit here is the week, so
    // that is the only thing a token can meaningfully buy.
    const frozen = inSegment.some(d => entries.get(d) === 'frozen')

    const outcome: Outcome = hits.length >= target ? 'complete'
      : week === currentWeek ? 'pending'
      : frozen ? 'freeze'
      : 'fail'
    units.push({ outcome, days: outcome === 'complete' ? hits : [] })
  }
  return units
}

/* ------------------------------------------------------------------ R5 --- */

export interface HabitData {
  habit: Habit
  entries: ReadonlyMap<Day, EntryKind>
  completed: ReadonlySet<Day>
}

export interface AggregateResult {
  /** Weighted completion, clamped to 1. Meaningless when `neutral`. */
  ratio: number
  /** 0 = owed but nothing done; 1–4 = shading bands. */
  band: 0 | 1 | 2 | 3 | 4
  /** Nothing was scheduled: a rest day, not a failure. */
  neutral: boolean
  scheduledWeight: number
  completedWeight: number
  isPerfectDay: boolean
}

/**
 * R5 · The Aggregate Heatmap's intensity for one Day.
 *
 * Weighted: `sum(weight of completed scheduled) / sum(weight of scheduled)`,
 * with every weight resolved as of that Day (ADR 0004).
 *
 * - A Freeze counts toward the denominator but never the numerator. It keeps a
 *   Streak alive; it is not a Completion.
 * - Completing an unscheduled habit is a bonus: it raises the numerator without
 *   touching the denominator, and the ratio clamps at 1.
 * - A Day with nothing scheduled is neutral, never 0%. Rest days are not
 *   failures.
 *
 * `isPerfectDay` is structural rather than `ratio >= 1`. Bonus completions can
 * lift the numerator to meet the denominator while a scheduled habit was
 * genuinely missed, and that must not read as perfect.
 */
export function aggregate(
  data: readonly HabitData[],
  schedules: readonly HabitSchedule[],
  day: Day,
  today: Day,
): AggregateResult {
  let scheduledWeight = 0
  let completedWeight = 0
  let anyScheduledMissed = false

  for (const { habit, entries, completed } of data) {
    const s = resolveSchedule(habit, schedules, day, today)
    if (s === OUT_OF_RANGE) continue

    const scheduled = isScheduled(habit, schedules, day, today, completed)
    const kind = entries.get(day)
    const isDone = kind === 'completed'

    if (scheduled) {
      scheduledWeight += s.weight
      if (isDone) completedWeight += s.weight
      else anyScheduledMissed = true
    } else if (isDone) {
      completedWeight += s.weight       // bonus: numerator only
    }
  }

  const neutral = scheduledWeight === 0
  const ratio = neutral ? 0 : Math.min(1, completedWeight / scheduledWeight)

  return {
    ratio,
    band: neutral ? 0 : bandFor(ratio),
    neutral,
    scheduledWeight,
    completedWeight,
    isPerfectDay: !neutral && !anyScheduledMissed,
  }
}

function bandFor(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (ratio <= 0) return 0
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}
