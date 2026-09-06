import { supabase } from './supabase'
import { db, getSyncCursor, setSyncCursor } from './db'
import type { OutboxItem, OutboxTable, SyncedTable } from './types'

const TABLES: SyncedTable[] = ['habits', 'habit_schedules', 'day_entries']

/** Push order. profiles joins the queue but is pulled on its own path below. */
const PUSH_TABLES: OutboxTable[] = [...TABLES, 'profiles']
const PAGE = 500

/** Conflict target per table. day_entries is keyed by the Cell, not an id. */
const CONFLICT: Record<OutboxTable, string> = {
  habits: 'id',
  habit_schedules: 'id',
  day_entries: 'habit_id,day',
  profiles: 'id',
}

/**
 * Instants arrive in two shapes: the client writes `...Z`, Postgres returns
 * `...+00:00`. Comparing those as strings is lexicographically wrong, so every
 * comparison goes through Date.parse.
 */
const newer = (a: string, b: string) => Date.parse(a) > Date.parse(b)

const localKey = (table: SyncedTable, row: any) =>
  table === 'day_entries' ? [row.habit_id, row.day] : row.id

/**
 * Push the outbox.
 *
 * Rows are only removed from the queue after the server accepts them, so being
 * killed mid-flight costs a repeated upsert, never a lost write. Upserts are
 * idempotent, so that repeat is harmless.
 */
async function push(): Promise<number> {
  const items = await db.outbox.orderBy('seq').toArray()
  if (items.length === 0) return 0

  // Only the newest write per Cell needs to travel. Older entries for the same
  // key are strictly superseded — and lww_guard would reject them anyway.
  const latest = new Map<string, OutboxItem>()
  for (const it of items) latest.set(`${it.table}|${it.key}`, it)

  let sent = 0
  for (const table of PUSH_TABLES) {
    const rows = [...latest.values()]
      .filter(i => i.table === table)
      .map(i => {
        const { synced_at, ...rest } = i.payload as any  // server-owned
        return rest
      })
    if (rows.length === 0) continue

    const { error } = await supabase.from(table).upsert(rows, { onConflict: CONFLICT[table] })
    if (error) throw new Error(`push ${table}: ${error.message}`)
    sent += rows.length
  }

  // Clear only what was read. Writes that landed mid-push keep their place.
  await db.outbox.bulkDelete(items.map(i => i.seq!).filter(s => s != null))
  return sent
}

/**
 * Pull everything changed since this table's cursor, tombstones included — a
 * device that was offline has to learn that a row died, not resurrect it.
 */
async function pull(userId: string): Promise<number> {
  let applied = 0

  for (const table of TABLES) {
    let cursor = await getSyncCursor(table)

    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .gt('synced_at', cursor)
        .order('synced_at', { ascending: true })
        .limit(PAGE)

      if (error) throw new Error(`pull ${table}: ${error.message}`)
      if (!data || data.length === 0) break

      await db.transaction('rw', db[table], async () => {
        for (const row of data) {
          const local = await (db[table] as any).get(localKey(table, row))
          // Skip when the local copy is newer: it is still queued to push and
          // must not be clobbered by the server's older version.
          if (!local || newer(row.updated_at, local.updated_at)) {
            await (db[table] as any).put(row)
            applied++
          }
        }
      })

      cursor = data[data.length - 1].synced_at
      await setSyncCursor(table, cursor)
      if (data.length < PAGE) break
    }
  }

  return applied
}

/**
 * Pull the profile.
 *
 * Separate from the generic loop for two reasons: the row is keyed `id` rather
 * than `user_id`, and there is exactly one of it, so paging by a cursor would
 * be machinery around a single fetch. Re-reading it every cycle costs one row.
 *
 * The last-write-wins comparison is the same as everywhere else — a local edit
 * still sitting in the outbox must not be overwritten by the server's older
 * copy of it.
 */
async function pullProfile(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error(`pull profiles: ${error.message}`)
  // Absent means the sign-up trigger has not run yet, or this account predates
  // the table. Either way there is nothing to merge and defaults still apply.
  if (!data) return 0

  const local = await db.profiles.get(userId)
  if (local && !newer(data.updated_at, local.updated_at)) return 0

  await db.profiles.put(data)
  return 1
}

export interface SyncOutcome { pushed: number; pulled: number }

/** One full cycle. Push first, so local intent is on the server before merging. */
export async function syncNow(userId: string): Promise<SyncOutcome> {
  const pushed = await push()
  const pulled = (await pull(userId)) + (await pullProfile(userId))
  return { pushed, pulled }
}
