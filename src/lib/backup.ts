import { db } from './db'
import { newer } from './sync'
import { keyOf } from './store'
import { withDefaults } from './profile'
import type { DayEntry, Habit, HabitSchedule, Profile, SyncedTable } from './types'

/**
 * Export and import.
 *
 * Export is the escape hatch that makes ADR 0001's lock-in acceptable, so it is
 * built to be *complete* rather than convenient: every row of every table,
 * tombstones included. A backup that silently drops deletions would resurrect
 * them on the next restore.
 */

export const EXPORT_FORMAT = 'habit-tracker'
export const EXPORT_VERSION = 1

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  exported_at: string
  user_id: string
  profile: Profile | null
  habits: Habit[]
  habit_schedules: HabitSchedule[]
  day_entries: DayEntry[]
}

/** synced_at is server-owned and meaningless off the server, so it never travels. */
const strip = <T extends object>(row: T): T => {
  const { synced_at, ...rest } = row as T & { synced_at?: string }
  return rest as T
}

/**
 * Everything the mirror holds for a user.
 *
 * Read from the local store rather than from Supabase on purpose: the mirror is
 * a complete copy, so an export works offline, and the escape hatch should not
 * itself depend on the service being escaped.
 */
export async function buildExport(userId: string): Promise<ExportFile> {
  const [profile, habits, schedules, entries] = await Promise.all([
    db.profiles.get(userId),
    db.habits.where('user_id').equals(userId).toArray(),
    db.habit_schedules.where('user_id').equals(userId).toArray(),
    db.day_entries.where('user_id').equals(userId).toArray(),
  ])

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile: profile ? strip(profile) : null,
    // Tombstones included. They are rows, and a restore that dropped them would
    // bring back everything the user has ever deleted.
    habits: habits.map(strip),
    habit_schedules: schedules.map(strip),
    day_entries: entries.map(strip),
  }
}

/* --------------------------------------------------------------------- CSV */

/**
 * A field, quoted only when it has to be.
 *
 * Notes are free text, so a comma, a quote or a newline in one would otherwise
 * shift every following column — the classic way a CSV export corrupts data
 * without anyone noticing until much later.
 */
function csvField(value: string | null): string {
  const v = value ?? ''
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Completions as a spreadsheet.
 *
 * Live rows only, and habits by name rather than by id: this one is for reading,
 * not for restoring. The JSON export is what round-trips.
 */
export function toCsv(file: ExportFile): string {
  const names = new Map(file.habits.map(h => [h.id, h.name]))
  const rows = file.day_entries
    .filter(e => e.deleted_at === null)
    .sort((a, b) => a.day.localeCompare(b.day) || (names.get(a.habit_id) ?? '').localeCompare(names.get(b.habit_id) ?? ''))
    .map(e => [
      csvField(names.get(e.habit_id) ?? e.habit_id),
      e.day,
      e.kind,
      csvField(e.note),
    ].join(','))

  return ['habit,day,kind,note', ...rows].join('\r\n')
}

/* ------------------------------------------------------------------ import */

export interface ImportResult {
  applied: number
  /** Rows the mirror already had at the same version or newer. */
  skipped: number
}

export class ImportError extends Error {}

/**
 * Check a parsed file before any of it is written.
 *
 * All-or-nothing on purpose: a half-applied import is far worse than a refused
 * one, because there is no way to tell from the outside which half landed.
 */
function validate(data: unknown, userId: string): ExportFile {
  if (typeof data !== 'object' || data === null) throw new ImportError('That file is not a habit tracker export.')
  const file = data as Partial<ExportFile>

  if (file.format !== EXPORT_FORMAT) {
    throw new ImportError('That file is not a habit tracker export.')
  }
  if (typeof file.version !== 'number' || file.version > EXPORT_VERSION) {
    throw new ImportError(
      `That export was written by a newer version of the app (format ${file.version}). Update, then import it.`,
    )
  }
  if (!Array.isArray(file.habits) || !Array.isArray(file.habit_schedules) || !Array.isArray(file.day_entries)) {
    throw new ImportError('That export is missing tables and cannot be trusted to restore anything.')
  }

  // Importing another account's rows is refused rather than merged. The rows
  // carry their original ids, so pushing them would collide with whatever the
  // original account still holds, and a rejected push stalls the whole outbox.
  // Export stays unconditional — getting data *out* is what ADR 0001 relies on.
  if (file.user_id !== userId) {
    throw new ImportError('That export belongs to a different account. Sign in as that account to restore it.')
  }

  return file as ExportFile
}

/**
 * Merge an export into the mirror.
 *
 * Reuses the sync comparison rather than inserting: same keys, same
 * last-write-wins test. A naive import would duplicate every habit and
 * resurrect every tombstone. Because the test is `newer`, importing the same
 * file twice is a no-op the second time.
 *
 * Imported rows are enqueued so they reach the server. That matters in the case
 * the feature exists for — restoring onto a device, or after losing data — and
 * costs nothing otherwise, since the upserts are idempotent and `lww_guard`
 * rejects anything stale.
 */
export async function applyImport(userId: string, data: unknown): Promise<ImportResult> {
  const file = validate(data, userId)
  let applied = 0
  let skipped = 0

  await db.transaction(
    'rw',
    [db.profiles, db.habits, db.habit_schedules, db.day_entries, db.outbox],
    async () => {
      const merge = async (table: SyncedTable, rows: (Habit | HabitSchedule | DayEntry)[]) => {
        for (const row of rows) {
          const key = keyOf(table, row)
          const local = await (db[table] as any).get(
            table === 'day_entries' ? [(row as DayEntry).habit_id, (row as DayEntry).day] : (row as Habit).id,
          )
          if (local && !newer(row.updated_at, local.updated_at)) { skipped++; continue }

          await (db[table] as any).put(row)
          await db.outbox.put({ table, key, payload: row, created_at: row.updated_at })
          applied++
        }
      }

      await merge('habits', file.habits)
      await merge('habit_schedules', file.habit_schedules)
      await merge('day_entries', file.day_entries)

      if (file.profile) {
        const row = withDefaults(file.profile, userId)
        const local = await db.profiles.get(userId)
        if (local && !newer(row.updated_at, local.updated_at)) {
          skipped++
        } else {
          await db.profiles.put(row)
          await db.outbox.put({ table: 'profiles', key: userId, payload: row, created_at: row.updated_at })
          applied++
        }
      }
    },
  )

  return { applied, skipped }
}
