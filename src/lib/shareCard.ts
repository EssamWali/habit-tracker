import { buildGrid, buildMonthGrid, parseDay } from './calendar'
import { cellState, streaks, type CellState } from './rules'
import { habitStats, type StatWindow } from './stats'
import { hueValue } from './palette'
import type { Day, EntryKind, Habit, HabitSchedule } from './types'

/**
 * The share card (v4).
 *
 * Q25 chose download-only: this produces a file and nothing else. There is no
 * upload, no host, no link.
 *
 * The risk here is narrow but real — **an image that misrepresents the data**. A
 * number on screen is corrected by the next render; a PNG is a claim that
 * outlives the app and travels without the context that would correct it. So
 * every figure carries its unit, a figure with too little history behind it is
 * omitted rather than rounded, and the Cell states stay as distinct here as they
 * are in the grid.
 *
 * Nothing in this file reads the DOM. No `getComputedStyle`, no measuring a
 * mounted grid, no cloning nodes: the image is derived from the same rows and
 * the same rules as the on-screen heatmap, so the two cannot disagree, and a
 * card can be produced for a habit that is not currently displayed.
 */

export type CardTheme = 'light' | 'dark'
export type CardRange = 'month' | 'quarter' | 'year'

const RANGE_DAYS: Record<Exclude<CardRange, 'month'>, number> = { quarter: 91, year: 365 }

const RANGE_WINDOW: Record<CardRange, StatWindow> = {
  month: 30, quarter: 90, year: 'all',
}

const RANGE_LABEL: Record<CardRange, string> = {
  month: 'this month', quarter: 'the last 90 days', year: 'the last year',
}

/**
 * Card colours, taken from the token values in index.css rather than read out
 * of it. A CSS custom property resolves against whatever theme is active on the
 * element it is read from, which would make the output depend on where in the
 * tree the render happened.
 */
export interface Ink {
  bg: string; panel: string; fg: string; muted: string; line: string
  empty: string; missed: string; void: string; gold: string; goldRing: string
}

export const INK: Record<CardTheme, Ink> = {
  light: {
    bg: '#ffffff', panel: '#ffffff', fg: '#1f2328', muted: '#656d76',
    line: '#d1d9e0', empty: '#ebedf0', missed: '#ebedf0', void: '#fbfcfd',
    gold: '#d4a017', goldRing: '#fde68a',
  },
  dark: {
    bg: '#0d1117', panel: '#151b23', fg: '#e6edf3', muted: '#9198a1',
    line: '#3d444d', empty: '#21262d', missed: '#21262d', void: '#11161d',
    gold: '#e3b341', goldRing: '#f0d68a',
  },
}

const CELL = 11
const GAP = 3
const STEP = CELL + GAP
const PAD = 28
const HEADER = 78
const FOOTER = 58

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export interface CardInput {
  habit: Habit
  schedules: readonly HabitSchedule[]
  entries: ReadonlyMap<Day, EntryKind>
  today: Day
  range: CardRange
  theme: CardTheme
}

/** Rounded rectangle. Older Safari lacks `roundRect`, so it is drawn by hand. */
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

/** Trim to fit, with an ellipsis, rather than letting a long name run off the card. */
function fit(c: CanvasRenderingContext2D, text: string, max: number): string {
  if (c.measureText(text).width <= max) return text
  let out = text
  while (out.length > 1 && c.measureText(`${out}…`).width > max) out = out.slice(0, -1)
  return `${out}…`
}

/** How one Cell is painted. Separated from the drawing so it can be asserted on. */
export interface CellPaint {
  fill: string | null
  ring: string | null
  ringWidth: number
}

/**
 * The paint for one Cell state.
 *
 * Pure, and exported, because the risk in a shared image is that it
 * *misrepresents*. The states that must not blur together are completed, gold,
 * frozen and missed — frozen above all: v3 made it hollow precisely because a
 * faded fill reads as a weaker Completion, and an image that gets that wrong
 * publishes a claim the user never made.
 */
export function cellPaint(
  state: CellState, hue: string, gilded: boolean, tier2: boolean, ink: Ink,
): CellPaint {
  switch (state) {
    case 'unscheduled':
      return { fill: null, ring: null, ringWidth: 0 }        // drawn as nothing
    case 'out_of_range':
      return { fill: ink.void, ring: null, ringWidth: 0 }
    case 'frozen':
      // Hollow, ringed in the habit's colour: the day was NOT done.
      return { fill: ink.bg, ring: hue, ringWidth: 2 }
    case 'missed':
      return { fill: ink.missed, ring: null, ringWidth: 0 }
    case 'completed':
      return gilded
        ? { fill: ink.gold, ring: tier2 ? ink.goldRing : null, ringWidth: 1.5 }
        : { fill: hue, ring: null, ringWidth: 0 }
  }
}

function drawCell(
  c: CanvasRenderingContext2D,
  x: number, y: number,
  paint: CellPaint,
) {
  if (paint.fill !== null) {
    c.fillStyle = paint.fill
    roundRect(c, x, y, CELL, CELL, 2)
    c.fill()
  }
  if (paint.ring !== null) {
    const inset = paint.ringWidth / 2
    c.strokeStyle = paint.ring
    c.lineWidth = paint.ringWidth
    roundRect(c, x + inset, y + inset, CELL - paint.ringWidth, CELL - paint.ringWidth, 1.5)
    c.stroke()
  }
}

/**
 * The figures quoted under the grid.
 *
 * **Every figure carries its unit, and one with too little behind it is left
 * out rather than rounded.** R8's whole design is that a weekly-quota habit is
 * measured in weeks, so a bare "82%" is exactly the misleading number v2 was
 * built to avoid — and it is worse here, because the image outlives the screen
 * and travels without the context that would correct it.
 */
export function cardFacts(
  unit: 'day' | 'week',
  streak: { current: number; longest: number },
  rate: { hits: number; opportunities: number; rate: number | null },
): string[] {
  const plural = (n: number) =>
    unit === 'week' ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'day' : 'days')

  const facts: string[] = []
  if (streak.current > 0) facts.push(`${streak.current} ${plural(streak.current)} running`)
  if (streak.longest > 0) facts.push(`best ${streak.longest} ${plural(streak.longest)}`)
  // A null rate means the window held no opportunities at all. Quoting 0% there
  // would state a failure that never happened.
  if (rate.rate !== null) {
    facts.push(`${rate.hits} of ${rate.opportunities} ${plural(rate.opportunities)}`)
  }
  return facts
}

/**
 * Render a share card.
 *
 * Drawn at `devicePixelRatio` (floor 2) and scaled, or the file is blurry on
 * every modern screen.
 */
export function renderCard(input: CardInput, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const { habit, schedules, entries, today, range, theme } = input
  const ink = INK[theme]
  const hue = hueValue(habit.colour, theme)

  const { weeks } = range === 'month'
    ? buildMonthGrid(today)
    : buildGrid(today, RANGE_DAYS[range])

  const gridWidth = weeks.length * STEP - GAP
  const gridHeight = 7 * STEP - GAP

  const width = gridWidth + PAD * 2
  const height = HEADER + gridHeight + FOOTER + PAD

  const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1))
  const el = canvas ?? document.createElement('canvas')
  el.width = width * scale
  el.height = height * scale
  el.style.width = `${width}px`
  el.style.height = `${height}px`

  const c = el.getContext('2d')!
  c.setTransform(scale, 0, 0, scale, 0, 0)

  c.fillStyle = ink.bg
  c.fillRect(0, 0, width, height)

  /* ------------------------------------------------------------- header -- */

  c.textBaseline = 'alphabetic'
  c.fillStyle = hue
  roundRect(c, PAD, PAD - 2, 10, 10, 3)
  c.fill()

  c.fillStyle = ink.fg
  c.font = `600 19px ${FONT}`
  c.fillText(fit(c, habit.name, gridWidth - 22), PAD + 18, PAD + 8)

  c.fillStyle = ink.muted
  c.font = `13px ${FONT}`
  c.fillText(RANGE_LABEL[range], PAD, PAD + 32)

  /* --------------------------------------------------------------- grid -- */

  const completed = new Set<Day>()
  for (const [d, k] of entries) if (k === 'completed') completed.add(d)
  const { gold, tier2, current, longest } = streaks(habit, schedules, entries, today)

  const top = HEADER
  weeks.forEach((week, col) => {
    week.forEach((day, row) => {
      const state = cellState(habit, schedules, day, today, entries, completed)
      const paint = cellPaint(state, hue, state === 'completed' && gold.has(day), tier2.has(day), ink)
      drawCell(c, PAD + col * STEP, top + row * STEP, paint)
    })
  })

  /* ------------------------------------------------------------- footer -- */

  const stats = habitStats(habit, schedules, entries, today, RANGE_WINDOW[range])
  const facts = cardFacts(stats.current.unit, { current, longest }, stats.current)

  const footerY = top + gridHeight + 30
  c.strokeStyle = ink.line
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(PAD, footerY - 16)
  c.lineTo(width - PAD, footerY - 16)
  c.stroke()

  c.fillStyle = ink.muted
  c.font = `13px ${FONT}`
  c.fillText(fit(c, facts.join('  ·  ') || 'Just getting started', gridWidth), PAD, footerY + 6)

  c.fillStyle = ink.line
  c.font = `11px ${FONT}`
  const stamp = parseDay(today).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const label = `Habit Tracker · ${stamp}`
  c.fillText(label, width - PAD - c.measureText(label).width, footerY + 26)

  return el
}

/** The card as a PNG blob, ready to be handed to the browser. */
export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('The browser could not encode the image.'))),
      'image/png',
    )
  })
}
