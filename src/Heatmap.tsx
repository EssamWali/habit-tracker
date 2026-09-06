import { useEffect, useMemo, useRef, useState } from 'react'
import { buildGrid, buildMonthGrid } from './lib/calendar'
import { cellState, streaks } from './lib/rules'
import type { Day, EntryKind, Habit, HabitSchedule } from './lib/types'

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export type Range = 'month' | 'quarter' | 'year'
export const RANGE_DAYS: Record<Range, number> = { month: 35, quarter: 91, year: 365 }

export default function Heatmap({
  habit, schedules, entries, notes, today, range, onToggle, onSelect,
}: {
  habit: Habit
  schedules: readonly HabitSchedule[]
  entries: ReadonlyMap<Day, EntryKind>
  /** Days carrying a Note, so the Cell can be marked (V2-4). */
  notes: ReadonlyMap<Day, string>
  today: Day
  range: Range
  onToggle: (day: Day) => void
  onSelect: (day: Day) => void
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
  const days = useMemo(() => weeks.flat(), [weeks])
  const [focusDay, setFocusDay] = useState<Day>(today)
  const cellId = (day: Day) => `${habit.id}-${day}`

  useEffect(() => {
    const el = scroller.current
    if (el && range !== 'month') el.scrollLeft = el.scrollWidth
  }, [weeks.length, range])

  // Keep the cursor inside the window when the range changes under it.
  useEffect(() => {
    if (!days.includes(focusDay)) setFocusDay(days.includes(today) ? today : days[days.length - 1]!)
  }, [days, focusDay, today])

  /**
   * Roving cursor over the grid. The grid itself holds the single tab stop and
   * moves an active descendant, rather than putting 365 cells in the tab order
   * — tabbing through a year of squares to reach the next habit would make the
   * keyboard path unusable.
   *
   * days is column-major (each week is seven consecutive entries), so a step of
   * one moves down a column and a step of seven moves across to the same
   * weekday in the next week.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    const i = days.indexOf(focusDay)
    if (i < 0) return

    let next = i
    switch (e.key) {
      case 'ArrowUp': next = i - 1; break
      case 'ArrowDown': next = i + 1; break
      case 'ArrowLeft': next = i - 7; break
      case 'ArrowRight': next = i + 7; break
      case 'Home': next = 0; break
      case 'End': next = days.length - 1; break
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const state = cellState(habit, schedules, focusDay, today, entries, completed)
        if (state === 'out_of_range' || state === 'unscheduled') return
        if (focusDay === today) onToggle(focusDay)
        else onSelect(focusDay)
        return
      }
      default: return
    }

    e.preventDefault()
    if (next < 0 || next >= days.length) return
    setFocusDay(days[next]!)
    document.getElementById(cellId(days[next]!))?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

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

          <div
            className="heatmap-grid"
            role="grid"
            tabIndex={0}
            aria-label={`${habit.name} history. Arrow keys to move, Enter to mark.`}
            aria-activedescendant={cellId(focusDay)}
            onKeyDown={onKeyDown}
          >
            {weeks.flat().map(day => {
              const state = cellState(habit, schedules, day, today, entries, completed)
              const gilded = state === 'completed' && gold.has(day)
              const noted = notes.has(day)

              // Days the habit was never scheduled for are inert. Declaring a
              // cadence and then being offered a tick on an off-day undermines
              // the cadence. R5 still scores a bonus completion if one exists —
              // from a cadence change, say — but the UI does not invite one.
              const inert = state === 'out_of_range' || state === 'unscheduled'

              const cls = [
                'hcell',
                `hcell--${state === 'out_of_range' ? 'out' : state}`,
                gilded ? (tier2.has(day) ? 'hcell--tier2' : 'hcell--gold') : '',
                // Today is marked either way, but softly when it cannot be
                // acted on, so the outline never implies a tap target.
                day === today ? (inert ? 'hcell--today-off' : 'hcell--today') : '',
                // A corner fold rather than a colour: it has to stay legible on
                // gold, which already owns both the fill and a ring.
                noted ? 'hcell--noted' : '',
              ].filter(Boolean).join(' ')

              const label = describe(state, gilded) + (noted ? ', has a note' : '')
              const title = state === 'out_of_range'
                ? day
                : `${day} — ${label}${noted ? `: ${notes.get(day)}` : ''}`

              const focused = day === focusDay ? ' hcell--focus' : ''

              if (inert) {
                return <i key={day} id={cellId(day)} role="gridcell" className={cls + focused} title={title} />
              }

              // Today toggles in one tap: it is touched daily and is the one
              // Cell outlined and padded enough to hit deliberately. Every
              // other Cell opens the detail sheet instead — a 10px square is
              // far too small to write history from.
              if (day === today) {
                return (
                  <button
                    key={day} id={cellId(day)} role="gridcell" tabIndex={-1}
                    className={cls + focused} title={title}
                    onClick={() => { setFocusDay(day); onToggle(day) }}
                    aria-pressed={state === 'completed'}
                    aria-label={`${habit.name}, today: ${label}`}
                  />
                )
              }

              return (
                <button
                  key={day} id={cellId(day)} role="gridcell" tabIndex={-1}
                  className={`${cls} hcell--pick${focused}`}
                  title={title}
                  onClick={() => { setFocusDay(day); onSelect(day) }}
                  aria-label={`${habit.name}, ${day}: ${label}`}
                />
              )
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
