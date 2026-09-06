import { describe, expect, it } from 'vitest'
import { habitStats, windowSpan } from './stats'
import { addDays } from './calendar'
import type { Day, EntryKind, Habit, HabitSchedule, Weight } from './types'

/**
 * R8. TODAY is a Saturday, so a 30-day window ends mid-week — deliberately, to
 * keep the weekly-unit cases from being accidentally aligned.
 */
const TODAY: Day = '2026-09-05'

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 'Gym', colour: 'emerald',
    start_date: '2026-01-01', archived_at: null, sort_order: 0,
    updated_at: '', deleted_at: null, ...over,
  }
}

function schedule(over: Partial<HabitSchedule> = {}): HabitSchedule {
  return {
    id: `s${Math.random()}`, habit_id: 'h1', user_id: 'u1',
    effective_from: '2026-01-01', cadence_type: 'daily',
    weekdays: null, weekly_target: null, weight: 2 as Weight,
    updated_at: '', deleted_at: null, ...over,
  }
}

/** Completions on the given Days. */
const done = (...days: Day[]): Map<Day, EntryKind> =>
  new Map(days.map(d => [d, 'completed' as EntryKind]))

/** `count` consecutive Days starting at `from`. */
const run = (from: Day, count: number): Day[] =>
  Array.from({ length: count }, (_, i) => addDays(from, i))

describe('windowSpan', () => {
  it('counts the window inclusive of today', () => {
    expect(windowSpan(TODAY, 7, '2026-01-01')).toEqual({ from: '2026-08-30', to: TODAY })
  })

  it('runs all-time from the Start Date, not from a fixed horizon', () => {
    expect(windowSpan(TODAY, 'all', '2026-08-20')).toEqual({ from: '2026-08-20', to: TODAY })
  })
})

/**
 * Trap 1: the unit must match the cadence.
 *
 * A weekly-quota habit measured in days is the headline failure — hitting a
 * 3x/week target every single week is perfect behaviour, and counting days
 * would report roughly 43% for it.
 */
describe('R8 · the unit follows the cadence', () => {
  const weekly = habit({ start_date: '2026-08-03' })   // a Monday
  const weeklySchedule = [schedule({
    effective_from: '2026-08-03', cadence_type: 'weekly_quota',
    weekdays: null, weekly_target: 3,
  })]

  it('scores a quota-meeting weekly habit at 100%, not at 3/7', () => {
    // Three completions in each of the four full weeks before this one.
    const days = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']
      .flatMap(monday => [monday, addDays(monday, 2), addDays(monday, 4)])

    const s = habitStats(weekly, weeklySchedule, done(...days), TODAY, 30)
    expect(s.unit).toBe('week')
    expect(s.current.rate).toBe(1)
    // Weeks, not days. Twelve completions over the window; three weeks scored.
    expect(s.current.opportunities).toBe(3)
    expect(s.current.hits).toBe(3)
  })

  /**
   * A week only partly inside the window is dropped, not judged.
   *
   * The 30-day window opens on Friday 7 Aug, mid-way through the week of the
   * 3rd. Scoring that week would ask for three sessions in the two days that
   * fall inside the window, so its anchor being outside excludes it whole. The
   * cost is that a "30 days" window really scores 21 — which is why the UI
   * reports the unit count rather than the window length.
   */
  it('excludes a week whose Monday falls outside the window', () => {
    const days = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']
      .flatMap(monday => [monday, addDays(monday, 2), addDays(monday, 4)])
    const s = habitStats(weekly, weeklySchedule, done(...days), TODAY, 30)
    expect(s.current.span.from).toBe('2026-08-07')
    expect(s.current.opportunities).toBe(3)   // 10, 17 and 24 Aug; not the 3rd
  })

  it('counts a week that fell short as one missed week', () => {
    const days = [
      ...['2026-08-03', '2026-08-10', '2026-08-24']
        .flatMap(m => [m, addDays(m, 2), addDays(m, 4)]),
      '2026-08-17',                            // only one of three
    ]
    const s = habitStats(weekly, weeklySchedule, done(...days), TODAY, 30)
    expect(s.current.opportunities).toBe(3)
    expect(s.current.hits).toBe(2)
    expect(s.current.rate).toBeCloseTo(2 / 3)
  })

  it('measures a weekday habit in Scheduled Days', () => {
    const h = habit({ start_date: '2026-08-03' })
    const sch = [schedule({
      effective_from: '2026-08-03', cadence_type: 'weekdays', weekdays: [1, 3, 5],
    })]
    // Every Mon/Wed/Fri from 3 Aug through 4 Sep: 15 scheduled days.
    const days = run('2026-08-03', 33).filter(d => {
      const wd = new Date(`${d}T00:00:00`).getDay()
      return wd === 1 || wd === 3 || wd === 5
    })
    const s = habitStats(h, sch, done(...days), TODAY, 'all')
    expect(s.unit).toBe('day')
    expect(s.current.rate).toBe(1)
    expect(s.current.opportunities).toBe(15)
  })
})

/**
 * Trap 2: the denominator must exclude untracked time.
 *
 * Without this a habit created five days ago opens at 5/90 and the V2-3 ranking
 * measures nothing but how old each habit is.
 */
describe('R8 · the denominator excludes untracked time', () => {
  it('gives a five-day-old habit five opportunities, not ninety', () => {
    const start = addDays(TODAY, -4)
    const h = habit({ start_date: start })
    const sch = [schedule({ effective_from: start })]
    const s = habitStats(h, sch, done(...run(start, 5)), TODAY, 90)
    expect(s.current.opportunities).toBe(5)
    expect(s.current.rate).toBe(1)
  })

  it('stops counting at the Archive date', () => {
    const h = habit({ start_date: '2026-08-20', archived_at: '2026-08-25' })
    const sch = [schedule({ effective_from: '2026-08-20' })]
    // Archived on the 25th, so the 20th-24th are the only opportunities.
    const s = habitStats(h, sch, done(...run('2026-08-20', 5)), TODAY, 30)
    expect(s.current.opportunities).toBe(5)
    expect(s.current.rate).toBe(1)
  })

  it('reports no rate at all when the window holds nothing', () => {
    const h = habit({ start_date: TODAY })
    const sch = [schedule({ effective_from: TODAY })]
    // The only day in range is today, which is pending rather than failed.
    const s = habitStats(h, sch, new Map(), TODAY, 30)
    expect(s.current.opportunities).toBe(0)
    expect(s.current.rate).toBeNull()
  })

  it('does not count an unfinished today as a miss', () => {
    const h = habit({ start_date: '2026-09-01' })
    const sch = [schedule({ effective_from: '2026-09-01' })]
    const s = habitStats(h, sch, done(...run('2026-09-01', 4)), TODAY, 30)
    expect(s.current.opportunities).toBe(4)   // 1-4 Sep; the 5th is pending
    expect(s.current.rate).toBe(1)
  })
})

describe('R8 · a cadence change inside the window', () => {
  const h = habit({ start_date: '2026-08-03' })
  const sch = [
    schedule({ effective_from: '2026-08-03', cadence_type: 'daily' }),
    schedule({
      effective_from: '2026-08-24', cadence_type: 'weekly_quota',
      weekdays: null, weekly_target: 2,
    }),
  ]

  it('drops the older regime rather than adding weeks to days', () => {
    // Daily and perfect for three weeks, then two quota-meeting weeks.
    const daily = run('2026-08-03', 21)
    const weekly = ['2026-08-24', '2026-08-26', '2026-08-31', '2026-09-02']
    const s = habitStats(h, sch, done(...daily, ...weekly), TODAY, 30)

    expect(s.unit).toBe('week')
    // Only the two weeks under the new cadence. The current week counts because
    // its quota is already met -- a target hit on Wednesday is not still
    // pending on Saturday (R4).
    expect(s.current.opportunities).toBe(2)
    expect(s.current.hits).toBe(2)
    // The 21 perfect days under the old cadence did not leak into a count of
    // weeks, which is the whole point.
    expect(s.current.opportunities).toBeLessThan(21)
  })

  it('keeps daily and weekday history together, since both accrue per day', () => {
    const h2 = habit({ start_date: '2026-08-24' })
    const sch2 = [
      schedule({ effective_from: '2026-08-24', cadence_type: 'daily' }),
      schedule({ effective_from: '2026-08-31', cadence_type: 'weekdays', weekdays: [1, 2, 3, 4, 5] }),
    ]
    // 24-30 Aug daily (7 days), then Mon-Fri 31 Aug-4 Sep (5 days).
    const s = habitStats(h2, sch2, done(...run('2026-08-24', 12)), TODAY, 30)
    expect(s.unit).toBe('day')
    expect(s.current.opportunities).toBe(12)
    expect(s.current.rate).toBe(1)
  })
})

describe('R8 · trend', () => {
  const h = habit({ start_date: '2026-01-01' })
  const sch = [schedule({ effective_from: '2026-01-01' })]

  it('reports a decline against the previous window', () => {
    // Previous 7 days (23-29 Aug) perfect; current 7 (30 Aug-5 Sep) at 2 of 6.
    const days = [...run('2026-08-23', 7), '2026-08-30', '2026-08-31']
    const s = habitStats(h, sch, done(...days), TODAY, 7)
    expect(s.previous!.rate).toBe(1)
    expect(s.current.rate).toBeCloseTo(2 / 6)   // the 5th is pending
    expect(s.trend.direction).toBe('down')
    expect(s.trend.delta).toBeCloseTo(2 / 6 - 1)
  })

  it('reports a rise', () => {
    const days = ['2026-08-23', ...run('2026-08-30', 6)]
    const s = habitStats(h, sch, done(...days), TODAY, 7)
    expect(s.trend.direction).toBe('up')
  })

  it('calls a small movement steady rather than a direction', () => {
    // 30-day windows: 28 of 29 now against 30 of 30 before, 3.4 points apart.
    const previous = run('2026-07-08', 30)
    const current = run('2026-08-07', 28)
    const s = habitStats(h, sch, done(...previous, ...current), TODAY, 30)
    expect(Math.abs(s.trend.delta!)).toBeLessThan(0.05)
    expect(s.trend.direction).toBe('steady')
  })

  /**
   * The case that matters most: a habit too new to have a previous window must
   * say so rather than showing a plunge from nothing.
   */
  it('says insufficient when there is no previous window', () => {
    const young = habit({ start_date: '2026-08-30' })
    const s = habitStats(young, [schedule({ effective_from: '2026-08-30' })],
      done(...run('2026-08-30', 6)), TODAY, 7)
    expect(s.current.rate).toBe(1)
    expect(s.previous!.opportunities).toBe(0)
    expect(s.trend.direction).toBe('insufficient')
    expect(s.trend.delta).toBeNull()
  })

  it('says insufficient when the previous window is too thin to compare', () => {
    // The previous window is 23-29 Aug; starting on the 27th leaves three
    // opportunities in it, one short of what a comparison needs.
    const young = habit({ start_date: '2026-08-27' })
    const s = habitStats(young, [schedule({ effective_from: '2026-08-27' })],
      done(...run('2026-08-27', 9)), TODAY, 7)
    expect(s.previous!.opportunities).toBe(3)
    expect(s.trend.direction).toBe('insufficient')
  })

  it('has no previous window for all-time', () => {
    const s = habitStats(h, sch, done(...run('2026-08-01', 30)), TODAY, 'all')
    expect(s.previous).toBeNull()
    expect(s.trend.direction).toBe('insufficient')
  })
})
