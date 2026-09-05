import { useCallback, useRef, useState } from 'react'
import { setHabitOrder } from './lib/store'
import type { Habit } from './lib/types'

/**
 * Pointer-driven reordering, started from a dedicated handle.
 *
 * The handle matters: each habit row contains a horizontally scrolling heatmap,
 * so a drag beginning anywhere else would be ambiguous between reordering,
 * scrolling the page and scrolling the heatmap. Restricting the gesture to a
 * grip removes the ambiguity, and `touch-action: none` on it stops the browser
 * claiming the gesture as a scroll before we see it.
 *
 * Ordering is previewed locally and only persisted on release, so a drag costs
 * one write rather than one per crossed row.
 */
export function useDragOrder(habits: readonly Habit[]) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [preview, setPreview] = useState<string[] | null>(null)
  const rows = useRef(new Map<string, HTMLElement>())

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rows.current.set(id, el)
    else rows.current.delete(id)
  }, [])

  const order = preview ?? habits.map(h => h.id)
  const ordered = order
    .map(id => habits.find(h => h.id === id))
    .filter((h): h is Habit => Boolean(h))

  const start = (e: React.PointerEvent, id: string) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragId(id)
    setPreview(habits.map(h => h.id))
  }

  const move = (e: React.PointerEvent) => {
    if (!dragId || !preview) return
    const y = e.clientY

    const overId = preview.find(id => {
      const el = rows.current.get(id)
      if (!el) return false
      const r = el.getBoundingClientRect()
      return y >= r.top && y <= r.bottom
    })
    if (!overId || overId === dragId) return

    const next = [...preview]
    const a = next.indexOf(dragId)
    const b = next.indexOf(overId)
    next[a] = overId
    next[b] = dragId
    setPreview(next)
  }

  const end = async () => {
    const finalOrder = preview
    setDragId(null)
    setPreview(null)
    if (finalOrder) await setHabitOrder(habits, finalOrder)
  }

  /** Keyboard equivalent, so the handle is not a mouse-only control. */
  const nudge = async (id: string, delta: -1 | 1) => {
    const current = habits.map(h => h.id)
    const from = current.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= current.length) return
    const next = [...current]
    next.splice(from, 1)
    next.splice(to, 0, id)
    await setHabitOrder(habits, next)
  }

  return { ordered, dragId, register, start, move, end, nudge }
}
