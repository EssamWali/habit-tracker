import { addDays, daysBetween } from './calendar'
import { timeline, type StatUnit, type TimelineSpan } from './rules'
import type { Day, EntryKind, Habit, HabitSchedule } from './types'

/**
 * R8 · Completion rate and trend.
 *
 * v1 made the data trustworthy; v2 draws conclusions from it, which moves the
 * risk from broken numbers to *misleading* ones. A statistic that is quietly
 * wrong is worse than one that is missing, because it gets believed — so this
 * module refuses to answer more often than it rounds.
 *
 * Everything here is derived from the R4 timeline rather than from a second
 * reading of the entries. That is what keeps the rate and the streak on one
 * card telling the same story.
 */

export type StatWindow = 7 | 30 | 90 | 'all'

export interface Span { from: Day; to: Day }

/**
 * Opportunities below this in either window make a comparison noise.
 *
 * At three, a single unit moves the rate by 33 percentage points, so "down 33%"
 * would mean "missed one day" — a reading that would send someone chasing a
 * decline that never happened.
 */
const MIN_OPPORTUNITIES = 4

/** Movement smaller than this reads as unchanged rather than as a direction. */
const STEADY_BAND = 0.05

export interface RateResult {
  unit: StatUnit
  /** Units completed. */
  hits: number
  /** Units that could have been completed: excludes pending and Frozen ones. */
  opportunities: number
  /** hits / opportunities, or null when the window held no opportunities. */
  rate: number | null
  span: Span
}

export interface TrendResult {
  direction: 'up' | 'down' | 'steady' | 'insufficient'
  /** Percentage-point change against the previous window. Null when insufficient. */
  delta: number | null
  previous: number | null
}

export interface HabitStats {
  unit: StatUnit
  window: StatWindow
  current: RateResult
  /** Null for the all-time window, which has nothing before it to compare to. */
  previous: RateResult | null
  trend: TrendResult
}

/**
 * The span a window covers.
 *
 * `all` runs from the Start Date, not from some fixed horizon. A habit created
 * five days ago has five days of opportunity, not ninety — without that, every
 * new habit opens at a demoralising near-zero and the ranking in V2-3 measures
 * nothing but how old each habit is.
 */
export function windowSpan(today: Day, window: StatWindow, startDate: Day): Span {
  if (window === 'all') return { from: startDate, to: today }
  return { from: addDays(today, -(window - 1)), to: today }
}

const within = (span: Span, day: Day) =>
  daysBetween(span.from, day) >= 0 && daysBetween(day, span.to) >= 0

/**
 * Count one window over a prepared timeline.
 *
 * Only spans measured in the same unit are counted. A habit that ran daily and
 * then switched to a weekly quota has history in both, and adding weeks to days
 * would produce a number with no meaning — so the older regime is dropped
 * rather than blended, exactly as R4 ends a run when the unit changes.
 *
 * Pending and Frozen units are excluded from both sides. An unfinished today is
 * not yet a failure, and a Freeze is neither a Completion nor a Miss; counting
 * either in the denominator would push the rate down for something that has not
 * gone wrong.
 */
function count(spans: readonly TimelineSpan[], unit: StatUnit, span: Span): RateResult {
  let hits = 0
  let opportunities = 0

  for (const s of spans) {
    if (s.unit !== unit) continue
    for (const u of s.units) {
      if (!within(span, u.at)) continue
      if (u.outcome === 'pending' || u.outcome === 'freeze') continue
      opportunities++
      if (u.outcome === 'complete') hits++
    }
  }

  return {
    unit,
    hits,
    opportunities,
    rate: opportunities === 0 ? null : hits / opportunities,
    span,
  }
}

/**
 * Compare two windows.
 *
 * Reports `insufficient` rather than a number whenever either side is too thin
 * to carry one. The previous window being empty is the common case — a habit
 * three weeks old has no month before last — and inventing a direction for it
 * would manufacture the exact signal V2-3 asks the user to act on.
 */
function compare(current: RateResult, previous: RateResult | null): TrendResult {
  if (
    previous === null ||
    current.rate === null || previous.rate === null ||
    current.opportunities < MIN_OPPORTUNITIES ||
    previous.opportunities < MIN_OPPORTUNITIES
  ) {
    return { direction: 'insufficient', delta: null, previous: previous?.rate ?? null }
  }

  const delta = current.rate - previous.rate
  const direction = Math.abs(delta) < STEADY_BAND ? 'steady' : delta > 0 ? 'up' : 'down'
  return { direction, delta, previous: previous.rate }
}

/**
 * R8 · A Habit's rate over a window, and how it compares to the window before.
 *
 * The unit is taken from the habit's most recent cadence regime rather than
 * from whatever is in force today: an archived habit is out of range as of
 * today and would otherwise have no unit at all, and its history is exactly
 * what someone reviewing it wants to see.
 */
export function habitStats(
  habit: Habit,
  schedules: readonly HabitSchedule[],
  entries: ReadonlyMap<Day, EntryKind>,
  today: Day,
  window: StatWindow,
): HabitStats {
  const spans = timeline(habit, schedules, entries, today)
  const unit: StatUnit = spans.length > 0 ? spans[spans.length - 1]!.unit : 'day'

  const span = windowSpan(today, window, habit.start_date)
  const current = count(spans, unit, span)

  // The immediately preceding window of equal length. All-time has none.
  const previous = window === 'all'
    ? null
    : count(spans, unit, {
        from: addDays(span.from, -window),
        to: addDays(span.from, -1),
      })

  return { unit, window, current, previous, trend: compare(current, previous) }
}
