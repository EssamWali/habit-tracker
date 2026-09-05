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

import { cellState, streaks } from './rules'
import type { Day, EntryKind } from './types'

const entryMap = (done: Day[], frozen: Day[] = []): Map<Day, EntryKind> => {
  const m = new Map<Day, EntryKind>()
  for (const d of done) m.set(d, 'completed')
  for (const d of frozen) m.set(d, 'frozen')
  return m
}
const range = (from: Day, count: number): Day[] => {
  const out: Day[] = []
  let d = from
  for (let i = 0; i < count; i++) { out.push(d); const x = new Date(d); x.setDate(x.getDate() + 1); d = x.toISOString().slice(0, 10) }
  return out
}

describe('R3 · cellState', () => {
  const none = new Set<string>()

  it('reports out_of_range before the start date and in the future', () => {
    const h = habit({ start_date: '2026-03-01' })
    expect(cellState(h, [schedule()], '2026-02-28', TODAY, new Map(), none)).toBe('out_of_range')
    expect(cellState(h, [schedule()], '2026-09-06', TODAY, new Map(), none)).toBe('out_of_range')
  })

  it('reports completed and frozen from the entry', () => {
    const e = entryMap(['2026-09-01'], ['2026-09-02'])
    expect(cellState(habit(), [schedule()], '2026-09-01', TODAY, e, new Set(['2026-09-01']))).toBe('completed')
    expect(cellState(habit(), [schedule()], '2026-09-02', TODAY, e, new Set(['2026-09-01']))).toBe('frozen')
  })

  it('reports missed for an un-done scheduled day', () => {
    expect(cellState(habit(), [schedule()], '2026-09-01', TODAY, new Map(), none)).toBe('missed')
  })

  it('reports unscheduled on a weekday habit off-day', () => {
    const s = [schedule({ cadence_type: 'weekdays', weekdays: [1, 3, 5] })]
    expect(cellState(habit(), s, '2026-09-05', TODAY, new Map(), none)).toBe('unscheduled') // Saturday
  })

  // The resolution from round 5: weekly habits fail per week, never per day.
  it('NEVER reports missed for a weekly-quota habit', () => {
    const s = [schedule({ cadence_type: 'weekly_quota', weekly_target: 3 })]
    for (const day of range('2026-08-31', 5)) {
      expect(cellState(habit(), s, day, TODAY, new Map(), none)).toBe('unscheduled')
    }
  })
})

describe('R4 · streaks — daily', () => {
  const s = [schedule({ cadence_type: 'daily' })]
  const h = habit({ start_date: '2026-08-01' })

  it('counts consecutive completions', () => {
    const done = range('2026-08-20', 5)
    expect(streaks(h, s, entryMap(done), TODAY).longest).toBe(5)
  })

  it('gilds a whole run retroactively once it reaches seven', () => {
    const done = range('2026-08-20', 7)
    const r = streaks(h, s, entryMap(done), TODAY)
    expect(r.gold.size).toBe(7)
    for (const d of done) expect(r.gold.has(d)).toBe(true)
  })

  it('does not gild a run of six', () => {
    expect(streaks(h, s, entryMap(range('2026-08-20', 6)), TODAY).gold.size).toBe(0)
  })

  it('keeps gold after the streak breaks', () => {
    // 8 days, a gap, then 2 more. The first run stays gold.
    const done = [...range('2026-08-01', 8), ...range('2026-08-20', 2)]
    const r = streaks(h, s, entryMap(done), TODAY)
    expect(r.gold.size).toBe(8)
    expect(r.current).toBe(0)
  })

  it('awards the second tier at thirty', () => {
    const done = range('2026-08-01', 30)
    const r = streaks(h, s, entryMap(done), TODAY)
    expect(r.tier2.size).toBe(30)
  })

  it('lets a Freeze preserve a run without extending it', () => {
    // 4 done, one frozen, 3 done = length 7 across 8 days.
    const done = [...range('2026-08-01', 4), ...range('2026-08-06', 3)]
    const r = streaks(h, s, entryMap(done, ['2026-08-05']), TODAY)
    expect(r.longest).toBe(7)
    expect(r.gold.size).toBe(7)          // the frozen day is not a completion
    expect(r.gold.has('2026-08-05')).toBe(false)
  })

  it('treats an unfinished today as pending, not as a break', () => {
    const done = range('2026-08-30', 6) // through 2026-09-04, today not done
    expect(streaks(h, s, entryMap(done), TODAY).current).toBe(6)
  })
})

describe('R4 · streaks — weekly quota', () => {
  const s = [schedule({ cadence_type: 'weekly_quota', weekly_target: 3, effective_from: '2026-06-01' })]
  const h = habit({ start_date: '2026-06-01' })

  it('counts quota-meeting weeks, not days', () => {
    const done = [
      '2026-08-03', '2026-08-04', '2026-08-05',
      '2026-08-10', '2026-08-11', '2026-08-12',
    ]
    expect(streaks(h, s, entryMap(done), TODAY).longest).toBe(2)
  })

  it('gilds at four consecutive weeks, not seven', () => {
    const done: Day[] = []
    for (let w = 0; w < 4; w++) {
      const monday = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'][w]!
      done.push(monday, ...range(monday, 3).slice(1))
    }
    const r = streaks(h, s, entryMap(done), TODAY)
    expect(r.longest).toBe(4)
    expect(r.gold.size).toBeGreaterThan(0)
  })

  it('breaks when a week misses quota', () => {
    const done = [
      '2026-08-03', '2026-08-04', '2026-08-05',
      '2026-08-10',                                  // only one — quota missed
      '2026-08-17', '2026-08-18', '2026-08-19',
    ]
    expect(streaks(h, s, entryMap(done), TODAY).longest).toBe(1)
  })
})

describe('R4 · streaks — cadence change', () => {
  it('ends a run when the cadence type changes', () => {
    const h = habit({ start_date: '2026-08-01' })
    const s = [
      schedule({ effective_from: '2026-08-01', cadence_type: 'daily' }),
      schedule({ effective_from: '2026-08-15', cadence_type: 'weekly_quota', weekly_target: 3 }),
    ]
    const done = range('2026-08-01', 14) // a clean 14-day daily run, then the switch
    const r = streaks(h, s, entryMap(done), TODAY)
    expect(r.longest).toBe(14)
    expect(r.gold.size).toBe(14)
  })
})
