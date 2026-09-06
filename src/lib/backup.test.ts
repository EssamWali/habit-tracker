import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { applyImport, buildExport, ImportError, toCsv } from './backup'
import { createHabit, removeHabit, setNote, toggleDay } from './store'
import { saveProfile } from './profile'

const USER = 'u1'

/** The mirror as a comparable snapshot, tombstones included. */
async function snapshot() {
  const [profiles, habits, schedules, entries] = await Promise.all([
    db.profiles.toArray(),
    db.habits.toArray(),
    db.habit_schedules.toArray(),
    db.day_entries.toArray(),
  ])
  const sort = <T extends Record<string, any>>(rows: T[], key: (r: T) => string) =>
    [...rows].sort((a, b) => key(a).localeCompare(key(b)))

  return {
    profiles: sort(profiles, r => r.id),
    habits: sort(habits, r => r.id),
    schedules: sort(schedules, r => r.id),
    entries: sort(entries, r => `${r.habit_id}|${r.day}`),
  }
}

async function clearMirror() {
  await db.transaction('rw',
    [db.profiles, db.habits, db.habit_schedules, db.day_entries, db.outbox],
    async () => {
      await Promise.all([
        db.profiles.clear(), db.habits.clear(),
        db.habit_schedules.clear(), db.day_entries.clear(), db.outbox.clear(),
      ])
    })
}

/** A user with history worth losing: two habits, marks, a note and a deletion. */
async function seed() {
  await clearMirror()
  const gym = await createHabit(USER, { name: 'Gym', colour: 'emerald' })
  const read = await createHabit(USER, { name: 'Read', colour: 'blue' })
  const gone = await createHabit(USER, { name: 'Abandoned', colour: 'rose' })

  await toggleDay(USER, gym.id, '2026-09-01')
  await toggleDay(USER, gym.id, '2026-09-02')
  await setNote(gym.id, '2026-09-02', 'legs, felt strong')
  await toggleDay(USER, read.id, '2026-09-01')

  // An un-tick and a deleted habit, so the export carries tombstones.
  await toggleDay(USER, read.id, '2026-09-02')
  await toggleDay(USER, read.id, '2026-09-02')
  await removeHabit(gone)

  await saveProfile(USER, { day_start_minutes: 330, theme: 'dark' })
  return { gym, read, gone }
}

beforeEach(seed)

describe('buildExport', () => {
  it('carries every table, tombstones included', async () => {
    const file = await buildExport(USER)
    expect(file.habits).toHaveLength(3)
    expect(file.habits.some(h => h.deleted_at !== null)).toBe(true)
    expect(file.day_entries.some(e => e.deleted_at !== null)).toBe(true)
    expect(file.habit_schedules).toHaveLength(3)
    expect(file.profile?.day_start_minutes).toBe(330)
  })

  it('leaves the server-owned stamp behind', async () => {
    await db.habits.toCollection().modify(h => { (h as any).synced_at = '2026-09-05T00:00:00Z' })
    const file = await buildExport(USER)
    expect(file.habits.every(h => !('synced_at' in h))).toBe(true)
  })
})

/**
 * V2-5's first acceptance clause. Export, lose everything, import: the mirror
 * must come back as it was, not approximately.
 */
describe('round trip', () => {
  it('reproduces the original state exactly', async () => {
    const before = await snapshot()
    const file = await buildExport(USER)

    await clearMirror()
    expect((await snapshot()).habits).toHaveLength(0)

    await applyImport(USER, JSON.parse(JSON.stringify(file)))
    expect(await snapshot()).toEqual(before)
  })

  it('brings back the note and the deletion, not just the marks', async () => {
    const file = await buildExport(USER)
    await clearMirror()
    await applyImport(USER, file)

    const notes = (await db.day_entries.toArray()).filter(e => e.note !== null)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.note).toBe('legs, felt strong')

    // The abandoned habit stays deleted. A restore that revived it would undo
    // every deletion the user had ever made.
    expect((await db.habits.toArray()).filter(h => h.deleted_at !== null)).toHaveLength(1)
  })

  it('queues restored rows so they reach the server', async () => {
    const file = await buildExport(USER)
    await clearMirror()
    await applyImport(USER, file)
    expect(await db.outbox.count()).toBeGreaterThan(0)
  })
})

/**
 * V2-5's second acceptance clause, and the reason import reuses the sync
 * comparison rather than inserting.
 */
describe('importing twice', () => {
  it('changes nothing the second time', async () => {
    const file = await buildExport(USER)
    const before = await snapshot()

    const first = await applyImport(USER, file)
    expect(first.applied).toBe(0)          // the mirror is already current
    expect(await snapshot()).toEqual(before)

    await db.outbox.clear()
    const second = await applyImport(USER, file)
    expect(second.applied).toBe(0)
    expect(second.skipped).toBeGreaterThan(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await snapshot()).toEqual(before)
  })

  it('does not duplicate habits', async () => {
    const file = await buildExport(USER)
    await applyImport(USER, file)
    await applyImport(USER, file)
    expect(await db.habits.count()).toBe(3)
  })

  // Last-write-wins, same as sync: a local edit made after the export wins.
  it('leaves a row that is newer than the file alone', async () => {
    const file = await buildExport(USER)
    const gym = (await db.habits.toArray()).find(h => h.name === 'Gym')!

    await new Promise(r => setTimeout(r, 5))
    await db.habits.put({ ...gym, name: 'Gym renamed', updated_at: new Date().toISOString() })

    await applyImport(USER, file)
    expect((await db.habits.get(gym.id))!.name).toBe('Gym renamed')
  })
})

describe('validation', () => {
  const reject = async (data: unknown) => {
    await expect(applyImport(USER, data)).rejects.toBeInstanceOf(ImportError)
  }

  it('refuses a file that is not an export', async () => {
    await reject({ hello: 'world' })
    await reject(null)
    await reject('a string')
  })

  it('refuses a newer format than it understands', async () => {
    const file = await buildExport(USER)
    await reject({ ...file, version: 99 })
  })

  it('refuses an export missing tables', async () => {
    const file = await buildExport(USER)
    await reject({ ...file, day_entries: undefined })
  })

  it("refuses another account's export", async () => {
    const file = await buildExport(USER)
    await reject({ ...file, user_id: 'someone-else' })
  })

  // A half-applied import is worse than a refused one: there is no way to tell
  // from the outside which half landed.
  it('writes nothing at all when it refuses', async () => {
    const before = await snapshot()
    const file = await buildExport(USER)
    await clearMirror()
    await expect(applyImport(USER, { ...file, user_id: 'someone-else' })).rejects.toThrow()
    expect((await snapshot()).habits).toHaveLength(0)
    await applyImport(USER, file)
    expect(await snapshot()).toEqual(before)
  })
})

describe('toCsv', () => {
  it('lists live marks with habit names', async () => {
    const csv = toCsv(await buildExport(USER))
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('habit,day,kind,note')
    expect(lines).toHaveLength(4)          // 3 live marks; the un-ticked one is gone
    expect(csv).toContain('Gym,2026-09-01,completed,')
  })

  /**
   * Notes are free text. An unescaped comma or quote shifts every following
   * column — the classic way a CSV corrupts data without anyone noticing.
   */
  it('escapes commas, quotes and newlines in a note', async () => {
    const gym = (await db.habits.toArray()).find(h => h.name === 'Gym')!
    await setNote(gym.id, '2026-09-01', 'squats, then "heavy" rows\nand a walk')

    const line = toCsv(await buildExport(USER)).split('\r\n').find(l => l.startsWith('Gym,2026-09-01'))!
    expect(line).toContain('"squats, then ""heavy"" rows\nand a walk"')
  })

  it('quotes a habit name containing a comma', async () => {
    await createHabit(USER, { name: 'Read, daily' })
    const h = (await db.habits.toArray()).find(x => x.name === 'Read, daily')!
    await toggleDay(USER, h.id, '2026-09-03')
    expect(toCsv(await buildExport(USER))).toContain('"Read, daily",2026-09-03')
  })
})
