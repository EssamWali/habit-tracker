import { useEffect, useRef } from 'react'
import { aggregate, type HabitData } from './rules'
import { saveProfile } from './profile'
import type { Day, EntryKind, Habit, HabitSchedule, Profile } from './types'

/**
 * The suppression signal behind V2-6.
 *
 * "Do not notify on a day that is already complete" is a question about
 * Scheduled Days, cadences and weekly quotas. Answering it in the reminder job
 * would mean a second implementation of R1, R2 and R5 living on the server,
 * free to drift from this one — and a suppression rule that drifts either nags
 * people who are done or silences people who are not.
 *
 * So the server never asks it. The client answers it here, using the same R5
 * that draws the aggregate heatmap, and writes the conclusion to
 * `profiles.last_clear_day`. The job compares two dates.
 *
 * The cost is that the answer is only as fresh as the last time the app was
 * open and syncing. That failure mode points the right way: a user who has not
 * opened the app today leaves a stale value and gets their reminder.
 */
export function nothingOutstanding(
  habits: readonly Habit[],
  schedules: readonly HabitSchedule[],
  entriesByHabit: ReadonlyMap<string, ReadonlyMap<Day, EntryKind>>,
  today: Day,
): boolean {
  const empty = new Map<Day, EntryKind>()

  const data: HabitData[] = habits.map(habit => {
    const entries = entriesByHabit.get(habit.id) ?? empty
    const completed = new Set<Day>()
    for (const [day, kind] of entries) if (kind === 'completed') completed.add(day)
    return { habit, entries, completed }
  })

  const result = aggregate(data, schedules, today, today)

  // Neutral counts as clear: a day with nothing scheduled is a rest day, not an
  // outstanding one, and nudging someone about it would be the empty
  // notification Q16 exists to avoid.
  return result.neutral || result.isPerfectDay
}

/**
 * Keep `profiles.last_clear_day` in step with today's state.
 *
 * Writes in both directions. Becoming clear sets it; un-ticking something after
 * the fact clears it again, because otherwise one accidental tap would suppress
 * the rest of the day's reminder.
 *
 * Guarded so it only writes on an actual change: this runs on every render that
 * touches a habit, and an unguarded save would queue a profile row per keystroke
 * elsewhere in the app.
 */
export function useClearDay(
  userId: string | undefined,
  profile: Profile | null,
  habits: readonly Habit[],
  schedules: readonly HabitSchedule[],
  entriesByHabit: ReadonlyMap<string, ReadonlyMap<Day, EntryKind>>,
  today: Day,
) {
  // Remembers what we last wrote, so a slow round trip through Dexie does not
  // produce a second identical write before the first is visible.
  const wrote = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || !profile) return

    const clear = nothingOutstanding(habits, schedules, entriesByHabit, today)
    const next = clear ? today : null
    if (profile.last_clear_day === next || wrote.current === `${today}|${next}`) return

    // Only ever rewrite today's own value. A previous day's mark is history the
    // reminder job no longer reads, and clearing it would be pointless churn.
    if (!clear && profile.last_clear_day !== today) return

    wrote.current = `${today}|${next}`
    saveProfile(userId, { last_clear_day: next })
  }, [userId, profile, habits, schedules, entriesByHabit, today])
}
