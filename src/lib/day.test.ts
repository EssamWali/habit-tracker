import { describe, expect, it } from 'vitest'
import { today } from './day'

/**
 * R0. Constructed with local-time Date literals: `new Date('2026-03-14T01:30:00')`
 * (no Z) is parsed in the runner's local zone, which is what the rule operates in.
 */
describe('R0 · today()', () => {
  it('credits the previous Day before the 04:00 Day Start', () => {
    expect(today(new Date('2026-03-14T01:30:00'))).toBe('2026-03-13')
  })

  it('still credits the previous Day one minute before rollover', () => {
    expect(today(new Date('2026-03-14T03:59:00'))).toBe('2026-03-13')
  })

  it('credits the current Day exactly at the Day Start', () => {
    expect(today(new Date('2026-03-14T04:00:00'))).toBe('2026-03-14')
  })

  it('credits the current Day in the evening', () => {
    expect(today(new Date('2026-03-14T23:45:00'))).toBe('2026-03-14')
  })

  it('respects a custom Day Start', () => {
    // Midnight boundary: with dayStartMinutes = 0 there is no shift at all.
    expect(today(new Date('2026-03-14T01:30:00'), 0)).toBe('2026-03-14')
  })

  it('does not leak UTC conversion into the date', () => {
    // The regression this guards: toISOString() would return 2026-03-13 for
    // this instant anywhere east of GMT, silently mis-dating every Completion
    // logged in the early morning.
    const atDayStart = new Date('2026-03-14T04:00:00')
    expect(today(atDayStart)).toBe('2026-03-14')
    if (atDayStart.getTimezoneOffset() !== 0) {
      expect(today(atDayStart)).not.toBe(atDayStart.toISOString().slice(0, 10))
    }
  })

  it('rolls across a month boundary', () => {
    expect(today(new Date('2026-04-01T02:00:00'))).toBe('2026-03-31')
  })

  it('rolls across a year boundary', () => {
    expect(today(new Date('2027-01-01T00:30:00'))).toBe('2026-12-31')
  })
})
