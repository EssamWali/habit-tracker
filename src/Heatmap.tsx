import { useEffect, useMemo, useRef } from 'react'
import { buildGrid, buildMonthGrid } from './lib/calendar'
import { cellState, streaks } from './lib/rules'
import type { Day, EntryKind, Habit, HabitSchedule } from './lib/types'

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export type Range = 'month' | 'quarter' | 'year'
export const RANGE_DAYS: Record<Range, number> = { month: 35, quarter: 91, year: 365 }

export default function Heatmap({
  habit, schedules, entries, today, range, onToggle,
}: {
  habit: Habit
  schedules: readonly HabitSchedule[]
  entries: ReadonlyMap<Day, EntryKind>
  today: Day
  range: Range
  onToggle: (day: Day) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // Month is a calendar month so the grid fills in as the month progresses;
  // quarter and year are rolling windows ending today.
  const { weeks, monthLabels } = useMemo(
    () => (range === 'month' ? buildMonthGrid(today) : buildGrid(today, RANGE_DAYS[range])),
    [today, range])

  const completed = useMemo(() => {
    const s = new Set<Day>()
    for (const [d, k] of entries) if (k === 'completed') s.add(d)
    return s
  }, [entries])

  // Streaks are computed over full history, not just the visible window: a run
  // that began before the window still gilds the part you can see.
  const { gold, tier2 } = useMemo(
    () => streaks(habit, schedules, entries, today), [habit, schedules, entries, today])

  // Pin to the right edge for rolling windows; a calendar month fits already.
  useEffect(() => {
    const el = scroller.current
    if (el && range !== 'month') el.scrollLeft = el.scrollWidth
  }, [weeks.length, range])

  return (
    <div className="heatmap-scroll" ref={scroller}>
      <div className="heatmap-inner">
        <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--cell-step))` }}>
          {monthLabels.map(m => (
            <span key={m.column} style={{ gridColumnStart: m.column + 1 }}>{m.label}</span>
          ))}
        </div>

        <div className="heatmap-body">
          <div className="heatmap-weekdays">
            {WEEKDAY_LABELS.map((l, i) => <span key={i}>{l}</span>)}
          </div>

          <div className="heatmap-grid">
            {weeks.flat().map(day => {
              const state = cellState(habit, schedules, day, today, entries, completed)
              const gilded = state === 'completed' && gold.has(day)
              const cls = [
                'hcell',
                `hcell--${state === 'out_of_range' ? 'out' : state}`,
                gilded ? (tier2.has(day) ? 'hcell--tier2' : 'hcell--gold') : '',
                day === today ? 'hcell--today' : '',
              ].filter(Boolean).join(' ')

              const title = state === 'out_of_range' ? day : `${day} — ${describe(state, gilded)}`

              if (day === today) {
                return (
                  <button
                    key={day} className={cls} title={title}
                    onClick={() => onToggle(day)}
                    aria-pressed={state === 'completed'}
                    aria-label={`${habit.name}, today: ${describe(state, gilded)}`}
                  />
                )
              }
              return <i key={day} className={cls} title={title} />
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function describe(state: string, gilded: boolean): string {
  if (state === 'completed') return gilded ? 'done, on a streak' : 'done'
  if (state === 'frozen') return 'frozen'
  if (state === 'missed') return 'missed'
  return 'not scheduled'
}
