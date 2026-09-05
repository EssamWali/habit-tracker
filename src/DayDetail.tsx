import { useEffect, useRef } from 'react'
import { parseDay } from './lib/calendar'
import type { CellState } from './lib/rules'
import type { Day, Habit } from './lib/types'

const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
})

const DESCRIPTION: Record<CellState, string> = {
  completed: 'Done',
  frozen: 'Frozen — the streak was protected, but this does not count as done',
  missed: 'Not done',
  unscheduled: 'Not scheduled — this day was never owed',
  out_of_range: 'Outside this habit’s tracked range',
}

/**
 * Correcting a past Day.
 *
 * Backfill is unlimited (Q14): no lookback window, and no flag marking an entry
 * as backfilled. You are the only person you could deceive, and a tracker you
 * cannot correct is one you stop trusting.
 *
 * Past Cells open this sheet rather than toggling on tap. A 10px square is far
 * too small to write to safely — a mis-tap would silently rewrite history.
 * Today keeps its one-tap toggle: it is touched daily, and it is the one Cell
 * large enough and distinctly outlined enough to hit deliberately.
 */
export default function DayDetail({
  habit, day, state, onToggle, onClose,
}: {
  habit: Habit
  day: Day
  state: CellState
  onToggle: () => void
  onClose: () => void
}) {
  const firstButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstButton.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const editable = state !== 'out_of_range'

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${habit.name} on ${day}`}
        onClick={e => e.stopPropagation()}
      >
        <p className="sheet-date">{LONG_DATE.format(parseDay(day))}</p>
        <h3 className="sheet-habit">{habit.name}</h3>
        <p className="muted">{DESCRIPTION[state]}</p>

        <div className="sheet-actions">
          {editable && (
            <button ref={firstButton} className="btn" onClick={() => { onToggle(); onClose() }}>
              {state === 'completed' ? 'Mark not done' : 'Mark done'}
            </button>
          )}
          <button className="btn btn--quiet" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
