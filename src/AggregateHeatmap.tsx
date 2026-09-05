import { useEffect, useMemo, useRef } from 'react'
import { buildGrid, buildMonthGrid } from './lib/calendar'
import { aggregate, type HabitData } from './lib/rules'
import { RANGE_DAYS, type Range } from './Heatmap'
import type { Day, EntryKind, Habit, HabitSchedule } from './lib/types'

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The one grid over all Habits, and the only one with graduated shading.
 *
 * Intensity is R5's weighted ratio: how much of the day's *owed* work was done,
 * not how many habits exist. A day with one Unskippable habit completed reads
 * stronger than a day with one Minor habit completed.
 */
export default function AggregateHeatmap({
  habits, schedules, entriesByHabit, today, range,
}: {
  habits: readonly Habit[]
  schedules: readonly HabitSchedule[]
  entriesByHabit: ReadonlyMap<string, Map<Day, EntryKind>>
  today: Day
  range: Range
}) {
  const scroller = useRef<HTMLDivElement>(null)

  const { weeks, monthLabels } = useMemo(
    () => (range === 'month' ? buildMonthGrid(today) : buildGrid(today, RANGE_DAYS[range])),
    [today, range])

  const data = useMemo<HabitData[]>(() => habits.map(habit => {
    const entries = entriesByHabit.get(habit.id) ?? new Map<Day, EntryKind>()
    const completed = new Set<Day>()
    for (const [d, k] of entries) if (k === 'completed') completed.add(d)
    return { habit, entries, completed }
  }), [habits, entriesByHabit])

  const cells = useMemo(() => {
    const map = new Map<Day, ReturnType<typeof aggregate>>()
    for (const day of weeks.flat()) map.set(day, aggregate(data, schedules, day, today))
    return map
  }, [weeks, data, schedules, today])

  useEffect(() => {
    const el = scroller.current
    if (el && range !== 'month') el.scrollLeft = el.scrollWidth
  }, [weeks.length, range])

  return (
    <section className="aggregate">
      <div className="card-head">
        <h3>All habits</h3>
        <div className="legend" aria-hidden="true">
          <span>Less</span>
          <i className="acell acell--b1" /><i className="acell acell--b2" />
          <i className="acell acell--b3" /><i className="acell acell--b4" />
          <i className="acell acell--perfect" />
          <span>Perfect</span>
        </div>
      </div>

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
                const r = cells.get(day)!
                const cls = r.isPerfectDay ? 'acell acell--perfect'
                  : r.neutral ? 'acell acell--neutral'
                  : `acell acell--b${r.band}`
                return (
                  <i
                    key={day}
                    className={`hcell ${cls}`}
                    title={`${day} — ${describe(r)}`}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function describe(r: ReturnType<typeof aggregate>): string {
  if (r.neutral) return 'nothing scheduled'
  if (r.isPerfectDay) return 'perfect day'
  return `${Math.round(r.ratio * 100)}% of what was owed`
}
