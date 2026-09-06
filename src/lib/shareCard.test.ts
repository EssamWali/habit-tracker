import { describe, expect, it } from 'vitest'
import { cardFacts, cellPaint, INK } from './shareCard'
import type { CellState } from './rules'

/**
 * v4's risk is an image that misrepresents the data.
 *
 * A number on screen is corrected by the next render. A PNG is a claim that
 * outlives the app and travels without the context that would correct it, so
 * these tests are about what the file asserts rather than how it looks.
 */

const HUE = '#059669'
const ink = INK.light

const paint = (state: CellState, gilded = false, tier2 = false) =>
  cellPaint(state, HUE, gilded, tier2, ink)

/** A paint reduced to a comparable shape. */
const shape = (state: CellState, gilded = false, tier2 = false) =>
  JSON.stringify(paint(state, gilded, tier2))

describe('cellPaint', () => {
  /**
   * The one that matters most. v3 made a frozen Cell hollow because a faded
   * fill reads as a weaker Completion — an image that gets this wrong publishes
   * a claim the user never made.
   */
  it('never paints a Freeze like a Completion', () => {
    const frozen = paint('frozen')
    const completed = paint('completed')

    expect(frozen.fill).not.toBe(completed.fill)
    expect(frozen.fill).toBe(ink.bg)        // hollow
    expect(frozen.ring).toBe(HUE)           // but located and coloured
    expect(completed.ring).toBeNull()
  })

  it('keeps every state visually distinct', () => {
    const states: CellState[] = ['completed', 'frozen', 'missed', 'unscheduled', 'out_of_range']
    const shapes = states.map(s => shape(s))
    expect(new Set(shapes).size).toBe(states.length)
  })

  it('draws nothing at all for an unscheduled day', () => {
    // As in the grid: any fill reads at this size as "a day you missed" rather
    // than "a day this habit does not apply to".
    expect(paint('unscheduled')).toEqual({ fill: null, ring: null, ringWidth: 0 })
  })

  it('replaces the habit colour with gold on a gilded day', () => {
    expect(paint('completed', true).fill).toBe(ink.gold)
    expect(paint('completed', false).fill).toBe(HUE)
  })

  it('distinguishes the second gold tier by a ring, not another colour', () => {
    const tier1 = paint('completed', true, false)
    const tier2 = paint('completed', true, true)
    expect(tier2.fill).toBe(tier1.fill)
    expect(tier2.ring).toBe(ink.goldRing)
    expect(tier1.ring).toBeNull()
  })

  it("uses each theme's own ink", () => {
    expect(cellPaint('missed', HUE, false, false, INK.dark).fill).toBe(INK.dark.missed)
    expect(cellPaint('missed', HUE, false, false, INK.light).fill).toBe(INK.light.missed)
  })
})

describe('cardFacts', () => {
  const streak = { current: 5, longest: 12 }

  it('states every figure in days for a daily habit', () => {
    const facts = cardFacts('day', streak, { hits: 24, opportunities: 30, rate: 0.8 })
    expect(facts).toEqual(['5 days running', 'best 12 days', '24 of 30 days'])
  })

  /**
   * The misleading number v2 was built to avoid, and worse here: a weekly-quota
   * habit counts weeks, and a bare percentage in a shared image cannot be
   * corrected by the next render.
   */
  it('states them in weeks for a weekly-quota habit', () => {
    const facts = cardFacts('week', streak, { hits: 4, opportunities: 4, rate: 1 })
    expect(facts).toEqual(['5 weeks running', 'best 12 weeks', '4 of 4 weeks'])
    expect(facts.join(' ')).not.toContain('day')
  })

  it('omits a rate the data cannot support rather than printing 0%', () => {
    const facts = cardFacts('day', { current: 0, longest: 0 }, { hits: 0, opportunities: 0, rate: null })
    expect(facts).toEqual([])
  })

  it('leaves out a streak that does not exist', () => {
    const facts = cardFacts('day', { current: 0, longest: 3 }, { hits: 1, opportunities: 2, rate: 0.5 })
    expect(facts).toEqual(['best 3 days', '1 of 2 days'])
  })

  it('says day rather than days for one', () => {
    const facts = cardFacts('day', { current: 1, longest: 1 }, { hits: 1, opportunities: 1, rate: 1 })
    expect(facts).toEqual(['1 day running', 'best 1 day', '1 of 1 day'])
  })
})
