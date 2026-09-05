import { useState } from 'react'
import { PALETTE } from './lib/palette'
import { archiveHabit, removeHabit, restoreHabit, setSchedule, updateHabit } from './lib/store'
import { OUT_OF_RANGE, resolveSchedule } from './lib/rules'
import type { CadenceType, Day, Habit, HabitSchedule, Weight } from './lib/types'

const WEEKDAYS = [
  { iso: 1, label: 'M' }, { iso: 2, label: 'T' }, { iso: 3, label: 'W' },
  { iso: 4, label: 'T' }, { iso: 5, label: 'F' }, { iso: 6, label: 'S' }, { iso: 7, label: 'S' },
]

const WEIGHTS: { value: Weight; label: string; hint: string }[] = [
  { value: 1, label: 'Minor', hint: 'counts once' },
  { value: 2, label: 'Core', hint: 'counts double' },
  { value: 3, label: 'Unskippable', hint: 'counts triple' },
]

export default function HabitEditor({
  habit, schedules, today, onClose,
}: {
  habit: Habit
  schedules: readonly HabitSchedule[]
  today: Day
  onClose: () => void
}) {
  const current = resolveSchedule(habit, schedules, today, today)
  const live = current === OUT_OF_RANGE ? null : current

  const [name, setName] = useState(habit.name)
  const [colour, setColour] = useState(habit.colour)
  const [cadence, setCadence] = useState<CadenceType>(live?.cadence_type ?? 'daily')
  const [weekdays, setWeekdays] = useState<number[]>(live?.weekdays ?? [1, 2, 3, 4, 5])
  const [target, setTarget] = useState<number>(live?.weekly_target ?? 3)
  const [weight, setWeight] = useState<Weight>(live?.weight ?? 2)
  const [startDate, setStartDate] = useState(habit.start_date)
  const [confirmText, setConfirmText] = useState('')

  const invalid = cadence === 'weekdays' && weekdays.length === 0

  async function save() {
    if (invalid) return
    const patch: Parameters<typeof updateHabit>[1] = {}
    if (name.trim() && name.trim() !== habit.name) patch.name = name.trim()
    if (colour !== habit.colour) patch.colour = colour
    if (startDate && startDate !== habit.start_date) patch.start_date = startDate
    if (Object.keys(patch).length) await updateHabit(habit, patch)
    await setSchedule(habit, {
      cadence_type: cadence,
      weekdays: cadence === 'weekdays' ? [...weekdays].sort((a, b) => a - b) : null,
      weekly_target: cadence === 'weekly_quota' ? target : null,
      weight,
    })
    onClose()
  }

  const toggleWeekday = (iso: number) =>
    setWeekdays(w => (w.includes(iso) ? w.filter(d => d !== iso) : [...w, iso]))

  return (
    <div className="editor">
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
      </label>

      <div className="field">
        <span>Colour</span>
        <div className="swatches">
          {PALETTE.map(h => (
            <button
              key={h.key}
              className={colour === h.key ? 'swatch swatch--on' : 'swatch'}
              style={{ background: `var(--hue-${h.key})` }}
              aria-label={h.name}
              aria-pressed={colour === h.key}
              onClick={() => setColour(h.key)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <span>Cadence</span>
        <div className="seg">
          {(['daily', 'weekdays', 'weekly_quota'] as CadenceType[]).map(c => (
            <button key={c} aria-pressed={cadence === c} onClick={() => setCadence(c)}>
              {c === 'daily' ? 'Every day' : c === 'weekdays' ? 'Set days' : 'N per week'}
            </button>
          ))}
        </div>
      </div>

      {cadence === 'weekdays' && (
        <div className="field">
          <span>Days</span>
          <div className="seg seg--days">
            {WEEKDAYS.map((d, i) => (
              <button
                key={i}
                aria-pressed={weekdays.includes(d.iso)}
                onClick={() => toggleWeekday(d.iso)}
              >{d.label}</button>
            ))}
          </div>
          {invalid && <p className="error">Pick at least one day.</p>}
        </div>
      )}

      {cadence === 'weekly_quota' && (
        <div className="field">
          <span>Times per week</span>
          <div className="seg">
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <button key={n} aria-pressed={target === n} onClick={() => setTarget(n)}>{n}</button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span>Weight</span>
        <div className="seg">
          {WEIGHTS.map(w => (
            <button key={w.value} aria-pressed={weight === w.value} onClick={() => setWeight(w.value)} title={w.hint}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Tracking since</span>
        <input
          className="input"
          type="date"
          value={startDate}
          max={today}
          onChange={e => setStartDate(e.target.value)}
        />
      </label>

      <p className="muted note">
        Cadence and weight changes apply from today onward. Past days keep the
        schedule they were actually judged under. Moving the start date earlier
        opens those days up so a habit you have kept for months can be filled in.
      </p>

      <div className="editor-actions">
        <button className="btn" onClick={save} disabled={invalid}>Save</button>
        <button className="btn btn--quiet" onClick={onClose}>Cancel</button>
      </div>

      <div className="danger">
        <span className="danger-title">Retiring this habit</span>

        {habit.archived_at ? (
          <>
            <p className="muted">
              Archived on {habit.archived_at}. History is intact and it stopped
              accruing misses from that date.
            </p>
            <button className="btn btn--quiet" onClick={() => { restoreHabit(habit); onClose() }}>
              Restore
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Archiving keeps every day you have logged and simply stops the
              habit from accruing misses. It is reversible; deleting is not.
            </p>
            <button className="btn btn--quiet" onClick={() => { archiveHabit(habit); onClose() }}>
              Archive
            </button>
          </>
        )}

        <label className="field danger-confirm">
          <span>To delete permanently, type the habit’s name</span>
          <input
            className="input"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={habit.name}
          />
        </label>
        <button
          className="btn btn--danger"
          disabled={confirmText !== habit.name}
          onClick={() => { removeHabit(habit); onClose() }}
        >
          Delete permanently
        </button>
      </div>
    </div>
  )
}
