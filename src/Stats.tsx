import { useMemo, useState } from 'react'
import { streaks, type StreakResult } from './lib/rules'
import { concernOf, habitStats, type HabitStats, type StatWindow } from './lib/stats'
import { hueValue } from './lib/palette'
import type { ResolvedTheme } from './lib/theme'
import type { Day, EntryKind, Habit, HabitSchedule } from './lib/types'

const WINDOWS: { value: StatWindow; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 'all', label: 'All' },
]

const KEY = 'stats-window'

function readWindow(): StatWindow {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'all') return 'all'
    const n = Number(v)
    if (n === 7 || n === 30 || n === 90) return n
  } catch { /* storage may be blocked */ }
  return 30   // Q13
}

interface Row {
  habit: Habit
  stats: HabitStats
  streak: StreakResult
  /** Sort key; null when there is no rate to rank on. */
  concern: number | null
}

const pct = (n: number) => `${Math.round(n * 100)}%`
const points = (d: number) => `${Math.round(Math.abs(d) * 100)} pts`

function unitWord(unit: 'day' | 'week', n: number) {
  return unit === 'week' ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'day' : 'days')
}

function Trend({ stats }: { stats: HabitStats }) {
  const { direction, delta } = stats.trend

  // Nothing to compare against yet. Saying so beats an arrow that means
  // nothing, and beats silence, which reads as "no change".
  if (direction === 'insufficient') {
    return <span className="trend trend--none">no comparison yet</span>
  }
  if (direction === 'steady') return <span className="trend trend--steady">holding steady</span>

  return (
    <span className={direction === 'down' ? 'trend trend--down' : 'trend trend--up'}>
      {direction === 'down' ? '↓' : '↑'} {points(delta ?? 0)}
    </span>
  )
}

export default function Stats({
  habits, schedules, entriesByHabit, today, resolvedTheme,
}: {
  habits: readonly Habit[]
  schedules: readonly HabitSchedule[]
  entriesByHabit: ReadonlyMap<string, ReadonlyMap<Day, EntryKind>>
  today: Day
  resolvedTheme: ResolvedTheme
}) {
  const [window, setWindow] = useState<StatWindow>(readWindow)

  const choose = (w: StatWindow) => {
    try { localStorage.setItem(KEY, String(w)) } catch { /* blocked */ }
    setWindow(w)
  }

  const rows = useMemo<Row[]>(() => {
    const empty = new Map<Day, EntryKind>()
    const built = habits.map(habit => {
      const entries = entriesByHabit.get(habit.id) ?? empty
      const stats = habitStats(habit, schedules, entries, today, window)
      return {
        habit,
        stats,
        streak: streaks(habit, schedules, entries, today),
        concern: concernOf(stats),
      }
    })

    // Habits with no rate carry no signal, so they sit at the bottom in their
    // own order rather than being ranked against habits that do.
    return built.sort((a, b) => {
      if (a.concern === null && b.concern === null) return a.habit.sort_order - b.habit.sort_order
      if (a.concern === null) return 1
      if (b.concern === null) return -1
      return b.concern - a.concern
    })
  }, [habits, schedules, entriesByHabit, today, window])

  if (habits.length === 0) return null

  return (
    <div className="card">
      <div className="card-head">
        <h2>Statistics</h2>
        <div className="seg seg--small" role="group" aria-label="Statistics window">
          {WINDOWS.map(w => (
            <button key={String(w.value)} aria-pressed={window === w.value} onClick={() => choose(w.value)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="stats">
        {rows.map(({ habit, stats, streak }) => {
          const { rate, hits, opportunities, unit } = stats.current
          return (
            <li
              key={habit.id}
              style={{ '--habit-hue': hueValue(habit.colour, resolvedTheme) } as React.CSSProperties}
            >
              <div className="stat-head">
                <i className="habit-swatch" aria-hidden="true" />
                <span className="stat-name">{habit.name}</span>
                {rate !== null && <Trend stats={stats} />}
              </div>

              {rate === null ? (
                // "No statistic is shown for a habit too new to support it."
                <p className="muted note stat-empty">
                  Not enough history yet — nothing scheduled has come due in this window.
                </p>
              ) : (
                <>
                  <div className="stat-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(rate * 100)}%` }} />
                  </div>
                  <p className="muted note stat-line">
                    <strong className="stat-rate">{pct(rate)}</strong>
                    {' · '}{hits} of {opportunities} {unitWord(unit, opportunities)}
                    {streak.current > 0 && <> · streak {streak.current} {unitWord(unit, streak.current)}</>}
                    {streak.longest > 0 && <> · best {streak.longest}</>}
                  </p>
                </>
              )}
            </li>
          )
        })}
      </ul>

      <p className="muted note">
        Ordered by what wants attention first. Weekly habits are scored in whole
        weeks, so their totals count weeks rather than days.
      </p>
    </div>
  )
}
