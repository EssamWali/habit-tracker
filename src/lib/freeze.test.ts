import { describe, expect, it } from 'vitest'
import { canFreeze, freezeTokens, isFlawlessMonth, FREEZE_CAP } from './rules'
import { addDays, endOfMonth, startOfMonth } from './calendar'
import type { Day, EntryKind, Habit, HabitSchedule, Weight } from './types'

/**
 * R6 and R7.
 *
 * v3's risk is a reward system that can be gamed, so most of these tests are
 * loops that must not exist rather than features that must work.
 */

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 'Gym', colour: 'emerald',
    start_date: '2026-01-01', archived_at: null, sort_order: 0,
    updated_at: '', deleted_at: null, ...over,
  }
}

function schedule(over: Partial<HabitSchedule> = {}): HabitSchedule {
  return {
    id: `s-${over.effective_from ?? 'base'}`, habit_id: 'h1', user_id: 'u1',
    effective_from: '2026-01-01', cadence_type: 'daily',
    weekdays: null, weekly_target: null, weight: 2 as Weight,
    updated_at: '', deleted_at: null, ...over,
  }
}

/** Every Day of a month, completed. */
function fullMonth(month: string, kind: EntryKind = 'completed'): [Day, EntryKind][] {
  const out: [Day, EntryKind][] = []
  for (let d = startOfMonth(month); d <= endOfMonth(month); d = addDays(d, 1)) out.push([d, kind])
  return out
}

const map = (...pairs: [Day, EntryKind][]) => new Map<Day, EntryKind>(pairs)

const DAILY = [schedule()]

/* ------------------------------------------------------------------ R6 --- */

describe('R6 · isFlawlessMonth', () => {
  const h = habit()
  const TODAY: Day = '2026-04-01'

  it('is true for a month with every Scheduled Day completed', () => {
    expect(isFlawlessMonth(h, DAILY, '2026-03', map(...fullMonth('2026-03')), TODAY)).toBe(true)
  })

  it('is false when a single day was missed', () => {
    const entries = map(...fullMonth('2026-03').filter(([d]) => d !== '2026-03-14'))
    expect(isFlawlessMonth(h, DAILY, '2026-03', entries, TODAY)).toBe(false)
  })

  /**
   * The loop that must not exist.
   *
   * If a Freeze did not disqualify, spending a token could produce the Flawless
   * Month that refunds it, and tokens would be free.
   */
  it('is false for a month whose only blemish is a Freeze', () => {
    const entries = map(
      ...fullMonth('2026-03').filter(([d]) => d !== '2026-03-14'),
      ['2026-03-14', 'frozen'],
    )
    expect(isFlawlessMonth(h, DAILY, '2026-03', entries, TODAY)).toBe(false)
  })

  /**
   * Where the Freeze rule is actually load-bearing.
   *
   * For a daily habit the frozen day also lacks a Completion, so the month
   * fails anyway. A weekly quota is the case the explicit check exists for: the
   * week can meet its target *around* the frozen day, leaving nothing else to
   * fail on — and a Flawless Month there would refund the very token that was
   * spent. Removing the check breaks only this test, which is how it was found.
   */
  it('is false when a met weekly quota would otherwise hide a Freeze', () => {
    const sch = [schedule({ cadence_type: 'weekly_quota', weekdays: null, weekly_target: 2 })]
    const wholeWeeks = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']
    const entries = map(
      ...wholeWeeks.flatMap(monday =>
        [[monday, 'completed'], [addDays(monday, 2), 'completed']] as [Day, EntryKind][]),
      ['2026-03-19', 'frozen'],      // a Thursday, in a week that already met quota
    )
    expect(isFlawlessMonth(h, sch, '2026-03', entries, TODAY)).toBe(false)
  })

  it('is false for a partial month, however clean', () => {
    // Created on the 20th and perfect since. Not the same achievement as a
    // whole clean month, and rewarding it equally would make the 28th of the
    // month the cheapest time to start a habit.
    const late = habit({ start_date: '2026-03-20' })
    const entries = map(...fullMonth('2026-03').filter(([d]) => d >= '2026-03-20'))
    expect(isFlawlessMonth(late, DAILY, '2026-03', entries, TODAY)).toBe(false)
  })

  it('is false for a month the habit was archived during', () => {
    const archived = habit({ archived_at: '2026-03-20' })
    expect(isFlawlessMonth(archived, DAILY, '2026-03', map(...fullMonth('2026-03')), TODAY)).toBe(false)
  })

  it('is false for a month that has not finished', () => {
    expect(isFlawlessMonth(h, DAILY, '2026-04', map(...fullMonth('2026-04')), '2026-04-10')).toBe(false)
  })

  it('ignores days the cadence never scheduled', () => {
    const sch = [schedule({ cadence_type: 'weekdays', weekdays: [1, 3, 5] })]
    const mondays = fullMonth('2026-03').filter(([d]) => {
      const wd = new Date(`${d}T00:00:00`).getDay()
      return wd === 1 || wd === 3 || wd === 5
    })
    expect(isFlawlessMonth(h, sch, '2026-03', map(...mondays), TODAY)).toBe(true)
  })

  it('is false when a month owed nothing at all', () => {
    // A cadence with no scheduled days in the month is not an achievement.
    const sch = [schedule({ cadence_type: 'weekdays', weekdays: [] })]
    expect(isFlawlessMonth(h, sch, '2026-03', map(), TODAY)).toBe(false)
  })

  describe('weekly quota', () => {
    const sch = [schedule({
      cadence_type: 'weekly_quota', weekdays: null, weekly_target: 2,
    })]

    /**
     * March 2026 starts on a Sunday, so its whole ISO weeks are 2-8, 9-15,
     * 16-22 and 23-29. The 1st and the 30th-31st sit in weeks that straddle a
     * boundary and belong to neither month.
     */
    const wholeWeeks = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']

    it('is true when every whole week met its quota', () => {
      const entries = map(...wholeWeeks.flatMap(monday =>
        [[monday, 'completed'], [addDays(monday, 2), 'completed']] as [Day, EntryKind][]))
      expect(isFlawlessMonth(h, sch, '2026-03', entries, TODAY)).toBe(true)
    })

    it('is false when one whole week fell short', () => {
      const entries = map(...wholeWeeks.flatMap(monday =>
        monday === '2026-03-16'
          ? [[monday, 'completed']] as [Day, EntryKind][]
          : [[monday, 'completed'], [addDays(monday, 2), 'completed']] as [Day, EntryKind][]))
      expect(isFlawlessMonth(h, sch, '2026-03', entries, TODAY)).toBe(false)
    })

    it('does not fail the month for a short straddling week', () => {
      // The week of 30 March runs into April and is judged by neither month:
      // a quota cannot fairly be demanded of two days.
      const entries = map(...wholeWeeks.flatMap(monday =>
        [[monday, 'completed'], [addDays(monday, 2), 'completed']] as [Day, EntryKind][]))
      expect(isFlawlessMonth(h, sch, '2026-03', entries, TODAY)).toBe(true)
    })
  })
})

/* ------------------------------------------------------------------ R7 --- */

describe('R7 · freezeTokens', () => {
  const h = habit({ start_date: '2026-01-01' })

  it('grants one in the first month', () => {
    expect(freezeTokens(h, DAILY, map(), '2026-01-15')).toBe(1)
  })

  it('expires an unused grant after an imperfect month', () => {
    // January was missed all over, so its grant does not survive; February
    // grants a fresh one.
    expect(freezeTokens(h, DAILY, map(), '2026-02-15')).toBe(1)
  })

  it('carries the grant over after a Flawless Month', () => {
    const entries = map(...fullMonth('2026-01'))
    expect(freezeTokens(h, DAILY, entries, '2026-02-15')).toBe(2)
  })

  it('stacks across consecutive Flawless Months', () => {
    const entries = map(...fullMonth('2026-01'), ...fullMonth('2026-02'))
    expect(freezeTokens(h, DAILY, entries, '2026-03-15')).toBe(3)
  })

  it('caps the bank', () => {
    const entries = map(
      ...fullMonth('2026-01'), ...fullMonth('2026-02'),
      ...fullMonth('2026-03'), ...fullMonth('2026-04'),
    )
    expect(freezeTokens(h, DAILY, entries, '2026-05-15')).toBe(FREEZE_CAP)
  })

  /**
   * A bad month must not empty the bank.
   *
   * Q23 made stacking conditional on a clean month; it did not make the stack
   * destructible by a dirty one. Only that month's own grant expires.
   */
  it('keeps banked tokens through an imperfect month', () => {
    const entries = map(...fullMonth('2026-01'), ...fullMonth('2026-02'))
    expect(freezeTokens(h, DAILY, entries, '2026-03-15')).toBe(3)   // 2 banked + March grant
    // March is a write-off, but the two banked tokens survive into April.
    expect(freezeTokens(h, DAILY, entries, '2026-04-15')).toBe(3)   // 2 banked + April grant
    expect(freezeTokens(h, DAILY, entries, '2026-05-15')).toBe(3)
  })

  it('spends one per Frozen entry', () => {
    const entries = map(...fullMonth('2026-01'), ['2026-02-03', 'frozen'])
    expect(freezeTokens(h, DAILY, entries, '2026-02-15')).toBe(1)   // 2 granted, 1 spent
  })

  /**
   * A Freeze is dated by the Day it protects, not the day it was applied. The
   * spend has to land in that Day's month and before that month's expiry runs,
   * or the token evaporates and returns as a negative balance.
   */
  it('charges a cross-month Freeze to the month it protects', () => {
    const entries = map(...fullMonth('2026-01'), ['2026-01-31', 'frozen'])

    // The freeze lands in January, which is therefore no longer Flawless, so
    // nothing carries over -- but the spend was covered by January's own grant
    // rather than leaving a debt.
    expect(freezeTokens(h, DAILY, entries, '2026-02-15')).toBe(1)
  })

  it('ignores a Freeze dated after the day being asked about', () => {
    const entries = map(['2026-01-20', 'frozen'])
    expect(freezeTokens(h, DAILY, entries, '2026-01-10')).toBe(1)
    expect(freezeTokens(h, DAILY, entries, '2026-01-25')).toBe(0)
  })
})

/* ----------------------------------------------------------- eligibility -- */

describe('canFreeze', () => {
  const h = habit({ start_date: '2026-01-01' })
  const TODAY: Day = '2026-02-10'
  // One month of perfect history, so there is a token to spend.
  const history = fullMonth('2026-01')
  const completed = new Set<Day>(history.map(([d]) => d))

  const check = (day: Day, extra: [Day, EntryKind][] = []) => {
    const entries = map(...history, ...extra)
    const done = new Set(completed)
    for (const [d, k] of extra) if (k === 'completed') done.add(d)
    return canFreeze(h, DAILY, day, TODAY, entries, done)
  }

  it('allows a recent missed day when tokens are available', () => {
    expect(check('2026-02-08')).toBe(true)
  })

  it('refuses a day older than the lookback window', () => {
    expect(check('2026-02-01')).toBe('too-old')
  })

  it('refuses a future day', () => {
    expect(check('2026-02-11')).toBe('future')
  })

  // Freezing a completed day would silently downgrade a real Completion.
  it('refuses a day that was completed', () => {
    expect(check('2026-02-08', [['2026-02-08', 'completed']])).toBe('not-missed')
  })

  // Freezing an unscheduled day would bank tokens against days never owed.
  it('refuses a day the cadence never scheduled', () => {
    const sch = [schedule({ cadence_type: 'weekdays', weekdays: [1] })]   // Mondays
    // 2026-02-08 is a Sunday.
    expect(canFreeze(h, sch, '2026-02-08', TODAY, map(...history), completed)).toBe('not-missed')
  })

  it('refuses when the balance is empty', () => {
    // No history at all, and February's grant already spent.
    const bare = map(['2026-02-05', 'frozen'])
    expect(canFreeze(h, DAILY, '2026-02-08', TODAY, bare, new Set())).toBe('no-tokens')
  })
})
