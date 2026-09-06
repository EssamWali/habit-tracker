import { dayStartOf, formatDayStart, saveProfile } from './lib/profile'
import { today as todayFn } from './lib/day'
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
    </div>
  )
}
