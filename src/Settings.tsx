import { useEffect, useState } from 'react'
import { dayStartOf, formatDayStart, saveProfile } from './lib/profile'
import { today as todayFn } from './lib/day'
import { disablePush, enablePush, isSubscribed, PushError, support } from './lib/push'
import ThemeToggle from './ThemeToggle'
import type { ThemePreference } from './lib/theme'
import type { Profile } from './lib/types'

/**
 * Day Start choices: every half hour up to noon.
 *
 * The column accepts any minute of the day, but the setting answers "when does
 * your day roll over", and an answer in the afternoon describes no one. A
 * shorter list that covers every real case beats a 1440-entry one that also
 * covers the absurd.
 */
const DAY_START_OPTIONS = Array.from({ length: 25 }, (_, i) => i * 30)

/** Reminder times: every half hour, all day. Unlike Day Start, any hour is plausible. */
const REMINDER_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30)

const DEFAULT_REMINDER = 20 * 60   // 20:00

export default function Settings({
  profile, userId, themePreference, onChooseTheme,
}: {
  profile: Profile
  userId: string
  themePreference: ThemePreference
  onChooseTheme: (t: ThemePreference) => void
}) {
  const dayStart = dayStartOf(profile)
  const day = todayFn(new Date(), dayStart)

  return (
    <div className="card">
      <h2>Settings</h2>

      <div className="setting">
        <label className="setting-label" htmlFor="day-start">Day starts at</label>
        <select
          id="day-start"
          className="input input--select"
          value={dayStart}
          onChange={e => saveProfile(userId, { day_start_minutes: Number(e.target.value) })}
        >
          {DAY_START_OPTIONS.map(m => (
            <option key={m} value={m}>{formatDayStart(m)}</option>
          ))}
        </select>
        <p className="muted note">
          Anything you tick before {formatDayStart(dayStart)} counts towards the previous
          day, so a late night still lands where you would expect. Right now that
          makes today <strong>{day}</strong>.
          <br />
          Changing this affects days from here on. Everything already recorded keeps
          the date it was recorded under.
        </p>
      </div>

      <div className="setting">
        <span className="setting-label" id="theme-label">Theme</span>
        <div aria-labelledby="theme-label">
          <ThemeToggle preference={themePreference} onChoose={onChooseTheme} />
        </div>
        <p className="muted note">Synced across your devices.</p>
      </div>

      <Reminder profile={profile} userId={userId} />
    </div>
  )
}

/**
 * The daily nudge (Q16).
 *
 * Two separate pieces of state: whether the user wants a reminder, which syncs
 * on the profile, and whether *this browser* holds a push subscription, which
 * does not. A device that has never been granted permission shows the same
 * preference as one that has, and says so.
 */
function Reminder({ profile, userId }: { profile: Profile; userId: string }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const capability = support()

  useEffect(() => { isSubscribed().then(setSubscribed) }, [])

  async function toggle(on: boolean) {
    setBusy(true)
    setError(null)
    try {
      if (on) {
        await enablePush(userId)
        setSubscribed(true)
        await saveProfile(userId, {
          reminder_enabled: true,
          reminder_minutes: profile.reminder_minutes ?? DEFAULT_REMINDER,
        })
      } else {
        await disablePush()
        setSubscribed(false)
        await saveProfile(userId, { reminder_enabled: false })
      }
    } catch (err) {
      setError(err instanceof PushError ? err.message : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const time = profile.reminder_minutes ?? DEFAULT_REMINDER
  const on = profile.reminder_enabled

  return (
    <div className="setting">
      <span className="setting-label">Daily reminder</span>

      {!capability.ok ? (
        <p className="muted note">{capability.reason}</p>
      ) : (
        <>
          <div className="row-actions">
            <button
              className="btn btn--quiet"
              aria-pressed={on}
              disabled={busy}
              onClick={() => toggle(!on)}
            >
              {busy ? 'Working…' : on ? 'Turn off' : 'Turn on'}
            </button>

            {on && (
              <select
                className="input input--select"
                aria-label="Reminder time"
                value={time}
                onChange={e => saveProfile(userId, { reminder_minutes: Number(e.target.value) })}
              >
                {REMINDER_OPTIONS.map(m => (
                  <option key={m} value={m}>{formatDayStart(m)}</option>
                ))}
              </select>
            )}
          </div>

          <p className="muted note">
            {on
              ? `A nudge at ${formatDayStart(time)}, and only on days with something still owing — if you have already done everything scheduled, nothing arrives.`
              : 'One notification a day, skipped entirely on days you have already finished.'}
            {on && subscribed === false && (
              <><br />This browser is not registered. Turn it off and on again here to fix that.</>
            )}
          </p>
        </>
      )}

      {error && <p className="error note">{error}</p>}
    </div>
  )
}
