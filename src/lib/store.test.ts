import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { freezeDay, NOTE_MAX, setNote, toggleDay, unfreezeDay } from './store'
import { freezeTokens } from './rules'
import { addDays } from './calendar'
import type { DayEntry, Habit, HabitSchedule, Weight } from './types'

/**
 * The store's write path, against a real IndexedDB.
 *
 * These cover the transactional rules that no pure function can: that a write
 * lands in the mirror and the outbox together, and that adding a Note cannot
 * quietly become marking a day done.
 */

const USER = 'u1'
const HABIT = 'h1'
const DAY = '2026-09-05'

const entry = () => db.day_entries.get([HABIT, DAY]) as Promise<DayEntry | undefined>
const queued = () => db.outbox.where('key').equals(`${HABIT}|${DAY}`).toArray()

beforeEach(async () => {
  await db.day_entries.clear()
  await db.outbox.clear()
})

describe('toggleDay', () => {
  it('creates a Completion and queues it in one go', async () => {
    await toggleDay(USER, HABIT, DAY)

    const row = await entry()
    expect(row?.kind).toBe('completed')
    expect(row?.deleted_at).toBeNull()
    expect(await queued()).toHaveLength(1)
  })

  // Deleting the row would leave an offline device with no news that the
  // Completion was removed, so it would push its own copy back (ADR 0002).
  it('un-ticks by tombstoning rather than deleting', async () => {
    await toggleDay(USER, HABIT, DAY)
    await toggleDay(USER, HABIT, DAY)

    const row = await entry()
    expect(row).toBeDefined()
    expect(row?.deleted_at).not.toBeNull()
  })

  it('keeps a Note through an un-tick and brings it back', async () => {
    await toggleDay(USER, HABIT, DAY)
    await setNote(HABIT, DAY, 'felt strong')
    await toggleDay(USER, HABIT, DAY)

    expect((await entry())?.note).toBe('felt strong')

    await toggleDay(USER, HABIT, DAY)
    const row = await entry()
    expect(row?.deleted_at).toBeNull()
    expect(row?.note).toBe('felt strong')
  })
})

describe('setNote', () => {
  it('attaches a Note to a live Completion and queues the row', async () => {
    await toggleDay(USER, HABIT, DAY)
    await db.outbox.clear()

    await setNote(HABIT, DAY, '  ran 5k  ')
    expect((await entry())?.note).toBe('ran 5k')      // trimmed
    expect(await queued()).toHaveLength(1)
  })

  it('clears to null rather than to an empty string', async () => {
    await toggleDay(USER, HABIT, DAY)
    await setNote(HABIT, DAY, 'something')
    await setNote(HABIT, DAY, '   ')

    // "Has a note" must stay a single unambiguous test for the Cell marker.
    expect((await entry())?.note).toBeNull()
  })

  /**
   * The trap this ticket is most able to get wrong: a Note belongs to a
   * Completion, so writing one must never bring a day back to life.
   */
  it('does nothing when the day was un-ticked', async () => {
    await toggleDay(USER, HABIT, DAY)
    await toggleDay(USER, HABIT, DAY)
    const before = await entry()

    await setNote(HABIT, DAY, 'should not apply')

    const after = await entry()
    expect(after?.deleted_at).toBe(before?.deleted_at)   // still tombstoned
    expect(after?.note).toBeNull()
  })

  it('does nothing when there is no entry at all', async () => {
    await setNote(HABIT, DAY, 'nothing to attach to')
    expect(await entry()).toBeUndefined()
    expect(await queued()).toHaveLength(0)
  })

  /**
   * The column caps notes at 500 characters. A longer one is rejected on push,
   * and because a failed push aborts the whole cycle, it would stall every
   * other table's sync behind it.
   */
  it('clamps to the length the column accepts', async () => {
    await toggleDay(USER, HABIT, DAY)
    await setNote(HABIT, DAY, 'x'.repeat(NOTE_MAX + 250))

    expect((await entry())?.note).toHaveLength(NOTE_MAX)
  })
})

/* --------------------------------------------------------- V3-3 freezes -- */

const TODAY = '2026-02-10'

const gymHabit = (over: Partial<Habit> = {}): Habit => ({
  id: HABIT, user_id: USER, name: 'Gym', colour: 'emerald',
  start_date: '2026-01-01', archived_at: null, sort_order: 0,
  updated_at: '', deleted_at: null, ...over,
})

const dailySchedule = (over: Partial<HabitSchedule> = {}): HabitSchedule[] => ([{
  id: 's1', habit_id: HABIT, user_id: USER,
  effective_from: '2026-01-01', cadence_type: 'daily',
  weekdays: null, weekly_target: null, weight: 2 as Weight,
  updated_at: '', deleted_at: null, ...over,
}])

/** A Flawless January, so there is a banked token to spend in February. */
async function perfectJanuary() {
  await db.day_entries.clear()
  await db.outbox.clear()
  for (let d = '2026-01-01'; d <= '2026-01-31'; d = addDays(d, 1)) {
    await toggleDay(USER, HABIT, d)
  }
  await db.outbox.clear()
}

/** The habit's live entries, in the shape the rules take. */
async function ledger() {
  const rows = await db.day_entries.where('habit_id').equals(HABIT).toArray()
  return new Map(rows.filter(r => r.deleted_at === null).map(r => [r.day, r.kind]))
}

describe('freezeDay', () => {
  it('writes a frozen entry and spends a token', async () => {
    await perfectJanuary()
    const h = gymHabit()
    expect(freezeTokens(h, dailySchedule(), await ledger(), TODAY)).toBe(2)

    expect(await freezeDay(h, dailySchedule(), '2026-02-08', TODAY)).toBe(true)

    const row = await db.day_entries.get([HABIT, '2026-02-08'])
    expect(row?.kind).toBe('frozen')
    expect(row?.deleted_at).toBeNull()
    expect(await db.outbox.count()).toBe(1)
    expect(freezeTokens(h, dailySchedule(), await ledger(), TODAY)).toBe(1)
  })

  /**
   * Every refusal below is enforced here rather than only in the UI. Each is
   * either a minted token or a laundered Miss, and neither should depend on a
   * button being hidden.
   */
  it('refuses a day outside the lookback window', async () => {
    await perfectJanuary()
    expect(await freezeDay(gymHabit(), dailySchedule(), '2026-02-01', TODAY)).toBe('too-old')
    expect(await db.day_entries.get([HABIT, '2026-02-01'])).toBeUndefined()
  })

  it('refuses a future day', async () => {
    await perfectJanuary()
    expect(await freezeDay(gymHabit(), dailySchedule(), '2026-02-11', TODAY)).toBe('future')
  })

  it('refuses a completed day rather than downgrading it', async () => {
    await perfectJanuary()
    await toggleDay(USER, HABIT, '2026-02-08')

    expect(await freezeDay(gymHabit(), dailySchedule(), '2026-02-08', TODAY)).toBe('not-missed')
    expect((await db.day_entries.get([HABIT, '2026-02-08']))?.kind).toBe('completed')
  })

  it('refuses a day the cadence never scheduled', async () => {
    await perfectJanuary()
    // 2026-02-08 is a Sunday; this habit only runs on Mondays.
    const mondays = dailySchedule({ cadence_type: 'weekdays', weekdays: [1] })
    expect(await freezeDay(gymHabit(), mondays, '2026-02-08', TODAY)).toBe('not-missed')
  })

  it('refuses once the balance is spent', async () => {
    await db.day_entries.clear()
    await db.outbox.clear()
    const h = gymHabit({ start_date: '2026-02-01' })
    const sch = dailySchedule({ effective_from: '2026-02-01' })

    // February's single grant, spent.
    expect(await freezeDay(h, sch, '2026-02-05', TODAY)).toBe(true)
    expect(await freezeDay(h, sch, '2026-02-06', TODAY)).toBe('no-tokens')
    expect(await db.day_entries.get([HABIT, '2026-02-06'])).toBeUndefined()
  })
})

describe('unfreezeDay', () => {
  it('refunds the token by tombstoning the entry', async () => {
    await perfectJanuary()
    const h = gymHabit()
    const before = freezeTokens(h, dailySchedule(), await ledger(), TODAY)

    await freezeDay(h, dailySchedule(), '2026-02-08', TODAY)
    expect(freezeTokens(h, dailySchedule(), await ledger(), TODAY)).toBe(before - 1)

    await unfreezeDay(HABIT, '2026-02-08')
    expect((await db.day_entries.get([HABIT, '2026-02-08']))?.deleted_at).not.toBeNull()
    expect(freezeTokens(h, dailySchedule(), await ledger(), TODAY)).toBe(before)
  })

  // "Undo the freeze" cannot possibly mean "delete the completion".
  it('leaves a Completion alone', async () => {
    await perfectJanuary()
    await toggleDay(USER, HABIT, '2026-02-08')

    await unfreezeDay(HABIT, '2026-02-08')
    const row = await db.day_entries.get([HABIT, '2026-02-08'])
    expect(row?.kind).toBe('completed')
    expect(row?.deleted_at).toBeNull()
  })
})
