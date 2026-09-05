import { useState } from 'react'
import { today as todayFn } from './lib/day'
import { createHabit, removeHabit, toggleDay } from './lib/store'
import { useCompletionsByHabit, useHabits, useOutboxDepth, useSchedules } from './lib/useLocalStore'
import { useSync } from './lib/useSync'
import { useTheme } from './lib/theme'
import { hueValue } from './lib/palette'
import { OUT_OF_RANGE, resolveSchedule } from './lib/rules'
import type { Habit, HabitSchedule } from './lib/types'
import Heatmap from './Heatmap'
import HabitEditor from './HabitEditor'

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
  const habits = useHabits(userId)
  const schedules = useSchedules(userId)
  const byHabit = useCompletionsByHabit(userId)
  const pending = useOutboxDepth()
  const { status, syncNow } = useSync(userId)
  const { resolved } = useTheme()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setName('')
    await createHabit(userId, { name: trimmed })
  }

  return (
    <div className="card">
      <h2>Today · {day}</h2>

      {habits.length === 0 && <p className="muted">No habits yet. Add one below.</p>}

      <ul className="habits">
        {habits.map(h => {
          const doneDays = byHabit.get(h.id) ?? new Set<string>()
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
                <button
                  className="remove"
                  aria-label={`Delete ${h.name}`}
                  onClick={() => { if (confirm(`Delete "${h.name}" and all its history?`)) removeHabit(h) }}
                >×</button>
              </div>

              <Heatmap
                habit={h}
                today={day}
                completed={doneDays}
                onToggle={d => toggleDay(userId, h.id, d)}
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
