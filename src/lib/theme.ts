import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'theme'

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'   // private mode, blocked storage
  }
}

const systemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

/**
 * Theme preference with a manual override on top of the system setting.
 *
 * `data-theme` is stamped on the document element so CSS can resolve tokens
 * without React re-rendering anything that draws.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(read)
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    read() === 'system' ? systemTheme() : (read() as ResolvedTheme))

  useEffect(() => {
    const apply = () => {
      const next = preference === 'system' ? systemTheme() : preference
      setResolved(next)
      document.documentElement.dataset.theme = next
    }
    apply()

    if (preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [preference])

  const choose = (next: ThemePreference) => {
    try { localStorage.setItem(KEY, next) } catch { /* storage may be blocked */ }
    setPreference(next)
  }

  return { preference, resolved, choose }
}
