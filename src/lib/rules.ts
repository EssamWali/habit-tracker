import {
  addDays, addMonths, daysBetween, endOfMonth, isoWeekday, monthOf,
  parseDay, startOfIsoWeek, startOfMonth, type Month,
} from './calendar'
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

export type Outcome = 'complete' | 'freeze' | 'fail' | 'pending'

/**
 * One evaluated period of a Habit's history.
 *
 * `at` anchors it: the Day itself for a daily unit, the ISO week's Monday for a
 * weekly one. It is what lets a window be applied to units without re-deriving
 * them — `days` is empty for anything but a Completion, so it cannot date a
 * failure.
 */
export interface Unit { outcome: Outcome; at: Day; days: Day[] }

/**
 * The unit a cadence is measured in.
 *
 * Two cadence types share one unit: `daily` and `weekdays` both accrue per
 * Scheduled Day and differ only in which days qualify. `weekly_quota` is the
 * odd one out, and mixing its weeks into a count of days is the trap R8 exists
 * to avoid — a 3x/week habit that hit quota every week would report ~43%.
 */
export type StatUnit = 'day' | 'week'

export const unitOf = (cadence: CadenceType): StatUnit =>
  cadence === 'weekly_quota' ? 'week' : 'day'

export interface TimelineSpan {
  unit: StatUnit
  cadence: CadenceType
  units: Unit[]
}

/**
 * A Habit's whole history as evaluated units, split by cadence regime.
 *
 * Shared by R4 and R8 deliberately. A statistic derived from its own private
 * notion of an opportunity would be free to disagree with the streak shown
 * beside it, and two numbers on one card that contradict each other are worse
 * than either being absent.
 */
export function timeline(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  entries: ReadonlyMap<Day, EntryKind>,
  today: Day,
): TimelineSpan[] {
  const completed = new Set<Day>()
  for (const [day, kind] of entries) if (kind === 'completed') completed.add(day)

  return segments(habit, schedules, today).map(segment => ({
    unit: unitOf(segment.type),
    cadence: segment.type,
    units: segment.type === 'weekly_quota'
      ? weeklyUnits(segment, entries, completed, today)
      : dailyUnits(segment, habit, schedules, entries, completed, today),
  }))
}

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
  const gold = new Set<Day>()
  const tier2 = new Set<Day>()
  let longest = 0
  let current = 0

  for (const { unit: scaleKey, units } of timeline(habit, schedules, entries, today)) {
    const scale = THRESHOLD[scaleKey]
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
    units.push({ outcome, at: day, days: kind === 'completed' ? [day] : [] })
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
    units.push({ outcome, at: week, days: outcome === 'complete' ? hits : [] })
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

/* ------------------------------------------------------------------ R6 --- */

/**
 * R6 · Was this calendar month Flawless for this Habit?
 *
 * Three conditions, each load-bearing:
 *
 * - **Active throughout.** A partial month never qualifies. Otherwise creating
 *   a Habit on the 28th and completing three days would earn the same reward as
 *   a whole clean month.
 *
 * - **No Freezes.** The one that matters most. If a Freeze did not disqualify,
 *   spending a token could produce the Flawless Month that refunds it — a loop
 *   that prints free tokens.
 *
 * - **Complete in the cadence's own unit.** Every Scheduled Day completed, or
 *   for a weekly quota, every ISO week *fully contained* in the month meeting
 *   its target. A week straddling a month boundary belongs to neither: a quota
 *   cannot fairly be demanded of four days, and counting it in both months
 *   would let one good week rescue two.
 *
 * `today` bounds it: a month still in progress cannot be Flawless, because R1
 * puts its remaining days out of range and they are not yet completed.
 */
export function isFlawlessMonth(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  month: Month,
  entries: ReadonlyMap<Day, EntryKind>,
  today: Day,
): boolean {
  const first = startOfMonth(month)
  const last = endOfMonth(month)

  // Active for the whole month, and the whole month is behind us.
  if (daysBetween(habit.start_date, first) < 0) return false
  if (habit.archived_at && daysBetween(last, habit.archived_at) <= 0) return false
  if (daysBetween(last, today) < 0) return false

  const completed = new Set<Day>()
  for (const [day, kind] of entries) if (kind === 'completed') completed.add(day)

  // A single Freeze anywhere in the month ends it, before anything else is
  // checked: the month cannot be flawless and the token must not come back.
  for (let day = first; daysBetween(day, last) >= 0; day = addDays(day, 1)) {
    if (entries.get(day) === 'frozen') return false
  }

  let sawAnySchedule = false

  for (let day = first; daysBetween(day, last) >= 0; day = addDays(day, 1)) {
    const s = resolveSchedule(habit, schedules, day, today)
    if (s === OUT_OF_RANGE) return false      // a gap in cover is not flawless

    if (s.cadence_type === 'weekly_quota') continue   // judged per week below
    if (!isScheduled(habit, schedules, day, today, completed)) continue
    // Set only for a genuinely Scheduled Day, not merely a covered one: a
    // cadence that schedules nothing all month owes nothing, and a month that
    // owed nothing is not an achievement.
    sawAnySchedule = true
    if (!completed.has(day)) return false
  }

  // Weekly-quota spans, week by week, counting only whole weeks inside the month.
  for (let week = startOfIsoWeek(first); daysBetween(week, last) >= 0; week = addDays(week, 7)) {
    if (daysBetween(first, week) < 0) continue                 // starts before the month
    if (daysBetween(addDays(week, 6), last) < 0) continue      // ends after the month

    const s = resolveSchedule(habit, schedules, week, today)
    if (s === OUT_OF_RANGE || s.cadence_type !== 'weekly_quota') continue

    sawAnySchedule = true
    const hits = Array.from({ length: 7 }, (_, i) => addDays(week, i))
      .filter(d => completed.has(d)).length
    if (hits < (s.weekly_target ?? 1)) return false
  }

  // A month that owed nothing is not an achievement.
  return sawAnySchedule
}

/* ------------------------------------------------------------------ R7 --- */

/** The most Freeze Tokens a Habit can hold at once. */
export const FREEZE_CAP = 3

/** How recently a Day must fall for a Freeze to be applied to it. */
export const FREEZE_LOOKBACK_DAYS = 7

/**
 * R7 · Freeze Tokens available as of a Day.
 *
 * Derived, never stored. A stored balance is a second source of truth that sync
 * would have to reconcile, and the ledger that produces it is already sitting
 * in the entries.
 *
 * Walking calendar months from the Start Date:
 *
 *   grant +1  →  spend one per Frozen entry dated in the month  →  expire an
 *   unused grant at month end unless the month was Flawless
 *
 * That order is not cosmetic. A Freeze applied on 2 October to 28 September
 * spends a *September* token, and it has to spend it before September's expiry
 * runs — otherwise the token evaporates and comes back as a negative balance.
 *
 * The balance can still go negative through the one case last-write-wins does
 * not resolve: two offline devices each spending the last token. That is
 * reconciled in V3-5 rather than clamped away here, because silently hiding a
 * debt would let the next month's grant be eaten by one the user cannot see.
 */
export function freezeTokens(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  entries: ReadonlyMap<Day, EntryKind>,
  asOf: Day,
  today: Day = asOf,
): number {
  const frozenPerMonth = new Map<Month, number>()
  for (const [day, kind] of entries) {
    if (kind !== 'frozen') continue
    if (daysBetween(day, asOf) < 0) continue          // not spent yet, as of asOf
    const m = monthOf(day)
    frozenPerMonth.set(m, (frozenPerMonth.get(m) ?? 0) + 1)
  }

  const current = monthOf(asOf)
  let balance = 0

  for (let month = monthOf(habit.start_date); month <= current; month = addMonths(month, 1)) {
    const banked = balance                                    // carried in from before
    balance = Math.min(FREEZE_CAP, balance + 1)               // this month's grant
    balance -= frozenPerMonth.get(month) ?? 0                 // spends dated in it

    // The month still running has not ended, so nothing expires yet.
    if (month === current) break

    // Only *this month's grant* expires, and only if the month was not
    // Flawless. Tokens banked from earlier Flawless months survive: Q23 makes
    // stacking conditional on a clean month, not the bank destructible by a
    // bad one.
    //
    // min(balance, banked) says that in one line. Having spent anything leaves
    // balance at or below banked, so nothing expires — the grant was used. Not
    // having spent leaves balance one above, and the grant falls away.
    if (!isFlawlessMonth(habit, schedules, month, entries, today)) {
      balance = Math.min(balance, banked)
    }
  }

  return Math.min(FREEZE_CAP, balance)
}

/**
 * Every Flawless Month a Habit has completed, oldest first.
 *
 * Walks only whole months that have ended — a month in progress cannot qualify,
 * so including it would show an achievement that could still evaporate.
 */
export function flawlessMonths(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  entries: ReadonlyMap<Day, EntryKind>,
  today: Day,
): Month[] {
  const out: Month[] = []
  const current = monthOf(today)
  for (let month = monthOf(habit.start_date); month < current; month = addMonths(month, 1)) {
    if (isFlawlessMonth(habit, schedules, month, entries, today)) out.push(month)
  }
  return out
}

/**
 * Whether a Freeze may be applied to a Day.
 *
 * Enforced here rather than only in the UI: an ineligible Freeze is a minted
 * token or a laundered Miss, and neither should depend on a button being
 * hidden.
 */
export type FreezeRefusal =
  | 'too-old' | 'future' | 'not-missed' | 'no-tokens'

export function canFreeze(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  day: Day,
  today: Day,
  entries: ReadonlyMap<Day, EntryKind>,
  completed: ReadonlySet<Day>,
): true | FreezeRefusal {
  const age = daysBetween(day, today)
  if (age < 0) return 'future'
  if (age >= FREEZE_LOOKBACK_DAYS) return 'too-old'

  // Only a Day that actually went wrong. Freezing an unscheduled Day would let
  // someone bank tokens against days they never owed; freezing a completed one
  // would downgrade a real Completion.
  if (cellState(habit, schedules, day, today, entries, completed) !== 'missed') return 'not-missed'

  if (freezeTokens(habit, schedules, entries, day, today) < 1) return 'no-tokens'
  return true
}
