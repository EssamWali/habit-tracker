import { useState } from 'react'
import { today as todayFn } from './lib/day'
import { createHabit, moveHabit, toggleDay } from './lib/store'
import { useEntriesByHabit, useHabits, useOutboxDepth, useSchedules } from './lib/useLocalStore'
import { useSync } from './lib/useSync'
import { useTheme } from './lib/theme'
import { hueValue } from './lib/palette'
import { OUT_OF_RANGE, cellState, resolveSchedule } from './lib/rules'
import type { EntryKind, Habit, HabitSchedule } from './lib/types'
import Heatmap, { type Range } from './Heatmap'
import HabitEditor from './HabitEditor'
import AggregateHeatmap from './AggregateHeatmap'
import DayDetail from './DayDetail'

function syncLabel(status: ReturnType<typeof useSync>['status']): string {
  switch (status.state) {
    case 'syncing': return 'syncing…'
    case 'offline': return 'offline — changes queued'
    case 'error': return `sync failed, retrying in ${status.retryInSeconds}s`
    case 'idle': return status.lastSync ? 'synced' : 'idle'
  }
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function cadenceSummary(habit: Habit, schedules: readonly HabitSchedule[], today: string): string {
  const s = resolveSchedule(habit, schedules, today, today)
  if (s === OUT_OF_RANGE) return ''
  switch (s.cadence_type) {
    case 'daily': return 'every day'
    case 'weekdays': return (s.weekdays ?? []).map(d => DAY_LETTERS[d - 1]).join(' ')
    case 'weekly_quota': return `${s.weekly_target}× per week`
  }
}

export default function HabitList({ userId }: { userId: string }) {
  const day = todayFn()
  const [showArchived, setShowArchived] = useState(false)
  const habits = useHabits(userId, showArchived)
  const schedules = useSchedules(userId)
  const entriesByHabit = useEntriesByHabit(userId)
  const pending = useOutboxDepth()
  const { status, syncNow } = useSync(userId)
  const { resolved } = useTheme()
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
        {habits.map((h, i) => {
          const entries = entriesByHabit.get(h.id) ?? new Map<string, EntryKind>()
          const open = editing === h.id
          return (
            <li key={h.id} style={{ '--habit-hue': hueValue(h.colour, resolved) } as React.CSSProperties}>
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
                <div className="reorder">
                  <button
                    aria-label={`Move ${h.name} up`}
                    disabled={i === 0}
                    onClick={() => moveHabit(habits, h.id, -1)}
                  >↑</button>
                  <button
                    aria-label={`Move ${h.name} down`}
                    disabled={i === habits.length - 1}
                    onClick={() => moveHabit(habits, h.id, 1)}
                  >↓</button>
                </div>
              </div>

              <Heatmap
                habit={h}
                schedules={schedules}
                entries={entries}
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
            habit={h}
            day={picked.day}
            state={cellState(h, schedules, picked.day, day, entries, completed)}
            onToggle={() => toggleDay(userId, h.id, picked.day)}
            onClose={() => setPicked(null)}
          />
        )
      })()}

      <p className={status.state === 'error' ? 'error' : 'muted note'}>
        {syncLabel(status)}
        {pending > 0 && ` · ${pending} queued`}
        {status.state === 'error' && <><br />{status.message}</>}
        {' · '}
        <button className="linkish" onClick={syncNow} disabled={status.state === 'syncing'}>sync now</button>
      </p>
    </div>
  )
}
