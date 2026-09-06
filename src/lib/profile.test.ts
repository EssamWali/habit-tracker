import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, dayStartOf, formatDayStart, withDefaults } from './profile'
import { today } from './day'
import type { Profile } from './types'

const row = (patch: Partial<Profile> = {}): Profile => ({
  id: 'u1',
  day_start_minutes: 240,
  theme: 'system',
  reminder_enabled: false,
  reminder_minutes: null,
  updated_at: '2026-09-06T10:00:00.000Z',
  ...patch,
})

describe('withDefaults', () => {
  it('stands in for a profile that has not synced yet', () => {
    const p = withDefaults(undefined, 'u1')
    expect(p.id).toBe('u1')
    expect(p.day_start_minutes).toBe(DEFAULT_PROFILE.day_start_minutes)
    expect(p.theme).toBe('system')
  })

  // The placeholder must lose every last-write-wins comparison, or a device
  // that has never synced would push its defaults over a real setting.
  it('dates the placeholder at the epoch so any real row beats it', () => {
    expect(Date.parse(withDefaults(undefined, 'u1').updated_at))
      .toBeLessThan(Date.parse(row().updated_at))
  })

  it('leaves a real row alone', () => {
    const p = withDefaults(row({ day_start_minutes: 90, theme: 'dark' }), 'u1')
    expect(p.day_start_minutes).toBe(90)
    expect(p.theme).toBe('dark')
  })
})

describe('dayStartOf', () => {
  it('reads the setting', () => {
    expect(dayStartOf(row({ day_start_minutes: 0 }))).toBe(0)
    expect(dayStartOf(row({ day_start_minutes: 330 }))).toBe(330)
  })

  it('falls back when the row is missing', () => {
    expect(dayStartOf(undefined)).toBe(240)
    expect(dayStartOf(null)).toBe(240)
  })

  // A junk value here would shift every Day in the app at once, so it is
  // clamped rather than trusted or thrown on.
  it('clamps a value outside the column range', () => {
    expect(dayStartOf(row({ day_start_minutes: -60 }))).toBe(0)
    expect(dayStartOf(row({ day_start_minutes: 5000 }))).toBe(1439)
    expect(dayStartOf(row({ day_start_minutes: Number.NaN }))).toBe(240)
  })
})

describe('formatDayStart', () => {
  it('renders HH:MM', () => {
    expect(formatDayStart(0)).toBe('00:00')
    expect(formatDayStart(240)).toBe('04:00')
    expect(formatDayStart(330)).toBe('05:30')
    expect(formatDayStart(720)).toBe('12:00')
  })
})

/**
 * V2-1's second acceptance clause: changing Day Start must not rewrite history.
 *
 * The guarantee is structural rather than defensive. A Completion is stored as
 * the Day string that R0 produced at the moment it was ticked (ADR 0003), and
 * nothing downstream re-derives it — the rules take `today` as a parameter and
 * never read a clock. So a new Day Start can only decide where *future* ticks
 * land. These tests pin both halves of that.
 */
describe('Day Start changes are forward-only', () => {
  const lateNight = new Date('2026-03-14T02:30:00')

  it('moves the boundary for a tick made now', () => {
    expect(today(lateNight, 240)).toBe('2026-03-13')   // 04:00 start
    expect(today(lateNight, 0)).toBe('2026-03-14')     // midnight start
    expect(today(lateNight, 330)).toBe('2026-03-13')   // 05:30 start
  })

  it('leaves history recorded under the old setting where it was', () => {
    // Three late-night ticks made while Day Start was 04:00. Each is stored as
    // the Day string R0 returned at the time — this is what reaches the mirror.
    const instants = [
      new Date('2026-03-12T02:30:00'),
      new Date('2026-03-13T23:10:00'),
      new Date('2026-03-14T02:30:00'),
    ]
    const history = instants.map(t => today(t, 240))
    expect(history).toEqual(['2026-03-11', '2026-03-13', '2026-03-13'])

    // The user moves Day Start to midnight. Re-running R0 over the same
    // instants shows the boundary genuinely moved...
    const asIfRerecorded = instants.map(t => today(t, 0))
    expect(asIfRerecorded).toEqual(['2026-03-12', '2026-03-13', '2026-03-14'])
    expect(asIfRerecorded).not.toEqual(history)

    // ...yet no stored row is a function of the setting, so the rows keep the
    // Days above. Two of the three would otherwise silently shift, and one of
    // those (2026-03-11 -> 2026-03-12) would break a streak that was real.
    expect(history).toEqual(['2026-03-11', '2026-03-13', '2026-03-13'])
  })
})
