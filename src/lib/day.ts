import type { Day } from './types'

/** Default Day Start: 04:00, per Q5. Anything before it belongs to the previous Day. */
export const DEFAULT_DAY_START_MINUTES = 240

/**
 * R0 · today(now, dayStartMinutes) -> Day
 *
 * The only place clock time is ever consulted. Everything downstream deals in
 * plain calendar dates (ADR 0003).
 *
 * Note the deliberate avoidance of toISOString(): it converts to UTC, so a user
 * east of GMT late at night — or west of it early in the morning — would have
 * their completion recorded on the wrong day. The local getters are correct.
 */
export function today(now: Date = new Date(), dayStartMinutes: number = DEFAULT_DAY_START_MINUTES): Day {
  const shifted = new Date(now.getTime() - dayStartMinutes * 60_000)
  const y = shifted.getFullYear()
  const m = String(shifted.getMonth() + 1).padStart(2, '0')
  const d = String(shifted.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
