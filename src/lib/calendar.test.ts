import { describe, expect, it } from 'vitest'
import { addDays, buildGrid, buildMonthGrid, daysBetween, isoWeekday, parseDay } from './calendar'

describe('calendar', () => {
  it('treats Monday as 1 and Sunday as 7', () => {
    expect(isoWeekday(parseDay('2026-03-09'))).toBe(1) // Monday
    expect(isoWeekday(parseDay('2026-03-15'))).toBe(7) // Sunday
  })

  it('parses dates in local time, not UTC', () => {
    // Date.parse('2026-03-14') is UTC midnight, which is the 13th west of GMT.
    expect(parseDay('2026-03-14').getDate()).toBe(14)
  })

  it('adds days across a month boundary', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
  })

  it('adds days across a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('measures distance between days', () => {
    expect(daysBetween('2026-03-01', '2026-03-14')).toBe(13)
  })
})

describe('buildGrid', () => {
  const grid = buildGrid('2026-09-05', 365)

  it('starts every column on a Monday', () => {
    for (const week of grid.weeks) {
      expect(isoWeekday(parseDay(week[0]!))).toBe(1)
    }
  })

  it('gives every column exactly seven days', () => {
    for (const week of grid.weeks) expect(week).toHaveLength(7)
  })

  it('covers the whole window including the end day', () => {
    const flat = grid.weeks.flat()
    expect(flat).toContain('2026-09-05')
    expect(flat).toContain('2025-09-06') // 364 days earlier
  })

  it('produces 53 or 54 columns for a 365-day window', () => {
    expect(grid.weeks.length).toBeGreaterThanOrEqual(53)
    expect(grid.weeks.length).toBeLessThanOrEqual(54)
  })

  it('labels each month once, in order', () => {
    const labels = grid.monthLabels.map(m => m.label)
    expect(labels.length).toBeGreaterThanOrEqual(11)
    expect(new Set(grid.monthLabels.map(m => m.column)).size).toBe(grid.monthLabels.length)
  })
})

describe('month labels', () => {
  it('labels a month that never begins a column', () => {
    // Window ends 5 Sep 2026; the final column starts Monday 31 Aug, so no
    // column begins in September. It must still be labelled.
    const { monthLabels } = buildGrid('2026-09-05', 365)
    expect(monthLabels.map(m => m.label)).toContain('Sep')
  })

  it('labels the final column with the month it mostly covers', () => {
    const { weeks, monthLabels } = buildGrid('2026-09-05', 365)
    const last = monthLabels[monthLabels.length - 1]!
    expect(last.label).toBe('Sep')
    expect(weeks.length - last.column).toBeLessThanOrEqual(2)
  })

  it('emits labels in strictly increasing column order', () => {
    const { monthLabels } = buildGrid('2026-09-05', 365)
    const cols = monthLabels.map(m => m.column)
    expect(cols).toEqual([...cols].sort((a, b) => a - b))
  })
})

describe('label spacing', () => {
  it('never places two labels within three columns of each other', () => {
    for (const days of [35, 60, 91, 180, 365]) {
      const { monthLabels } = buildGrid('2026-09-05', days)
      for (let i = 1; i < monthLabels.length; i++) {
        expect(monthLabels[i]!.column - monthLabels[i - 1]!.column).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('still labels the trailing partial month', () => {
    const { monthLabels } = buildGrid('2026-09-05', 365)
    expect(monthLabels[monthLabels.length - 1]!.label).toBe('Sep')
  })
})

describe('buildMonthGrid', () => {
  it('covers the whole calendar month, including days not yet reached', () => {
    const { weeks } = buildMonthGrid('2026-09-05')
    const flat = weeks.flat()
    expect(flat).toContain('2026-09-01')
    expect(flat).toContain('2026-09-30')
  })

  it('pads to whole Monday-start weeks', () => {
    const { weeks } = buildMonthGrid('2026-09-05')
    for (const w of weeks) {
      expect(w).toHaveLength(7)
      expect(isoWeekday(parseDay(w[0]!))).toBe(1)
    }
  })

  it('names the month once', () => {
    expect(buildMonthGrid('2026-09-05').monthLabels).toEqual([{ column: 0, label: 'Sep 2026' }])
  })
})
