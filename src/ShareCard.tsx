import { useEffect, useRef, useState } from 'react'
import { renderCard, toPng, type CardRange, type CardTheme } from './lib/shareCard'
import type { ResolvedTheme } from './lib/theme'
import type { Day, EntryKind, Habit, HabitSchedule } from './lib/types'

const RANGES: { value: CardRange; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

/**
 * A preview of the image, and a button that downloads it.
 *
 * Q25 chose download-only. Nothing here uploads, hosts or links — the user is
 * handed a file, and where it goes next is their business.
 *
 * The preview is the real renderer rather than a mock of it, so what is on
 * screen is exactly what lands in the downloads folder.
 */
export default function ShareCard({
  habit, schedules, entries, today, resolvedTheme, onClose,
}: {
  habit: Habit
  schedules: readonly HabitSchedule[]
  entries: ReadonlyMap<Day, EntryKind>
  today: Day
  resolvedTheme: ResolvedTheme
  onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState<CardRange>('month')

  // Seeded from the app's theme but chosen separately from here on. A dark card
  // posted into a light thread is a decision someone should make on purpose.
  const [theme, setTheme] = useState<CardTheme>(resolvedTheme)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (canvas.current) renderCard({ habit, schedules, entries, today, range, theme }, canvas.current)
  }, [habit, schedules, entries, today, range, theme])

  useEffect(() => {
    dialog.current?.querySelector('button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function download() {
    setError(null)
    try {
      // Rendered fresh rather than read off the preview: the preview element
      // could have been resized or detached by the browser in between.
      const blob = await toPng(renderCard({ habit, schedules, entries, today, range, theme }))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const slug = habit.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'habit'
      a.href = url
      a.download = `${slug}-${today}.png`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="sheet sheet--wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${habit.name}`}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="sheet-habit">Share {habit.name}</h3>

        <div className="share-controls">
          <div className="seg seg--small" role="group" aria-label="Range">
            {RANGES.map(r => (
              <button key={r.value} aria-pressed={range === r.value} onClick={() => setRange(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="seg seg--small" role="group" aria-label="Card theme">
            {(['light', 'dark'] as CardTheme[]).map(t => (
              <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>

        <div className="share-preview">
          <canvas ref={canvas} role="img" aria-label={`${habit.name} heatmap preview`} />
        </div>

        <div className="sheet-actions">
          <button className="btn" onClick={download}>Download PNG</button>
          <button className="btn btn--quiet" onClick={onClose}>Close</button>
        </div>

        {error && <p className="error note">{error}</p>}
      </div>
    </div>
  )
}
