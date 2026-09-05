import type { Day } from './types'

const MS_PER_DAY = 86_400_000

/** Parse a Day into a local-midnight Date. Never Date.parse: that reads bare
 *  `YYYY-MM-DD` as UTC, which shifts the day for anyone not on GMT. */
export function parseDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export function formatDay(d: Date): Day {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

export function addDays(day: Day, n: number): Day {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return formatDay(d)
}

export function daysBetween(a: Day, b: Day): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / MS_PER_DAY)
}

/** The Monday of the ISO week containing `day`. */
export function startOfIsoWeek(day: Day): Day {
  return addDays(day, -(isoWeekday(parseDay(day)) - 1))
}

export interface Grid {
  /** Columns of exactly 7 Days, Monday first. The final column may run past
   *  `end` into the future; those Cells render as out-of-range. */
  weeks: Day[][]
  /** Column index -> month label, emitted only where a new month begins. */
  monthLabels: { column: number; label: string }[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A rolling window of `days` ending on `end`, laid out as GitHub does it:
 * columns are weeks, rows are weekdays.
 *
 * The window is extended backwards to the Monday on or before its start, so
 * every column is a whole week and rows line up (Q17: Monday-start, a
 * deliberate divergence from GitHub's Sunday-start).
 */
export function buildGrid(end: Day, days = 365): Grid {
  const rawStart = addDays(end, -(days - 1))
  const start = addDays(rawStart, -(isoWeekday(parseDay(rawStart)) - 1))

  const weeks: Day[][] = []
  const monthLabels: { column: number; label: string }[] = []
  let seenMonth = -1

  for (let cursor = start; daysBetween(cursor, end) >= 0; cursor = addDays(cursor, 7)) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(cursor, i))
    // The column's month is its Thursday's month — the ISO convention, and a
    // natural majority rule since four of the seven days must share it.
    // Using the Monday instead loses any month that never starts a column:
    // a window ending 5 Sep has its last column beginning 31 Aug, so
    // September would never be labelled at all.
    const month = parseDay(week[3]!).getMonth()
    if (month !== seenMonth) {
      monthLabels.push({ column: weeks.length, label: MONTHS[month]! })
      seenMonth = month
    }
    weeks.push(week)
  }

  return { weeks, monthLabels }
}
