import { useEffect, useRef, useState } from 'react'
import { parseDay } from './lib/calendar'
import type { CellState } from './lib/rules'
import { NOTE_MAX } from './lib/store'
import { FREEZE_CAP, FREEZE_LOOKBACK_DAYS, type FreezeRefusal } from './lib/rules'
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
/** Why a Freeze cannot be applied here, in the user's terms. */
const REFUSAL: Record<FreezeRefusal, string> = {
  'too-old': `Freezes only reach back ${FREEZE_LOOKBACK_DAYS} days.`,
  future: 'That day has not happened yet.',
  'not-missed': 'There is nothing to protect on this day.',
  'no-tokens': 'No Freeze Tokens left.',
}

export default function DayDetail({
  habit, day, state, note, freeze, onToggle, onSaveNote, onFreeze, onUnfreeze, onClose,
}: {
  habit: Habit
  day: Day
  state: CellState
  /** Empty unless the day is a live Completion — a tombstoned row's note is
   *  retained in the mirror but never surfaced. */
  note: string
  freeze: { tokens: number; verdict: true | FreezeRefusal }
  onToggle: () => void
  onSaveNote: (text: string) => void
  onFreeze: () => void
  onUnfreeze: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(note)

  useEffect(() => {
    // The first button in the sheet, whichever it happens to be. A ref pinned
    // to one particular button loses focus entirely the moment that button is
    // conditional — as the toggle now is on a frozen day.
    dialog.current?.querySelector('button')?.focus()

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const editable = state !== 'out_of_range'

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${habit.name} on ${day}`}
        onClick={e => e.stopPropagation()}
      >
        <p className="sheet-date">{LONG_DATE.format(parseDay(day))}</p>
        <h3 className="sheet-habit">{habit.name}</h3>
        <p className="muted">{DESCRIPTION[state]}</p>

        {/* A Note hangs off a Completion, so there is nowhere to put one until
            the day is marked done. Saying that is better than a disabled box
            with no explanation. */}
        {state === 'completed' ? (
          <div className="sheet-note">
            <label className="setting-label" htmlFor="note">Note</label>
            <textarea
              id="note"
              className="input"
              rows={3}
              maxLength={NOTE_MAX}
              value={draft}
              placeholder="How did it go?"
              onChange={e => setDraft(e.target.value)}
            />
            <div className="sheet-note-foot">
              <span className="muted note">{draft.length}/{NOTE_MAX}</span>
              {draft.trim() !== note.trim() && (
                <button className="linkish" onClick={() => onSaveNote(draft)}>Save note</button>
              )}
            </div>
          </div>
        ) : null}

        {/* Freezing is offered only where it is genuinely allowed, and the
            balance is stated alongside so a spend is visibly a spend. An
            unexplained number invites the assumption that tokens are free. */}
        {state === 'missed' && (
          <div className="sheet-freeze">
            {freeze.verdict === true ? (
              <>
                <button className="btn btn--quiet" onClick={() => { onFreeze(); onClose() }}>
                  Freeze this day
                </button>
                <p className="muted note">
                  Keeps the streak alive without counting as done. Spends one of your{' '}
                  <strong>{freeze.tokens}</strong>{' '}
                  {freeze.tokens === 1 ? 'token' : 'tokens'}.
                </p>
              </>
            ) : (
              <p className="muted note">
                {REFUSAL[freeze.verdict]}
                {freeze.verdict === 'no-tokens' && (
                  <> One is granted at the start of each month, and unused ones only
                  carry over after a flawless month — up to {FREEZE_CAP}.</>
                )}
              </p>
            )}
          </div>
        )}

        {state === 'frozen' && (
          <div className="sheet-freeze">
            <button className="btn btn--quiet" onClick={() => { onUnfreeze(); onClose() }}>
              Undo the freeze
            </button>
            <p className="muted note">Gives the token back and lets the day count as missed again.</p>
          </div>
        )}

        <div className="sheet-actions">
          {editable && state !== 'frozen' && (
            <button className="btn" onClick={() => { onToggle(); onClose() }}>
              {state === 'completed' ? 'Mark not done' : 'Mark done'}
            </button>
          )}
          <button className="btn btn--quiet" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
