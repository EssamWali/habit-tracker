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
  for (let cursor = start; daysBetween(cursor, end) >= 0; cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)))
  }
  return { weeks, monthLabels: labelMonths(weeks) }
}

/** A whole calendar month, padded to complete Monday-start weeks. Days later in
 *  the month are included and render as empty Cells, so the grid fills in as
 *  the month progresses rather than being a window that slides. */
export function buildMonthGrid(anchor: Day): Grid {
  const d = parseDay(anchor)
  const first = formatDay(new Date(d.getFullYear(), d.getMonth(), 1))
  const last = formatDay(new Date(d.getFullYear(), d.getMonth() + 1, 0))

  const start = addDays(first, -(isoWeekday(parseDay(first)) - 1))
  const weeks: Day[][] = []
  for (let cursor = start; daysBetween(cursor, last) >= 0; cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)))
  }

  return {
    weeks,
    monthLabels: [{ column: 0, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }],
  }
}

/**
 * A column belongs to its Thursday's month — the ISO convention, and a majority
 * rule since four of seven days must share it.
 *
 * A label is emitted only if three columns have passed since the last one:
 * labels are wider than the 13px column step, so without spacing a short window
 * renders them overlapping — "JulAug" collided into one smear.
 *
 * A *leading* partial month of a single column is dropped, because keeping it
 * would consume the spacing budget and suppress the following full month. A
 * trailing partial month is kept: the current month must always be labelled,
 * and dropping it was the original "September is missing" bug.
 */
function labelMonths(weeks: Day[][]): { column: number; label: string }[] {
  // Keyed by year AND month: a 365-day window contains two Septembers, and
  // keying by month alone makes the trailing one collide with the leading one
  // so it never registers its own column.
  const firstColumnOf = new Map<number, number>()
  const width = new Map<number, number>()

  weeks.forEach((week, column) => {
    const d = parseDay(week[3]!)
    const key = d.getFullYear() * 12 + d.getMonth()
    if (!firstColumnOf.has(key)) firstColumnOf.set(key, column)
    width.set(key, (width.get(key) ?? 0) + 1)
  })

  const out: { column: number; label: string }[] = []
  let previous = -Infinity
  for (const [key, column] of [...firstColumnOf.entries()].sort((a, b) => a[1] - b[1])) {
    if (column === 0 && (width.get(key) ?? 0) < 2) continue
    if (column - previous < 3) continue
    out.push({ column, label: MONTHS[key % 12]! })
    previous = column
  }
  return out
}
