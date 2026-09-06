import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'theme'

/** The preference as of last boot. Also what the no-flash script in index.html reads. */
export function readStoredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'   // private mode, blocked storage
  }
}

export function storeTheme(pref: ThemePreference): void {
  try { localStorage.setItem(KEY, pref) } catch { /* storage may be blocked */ }
}

const systemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

/**
 * Resolve a preference to an actual theme and stamp it on the document.
 *
 * Two storage layers, with distinct jobs. The synced profile is where the
 * preference lives; localStorage is a cache of it, read by the inline script in
 * index.html before the bundle has parsed. Without that cache a dark-mode user
 * gets a white flash on every cold start, and no amount of syncing helps
 * because nothing has loaded yet to do the syncing.
 *
 * `remote` therefore leads and localStorage follows. While signed out there is
 * no remote, so the cached value is all there is — which is correct: a theme
 * picked on the sign-in screen should still apply on the sign-in screen.
 *
 * `data-theme` is stamped on the document element rather than passed down, so
 * CSS resolves tokens without React re-rendering anything that draws.
 */
export function useTheme(remote: ThemePreference | null, persist: (t: ThemePreference) => void) {
  const [preference, setPreference] = useState<ThemePreference>(readStoredTheme)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    const p = readStoredTheme()
    return p === 'system' ? systemTheme() : p
  })

  // Adopt the synced value. Once signed in the profile is the preference, so a
  // theme chosen on another device wins here on the next pull.
  useEffect(() => {
    if (remote === null || remote === preference) return
    setPreference(remote)
    storeTheme(remote)
  }, [remote, preference])

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
    storeTheme(next)
    setPreference(next)
    persist(next)
  }

  return { preference, resolved, choose }
}
