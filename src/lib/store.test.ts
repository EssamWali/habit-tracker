import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { NOTE_MAX, setNote, toggleDay } from './store'
import type { DayEntry } from './types'

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
