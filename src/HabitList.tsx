import { useEffect, useState } from 'react'
import { today as todayFn } from './lib/day'
import { createHabit, freezeDay, reconcileFreezes, setNote, toggleDay, unfreezeDay, type RevertedFreeze } from './lib/store'
import { useDragOrder } from './useDragOrder'
import { useEntriesByHabit, useHabits, useNotesByHabit, useOutboxDepth, useSchedules } from './lib/useLocalStore'
import { useSync } from './lib/useSync'
import { useClearDay } from './lib/reminder'
import type { ResolvedTheme } from './lib/theme'
import { hueValue } from './lib/palette'
import { OUT_OF_RANGE, canFreeze, cellState, freezeTokens, resolveSchedule } from './lib/rules'
import type { EntryKind, Habit, HabitSchedule, Profile } from './lib/types'
import Heatmap, { type Range } from './Heatmap'
import HabitEditor from './HabitEditor'
import AggregateHeatmap from './AggregateHeatmap'
import DayDetail from './DayDetail'
import Stats from './Stats'

function syncLabel(status: ReturnType<typeof useSync>['status']): string {
  switch (status.state) {
    case 'syncing': return 'syncing…'
    case 'offline': return 'offline — changes queued'
    case 'error': return `sync failed, retrying in ${status.retryInSeconds}s`
    case 'idle': return status.lastSync ? 'synced' : 'idle'
  }
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Stable identity, so a habit with no notes does not remount the heatmap. */
const EMPTY_NOTES: ReadonlyMap<string, string> = new Map()

function cadenceSummary(habit: Habit, schedules: readonly HabitSchedule[], today: string): string {
  const s = resolveSchedule(habit, schedules, today, today)
  if (s === OUT_OF_RANGE) return ''
  switch (s.cadence_type) {
    case 'daily': return 'every day'
    case 'weekdays': return (s.weekdays ?? []).map(d => DAY_LETTERS[d - 1]).join(' ')
    case 'weekly_quota': return `${s.weekly_target}× per week`
  }
}

export default function HabitList({
  userId, profile, dayStartMinutes, resolvedTheme,
}: {
  userId: string
  profile: Profile | null
  /** Day Start comes from the profile (R0); this component never assumes 04:00. */
  dayStartMinutes: number
  resolvedTheme: ResolvedTheme
}) {
  const day = todayFn(new Date(), dayStartMinutes)
  const [showArchived, setShowArchived] = useState(false)
  const habits = useHabits(userId, showArchived)
  const schedules = useSchedules(userId)
  const entriesByHabit = useEntriesByHabit(userId)
  const notesByHabit = useNotesByHabit(userId)
  const pending = useOutboxDepth()
  const { status, syncNow } = useSync(userId)
  const resolved = resolvedTheme
  const drag = useDragOrder(habits)

  // Publishes "nothing left owing today" for the reminder job, so suppression
  // never needs a second copy of the rules on the server (V2-6).
  useClearDay(userId, profile, habits, schedules, entriesByHabit, day)

  const [reverted, setReverted] = useState<RevertedFreeze[]>([])

  // Runs whenever entries change, which includes after a pull — the moment two
  // devices' Freezes first meet. Idempotent: reverting tombstones the entry, so
  // the next pass finds nothing and writes nothing (V3-5).
  useEffect(() => {
    if (habits.length === 0) return
    let live = true
    reconcileFreezes(habits, schedules, day).then(undone => {
      if (live && undone.length > 0) setReverted(prev => [...prev, ...undone])
    })
    return () => { live = false }
  }, [habits, schedules, entriesByHabit, day])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ habitId: string; day: string } | null>(null)
  const [range, setRange] = useState<Range>(() => {
    try { const v = localStorage.getItem('range'); if (v === 'month' || v === 'quarter' || v === 'year') return v } catch { /* blocked */ }
    return 'month'
  })

  const chooseRange = (r: Range) => {
    try { localStorage.setItem('range', r) } catch { /* blocked */ }
    setRange(r)
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setName('')
    await createHabit(userId, { name: trimmed })
  }

  return (
    <>
    <div className="card">
      <div className="card-head">
        <h2>Today · {day}</h2>
        <label className="archived-toggle">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <div className="seg seg--small" role="group" aria-label="Heatmap range">
          {(['month', 'quarter', 'year'] as Range[]).map(r => (
            <button key={r} aria-pressed={range === r} onClick={() => chooseRange(r)}>
              {r === 'month' ? 'Month' : r === 'quarter' ? 'Quarter' : 'Year'}
            </button>
          ))}
        </div>
      </div>

      {habits.length === 0 && <p className="muted">No habits yet. Add one below.</p>}

      {habits.length > 0 && (
        <AggregateHeatmap
          habits={habits}
          schedules={schedules}
          entriesByHabit={entriesByHabit}
          today={day}
          range={range}
        />
      )}

      <ul className="habits">
        {drag.ordered.map(h => {
          const entries = entriesByHabit.get(h.id) ?? new Map<string, EntryKind>()
          const open = editing === h.id
          return (
            <li
              key={h.id}
              ref={el => drag.register(h.id, el)}
              className={drag.dragId === h.id ? 'is-dragging' : undefined}
              style={{ '--habit-hue': hueValue(h.colour, resolved) } as React.CSSProperties}
            >
              <div className="habit-head">
                <i className="habit-swatch" aria-hidden="true" />
                <button
                  className="habit-name habit-name--button"
                  aria-expanded={open}
                  onClick={() => setEditing(open ? null : h.id)}
                >
                  {h.name}
                  <span className="cadence">{cadenceSummary(h, schedules, day)}</span>
                </button>
                {h.archived_at && <span className="badge">archived</span>}
                <button
                  className="grip"
                  aria-label={`Reorder ${h.name}. Drag, or use the arrow keys.`}
                  onPointerDown={e => drag.start(e, h.id)}
                  onPointerMove={drag.move}
                  onPointerUp={drag.end}
                  onPointerCancel={drag.end}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp') { e.preventDefault(); drag.nudge(h.id, -1) }
                    if (e.key === 'ArrowDown') { e.preventDefault(); drag.nudge(h.id, 1) }
                  }}
                >⠿</button>
              </div>

              <Heatmap
                habit={h}
                schedules={schedules}
                entries={entries}
                notes={notesByHabit.get(h.id) ?? EMPTY_NOTES}
                today={day}
                range={range}
                onToggle={d => toggleDay(userId, h.id, d)}
                onSelect={d => setPicked({ habitId: h.id, day: d })}
              />

              {open && (
                <HabitEditor
                  habit={h}
                  schedules={schedules}
                  today={day}
                  onClose={() => setEditing(null)}
                />
              )}
            </li>
          )
        })}
      </ul>

      <form onSubmit={add} className="add-row">
        <input
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New habit"
          maxLength={80}
        />
        <button className="btn" type="submit" disabled={!name.trim()}>Add</button>
      </form>

      {picked && (() => {
        const h = habits.find(x => x.id === picked.habitId)
        if (!h) return null
        const entries = entriesByHabit.get(h.id) ?? new Map<string, EntryKind>()
        const completed = new Set<string>()
        for (const [d, k] of entries) if (k === 'completed') completed.add(d)
        return (
          <DayDetail
            // Keyed by the Cell: without this, opening the sheet on a second
            // day reuses the mounted component and the note draft stays stale.
            key={`${picked.habitId}-${picked.day}`}
            habit={h}
            day={picked.day}
            state={cellState(h, schedules, picked.day, day, entries, completed)}
            note={notesByHabit.get(h.id)?.get(picked.day) ?? ''}
            freeze={{
              // As of the day being frozen, not today: a Freeze is charged to
              // the month of the Day it protects (R7).
              tokens: freezeTokens(h, schedules, entries, picked.day, day),
              verdict: canFreeze(h, schedules, picked.day, day, entries, completed),
            }}
            onToggle={() => toggleDay(userId, h.id, picked.day)}
            onSaveNote={text => setNote(h.id, picked.day, text)}
            onFreeze={() => freezeDay(h, schedules, picked.day, day)}
            onUnfreeze={() => unfreezeDay(h.id, picked.day)}
            onClose={() => setPicked(null)}
          />
        )
      })()}

      {reverted.length > 0 && (
        // Said out loud rather than fixed silently: a streak that un-breaks
        // itself without explanation is worse than one that says why.
        <div className="notice" role="status">
          <p>
            {reverted.length === 1 ? 'A freeze was undone' : `${reverted.length} freezes were undone`}
            {' '}because the same token had been spent on another device:{' '}
            {reverted.map(r => `${r.habitName} on ${r.day}`).join(', ')}.
          </p>
          <button className="linkish" onClick={() => setReverted([])}>Dismiss</button>
        </div>
      )}

      <p className={status.state === 'error' ? 'error' : 'muted note'}>
        {syncLabel(status)}
        {pending > 0 && ` · ${pending} queued`}
        {status.state === 'error' && <><br />{status.message}</>}
        {' · '}
        <button className="linkish" onClick={syncNow} disabled={status.state === 'syncing'}>sync now</button>
      </p>
    </div>

    <Stats
      habits={habits}
      schedules={schedules}
      entriesByHabit={entriesByHabit}
      today={day}
      resolvedTheme={resolved}
    />
    </>
  )
}
