import { useEffect, useRef } from 'react'
import { buildGrid, daysBetween } from './lib/calendar'
import type { Day, Habit } from './lib/types'

// All seven, single letters. GitHub labels only alternate rows to avoid
// crowding, but that reads as 'only three days are shown'.
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

type CellState = 'completed' | 'empty' | 'out'

function cellState(day: Day, habit: Habit, today: Day, completed: Set<Day>): CellState {
  // Out-of-range covers both ends: before the Habit's Start Date, and the
  // future days that pad the final column.
  if (daysBetween(day, today) < 0) return 'out'
  if (daysBetween(habit.start_date, day) < 0) return 'out'
  if (habit.archived_at && daysBetween(habit.archived_at, day) >= 0) return 'out'
  return completed.has(day) ? 'completed' : 'empty'
}

export default function Heatmap({
  habit, today, completed, onToggle,
}: { habit: Habit; today: Day; completed: Set<Day>; onToggle: (day: Day) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const { weeks, monthLabels } = buildGrid(today, 365)

  // Pin to the right edge: the interesting end of a rolling window is now.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [weeks.length])

  return (
    <div className="heatmap-row">
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
              {/* grid-auto-flow: column with 7 explicit rows places these
                  automatically — each run of 7 fills one column. buildGrid
                  guarantees exactly 7 per week, which the tests assert. */}
              {weeks.flat().map(day => {
                const state = cellState(day, habit, today, completed)
                const label = state === 'out' ? day : `${day} — ${state === 'completed' ? 'done' : 'not done'}`

                // Today is the only interactive Cell in v0. Backfilling any past
                // day is settled design (Q14) but needs a bigger tap target than
                // a 10px square, so it waits for v1.
                if (day === today) {
                  return (
                    <button
                      key={day}
                      className={`hcell hcell--${state} hcell--today`}
                      onClick={() => onToggle(day)}
                      aria-pressed={state === 'completed'}
                      aria-label={`${habit.name}, today: ${state === 'completed' ? 'done' : 'not done'}`}
                      title={label}
                    />
                  )
                }
                return <i key={day} className={`hcell hcell--${state}`} title={label} />
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
