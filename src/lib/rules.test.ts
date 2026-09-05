import { describe, expect, it } from 'vitest'
import { OUT_OF_RANGE, completionsEarlierInWeek, isScheduled, resolveSchedule } from './rules'
import type { Habit, HabitSchedule, Weight } from './types'

const TODAY = '2026-09-05' // a Saturday

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

describe('R1 · resolveSchedule', () => {
  it('returns OUT_OF_RANGE before the Start Date', () => {
    expect(resolveSchedule(habit({ start_date: '2026-03-01' }), [schedule()], '2026-02-28', TODAY))
      .toBe(OUT_OF_RANGE)
  })

  it('returns OUT_OF_RANGE on and after the Archive date', () => {
    const h = habit({ archived_at: '2026-06-01' })
    expect(resolveSchedule(h, [schedule()], '2026-06-01', TODAY)).toBe(OUT_OF_RANGE)
    expect(resolveSchedule(h, [schedule()], '2026-05-31', TODAY)).not.toBe(OUT_OF_RANGE)
  })

  it('returns OUT_OF_RANGE for future days', () => {
    expect(resolveSchedule(habit(), [schedule()], '2026-09-06', TODAY)).toBe(OUT_OF_RANGE)
  })

  it('includes today itself', () => {
    expect(resolveSchedule(habit(), [schedule()], TODAY, TODAY)).not.toBe(OUT_OF_RANGE)
  })

  // ADR 0004: the whole point of effective-dating.
  it('judges a historical day against the schedule in force then, not the current one', () => {
    const schedules = [
      schedule({ effective_from: '2026-01-01', cadence_type: 'daily', weight: 3 as Weight }),
      schedule({ effective_from: '2026-06-01', cadence_type: 'weekly_quota', weekly_target: 3, weight: 1 as Weight }),
    ]
    const before = resolveSchedule(habit(), schedules, '2026-05-15', TODAY)
    const after = resolveSchedule(habit(), schedules, '2026-07-15', TODAY)

    expect(before).toMatchObject({ cadence_type: 'daily', weight: 3 })
    expect(after).toMatchObject({ cadence_type: 'weekly_quota', weekly_target: 3, weight: 1 })
  })

  it('takes the latest schedule at or before the day, regardless of array order', () => {
    const schedules = [
      schedule({ effective_from: '2026-06-01', cadence_type: 'weekly_quota', weekly_target: 2 }),
      schedule({ effective_from: '2026-01-01', cadence_type: 'daily' }),
      schedule({ effective_from: '2026-03-01', cadence_type: 'weekdays', weekdays: [1, 3, 5] }),
    ]
    expect(resolveSchedule(habit(), schedules, '2026-04-01', TODAY)).toMatchObject({ cadence_type: 'weekdays' })
  })

  it('ignores schedules belonging to other habits and tombstoned rows', () => {
    const schedules = [
      schedule({ effective_from: '2026-01-01', cadence_type: 'daily' }),
      schedule({ effective_from: '2026-05-01', cadence_type: 'weekly_quota', weekly_target: 5, habit_id: 'other' }),
      schedule({ effective_from: '2026-06-01', cadence_type: 'weekly_quota', weekly_target: 5, deleted_at: 'x' }),
    ]
    expect(resolveSchedule(habit(), schedules, '2026-07-01', TODAY)).toMatchObject({ cadence_type: 'daily' })
  })

  it('returns OUT_OF_RANGE when no schedule is yet in force', () => {
    expect(resolveSchedule(habit(), [schedule({ effective_from: '2026-08-01' })], '2026-03-01', TODAY))
      .toBe(OUT_OF_RANGE)
  })
})

describe('R2 · isScheduled — daily and weekdays', () => {
  const none = new Set<string>()

  it('schedules a daily habit every day', () => {
    expect(isScheduled(habit(), [schedule()], '2026-09-02', TODAY, none)).toBe(true)
  })

  it('schedules a weekdays habit only on its weekdays', () => {
    const s = [schedule({ cadence_type: 'weekdays', weekdays: [1, 3, 5] })]
    expect(isScheduled(habit(), s, '2026-08-31', TODAY, none)).toBe(true)  // Monday
    expect(isScheduled(habit(), s, '2026-09-01', TODAY, none)).toBe(false) // Tuesday
    expect(isScheduled(habit(), s, '2026-09-04', TODAY, none)).toBe(true)  // Friday
    expect(isScheduled(habit(), s, '2026-09-05', TODAY, none)).toBe(false) // Saturday
  })

  it('never schedules an out-of-range day', () => {
    expect(isScheduled(habit(), [schedule()], '2026-09-06', TODAY, none)).toBe(false)
  })
})

describe('R2 · isScheduled — weekly quota', () => {
  const s = [schedule({ cadence_type: 'weekly_quota', weekly_target: 3 })]
  // ISO week of 2026-08-31 (Mon) .. 2026-09-06 (Sun)

  it('is owed every day while the quota is unmet', () => {
    const done = new Set(['2026-08-31'])
    expect(isScheduled(habit(), s, '2026-09-01', TODAY, done)).toBe(true)
    expect(isScheduled(habit(), s, '2026-09-02', TODAY, done)).toBe(true)
  })

  it('drops out of the denominator once the quota is met', () => {
    const done = new Set(['2026-08-31', '2026-09-01', '2026-09-02'])
    expect(isScheduled(habit(), s, '2026-09-03', TODAY, done)).toBe(false)
    expect(isScheduled(habit(), s, '2026-09-04', TODAY, done)).toBe(false)
  })

  it('still counts the day that completes the quota', () => {
    // Two done before Wednesday, so Wednesday is the third and is still owed.
    const done = new Set(['2026-08-31', '2026-09-01', '2026-09-02'])
    expect(isScheduled(habit(), s, '2026-09-02', TODAY, done)).toBe(true)
  })

  it('resets when the week rolls over', () => {
    const done = new Set(['2026-08-24', '2026-08-25', '2026-08-26']) // previous week
    expect(isScheduled(habit(), s, '2026-08-31', TODAY, done)).toBe(true)
  })

  it('counts only completions earlier in the same ISO week', () => {
    const done = new Set(['2026-08-30', '2026-08-31', '2026-09-01']) // 30th is the prior Sunday
    expect(completionsEarlierInWeek('2026-09-02', done)).toBe(2)
  })
})
