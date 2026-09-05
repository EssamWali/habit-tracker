/**
 * The curated Palette (Q15). Free hex picking produces colours that vanish in
 * dark mode, collide with gold, or are indistinguishable from one another, so
 * habits choose from a fixed set with contrast-checked values per theme.
 *
 * Gold, the empty-cell grey, and the Aggregate Heatmap's ramp are reserved and
 * cannot be claimed by a habit.
 */

export interface Hue {
  key: string
  name: string
  light: string
  dark: string
}

export const PALETTE: readonly Hue[] = [
  { key: 'emerald', name: 'Emerald', light: '#059669', dark: '#34d399' },
  { key: 'green',   name: 'Green',   light: '#16a34a', dark: '#4ade80' },
  { key: 'lime',    name: 'Lime',    light: '#65a30d', dark: '#a3e635' },
  { key: 'teal',    name: 'Teal',    light: '#0d9488', dark: '#2dd4bf' },
  { key: 'cyan',    name: 'Cyan',    light: '#0891b2', dark: '#22d3ee' },
  { key: 'blue',    name: 'Blue',    light: '#2563eb', dark: '#60a5fa' },
  { key: 'indigo',  name: 'Indigo',  light: '#4f46e5', dark: '#818cf8' },
  { key: 'purple',  name: 'Purple',  light: '#7c3aed', dark: '#a78bfa' },
  { key: 'magenta', name: 'Magenta', light: '#c026d3', dark: '#e879f9' },
  { key: 'rose',    name: 'Rose',    light: '#e11d48', dark: '#fb7185' },
  { key: 'red',     name: 'Red',     light: '#dc2626', dark: '#f87171' },
  { key: 'orange',  name: 'Orange',  light: '#ea580c', dark: '#fb923c' },
]

export const DEFAULT_HUE = 'emerald'

const BY_KEY = new Map(PALETTE.map(h => [h.key, h]))

/** Falls back to the default rather than throwing: a habit synced from a build
 *  with a different palette must still render. */
export function hueValue(key: string, theme: 'light' | 'dark'): string {
  const hue = BY_KEY.get(key) ?? BY_KEY.get(DEFAULT_HUE)!
  return theme === 'light' ? hue.light : hue.dark
}
