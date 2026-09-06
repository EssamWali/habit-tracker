import { describe, expect, it } from 'vitest'
import { nothingOutstanding } from './reminder'
import type { Day, EntryKind, Habit, HabitSchedule, Weight } from './types'

/**
 * V2-6's suppression rule: "a notification always means something."
 *
 * This is the whole reason the reminder job has no rules engine of its own. The
 * answer is computed here, from R5, and written to profiles.last_clear_day; the
 * server only compares two dates.
 */

const TODAY: Day = '2026-09-05'   // a Saturday

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 'Gym', colour: 'emerald',
    start_date: '2026-08-01', archived_at: null, sort_order: 0,
    updated_at: '', deleted_at: null, ...over,
  }
}

function schedule(over: Partial<HabitSchedule> = {}): HabitSchedule {
  return {
    id: `s-${over.habit_id ?? 'h1'}`, habit_id: 'h1', user_id: 'u1',
    effective_from: '2026-08-01', cadence_type: 'daily',
    weekdays: null, weekly_target: null, weight: 2 as Weight,
    updated_at: '', deleted_at: null, ...over,
  }
}

const entries = (map: Record<string, Day[]>): Map<string, Map<Day, EntryKind>> =>
  new Map(Object.entries(map).map(([id, days]) =>
    [id, new Map(days.map(d => [d, 'completed' as EntryKind]))]))

describe('nothingOutstanding', () => {
  it('is clear when there is nothing scheduled at all', () => {
    // A rest day is not an outstanding day, and nudging about one would be the
    // empty notification Q16 exists to avoid.
    const h = habit({ id: 'h1' })
    const sch = [schedule({ cadence_type: 'weekdays', weekdays: [1, 2, 3] })]   // not Saturday
    expect(nothingOutstanding([h], sch, entries({}), TODAY)).toBe(true)
  })

  it('is clear with no habits whatsoever', () => {
    expect(nothingOutstanding([], [], entries({}), TODAY)).toBe(true)
  })

  it('is clear once every scheduled habit is done', () => {
    const a = habit({ id: 'a' })
    const b = habit({ id: 'b', name: 'Read' })
    const sch = [schedule({ habit_id: 'a' }), schedule({ habit_id: 'b' })]
    expect(nothingOutstanding([a, b], sch, entries({ a: [TODAY], b: [TODAY] }), TODAY)).toBe(true)
  })

  it('is not clear while one scheduled habit is outstanding', () => {
    const a = habit({ id: 'a' })
    const b = habit({ id: 'b', name: 'Read' })
    const sch = [schedule({ habit_id: 'a' }), schedule({ habit_id: 'b' })]
    expect(nothingOutstanding([a, b], sch, entries({ a: [TODAY] }), TODAY)).toBe(false)
  })

  /**
   * The Perfect Day trap, reached through a different door.
   *
   * A completion on a habit that was not scheduled today lifts the aggregate
   * ratio to 1 while a scheduled habit sits undone. Suppressing on the ratio
   * would silence exactly the reminder the user needed.
   */
  it('is not clear when a bonus completion masks a real miss', () => {
    const owed = habit({ id: 'owed' })
    const bonus = habit({ id: 'bonus', name: 'Mondays only' })
    const sch = [
      schedule({ habit_id: 'owed' }),
      // Today is a Saturday, so this one is not scheduled and its completion is
      // a bonus: it lifts the aggregate ratio without being owed.
      schedule({ habit_id: 'bonus', id: 's-bonus', cadence_type: 'weekdays', weekdays: [1] }),
    ]
    expect(nothingOutstanding([owed, bonus], sch, entries({ bonus: [TODAY] }), TODAY)).toBe(false)
  })

  it('ignores an archived habit', () => {
    const live = habit({ id: 'live' })
    const gone = habit({ id: 'gone', archived_at: '2026-09-01' })
    const sch = [schedule({ habit_id: 'live' }), schedule({ habit_id: 'gone', id: 's-gone' })]
    expect(nothingOutstanding([live, gone], sch, entries({ live: [TODAY] }), TODAY)).toBe(true)
  })

  it('ignores a habit that has not started yet', () => {
    const live = habit({ id: 'live' })
    const future = habit({ id: 'future', start_date: '2026-12-01' })
    const sch = [schedule({ habit_id: 'live' }), schedule({ habit_id: 'future', id: 's-future' })]
    expect(nothingOutstanding([live, future], sch, entries({ live: [TODAY] }), TODAY)).toBe(true)
  })

  describe('weekly quota', () => {
    const weekly = habit({ id: 'w', start_date: '2026-08-31' })   // the Monday
    const sch = [schedule({
      habit_id: 'w', id: 's-w', effective_from: '2026-08-31',
      cadence_type: 'weekly_quota', weekdays: null, weekly_target: 3,
    })]

    it('is not clear while the week is short of quota', () => {
      // Two done this week, one still owed, and today is untouched.
      expect(nothingOutstanding([weekly], sch, entries({ w: ['2026-08-31', '2026-09-02'] }), TODAY))
        .toBe(false)
    })

    it('is clear once the quota is met, even with today untouched', () => {
      // R2 stops treating a quota habit as owed the moment the target is hit,
      // so a met week must not keep nudging for the rest of it.
      expect(nothingOutstanding(
        [weekly], sch, entries({ w: ['2026-08-31', '2026-09-02', '2026-09-04'] }), TODAY,
      )).toBe(true)
    })
  })
})
