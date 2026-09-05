import type { ThemePreference } from './lib/theme'

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export default function ThemeToggle({
  preference, onChoose,
}: { preference: ThemePreference; onChoose: (t: ThemePreference) => void }) {
  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map(o => (
        <button
          key={o.value}
          aria-pressed={preference === o.value}
          onClick={() => onChoose(o.value)}
        >{o.label}</button>
      ))}
    </div>
  )
}
