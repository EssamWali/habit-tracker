import { db } from './db'
import { DEFAULT_DAY_START_MINUTES, nowStamp, today } from './day'
import type { Day, Profile } from './types'

/**
 * Settings for a user who has no profile row yet.
 *
 * The server creates the row by trigger on sign-up, so locally it is absent
 * only in the window before the first pull — or permanently, if the very first
 * launch on a device happens offline. Both must render, which means every read
 * of a setting resolves through a default rather than waiting for a row.
 *
 * These values mirror the column defaults in 0001_init.sql. They are duplicated
 * deliberately: the client cannot ask the server what its defaults are while
 * offline, which is exactly when it needs them.
 */
export const DEFAULT_PROFILE: Omit<Profile, 'id' | 'updated_at'> = {
  day_start_minutes: DEFAULT_DAY_START_MINUTES,
  theme: 'system',
  reminder_enabled: false,
  reminder_minutes: null,
}

/** Fill in whatever the mirror is missing. Never throws, never blocks a render. */
export function withDefaults(profile: Profile | undefined | null, userId: string): Profile {
  return {
    id: userId,
    updated_at: '1970-01-01T00:00:00.000Z',
    ...DEFAULT_PROFILE,
    ...(profile ?? {}),
  }
}

/**
 * True when this is the stand-in rather than a row that has really synced.
 *
 * The epoch stamp is what makes the two distinguishable: it is a value no
 * genuine write can produce, and it also guarantees the placeholder loses every
 * last-write-wins comparison it takes part in.
 */
export const isPlaceholder = (profile: Profile): boolean =>
  Date.parse(profile.updated_at) === 0

/**
 * Day Start, clamped to the range the column accepts.
 *
 * A value outside 0..1439 can only arrive from a corrupted mirror or a hand-
 * edited row, and letting it through would shift every Day by an arbitrary
 * amount — a silent, whole-app failure. Clamping degrades to a wrong-by-hours
 * boundary instead, which is visible and fixable from the settings panel.
 */
export function dayStartOf(profile: Profile | undefined | null): number {
  const raw = profile?.day_start_minutes
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_DAY_START_MINUTES
  return Math.min(1439, Math.max(0, Math.round(raw)))
}

/** The current Day for a user, resolved through their own Day Start (R0). */
export async function currentDay(userId: string, now: Date = new Date()): Promise<Day> {
  return today(now, dayStartOf(await db.profiles.get(userId)))
}

/**
 * Write settings.
 *
 * profiles is a singleton, so unlike the other tables there is no create path:
 * the row either exists locally or is being written for the first time here,
 * and both cases are the same upsert. Absent fields come from the defaults so a
 * first write on an offline device still produces a complete row.
 *
 * Note what this does NOT do: nothing recomputes when day_start_minutes
 * changes. Completions are stored as plain dates that were already resolved at
 * the moment they were recorded (ADR 0003), so a new Day Start decides where
 * future ticks land and leaves history exactly as it was.
 */
export async function saveProfile(
  userId: string,
  patch: Partial<Omit<Profile, 'id' | 'updated_at'>>,
): Promise<Profile> {
  return db.transaction('rw', [db.profiles, db.outbox], async () => {
    const current = withDefaults(await db.profiles.get(userId), userId)
    const row: Profile = { ...current, ...patch, updated_at: nowStamp() }

    await db.profiles.put(row)
    await db.outbox.put({ table: 'profiles', key: userId, payload: row, created_at: row.updated_at })
    return row
  })
}

/** `HH:MM` for a Day Start, for labels and selects. */
export const formatDayStart = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
