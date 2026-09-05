import { useState } from 'react'
import { today } from './lib/day'
import { createHabit, removeHabit, toggleDay } from './lib/store'
import { useCompletionsByHabit, useHabits, useOutboxDepth } from './lib/useLocalStore'
import Heatmap from './Heatmap'
import { useSync } from './lib/useSync'

function syncLabel(status: ReturnType<typeof useSync>['status']): string {
  switch (status.state) {
    case 'syncing': return 'syncing…'
    case 'offline': return 'offline — changes queued'
    case 'error': return `sync failed, retrying in ${status.retryInSeconds}s`
    case 'idle': return status.lastSync ? 'synced' : 'idle'
  }
}

export default function HabitList({ userId }: { userId: string }) {
  const day = today()
  const habits = useHabits(userId)
  const byHabit = useCompletionsByHabit(userId)
  const pending = useOutboxDepth()
  const { status, syncNow } = useSync(userId)
  const [name, setName] = useState('')

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
          const done = doneDays.has(day)
          return (
            <li key={h.id}>
              <div className="habit-head">
                <span className={done ? 'habit-name habit-name--done' : 'habit-name'}>{h.name}</span>
                <button
                  className="remove"
                  aria-label={`Delete ${h.name}`}
                  title={`Delete ${h.name}`}
                  onClick={() => {
                    if (confirm(`Delete "${h.name}" and all its history?`)) removeHabit(h)
                  }}
                >×</button>
              </div>
              <Heatmap
                habit={h}
                today={day}
                completed={doneDays}
                onToggle={d => toggleDay(userId, h.id, d)}
              />
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
