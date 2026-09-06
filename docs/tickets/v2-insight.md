# v2 — Insight

**Goal:** the app answers *"what am I actually consistent at, and what am I
letting slide?"* rather than only recording what happened.

v1 made the data trustworthy. v2 draws conclusions from it, which means the
risk is now **misleading numbers** rather than broken ones — a statistic that is
quietly wrong is worse than one that is missing, because it gets believed.

**Out of scope** (see `roadmap.md`): Freeze Tokens and Flawless Months (v3),
share images (v4), month calendar view (dropped in Q22).

---

## V2-1 · Profile sync and settings ✅

The `profiles` table has existed since v0 and nothing reads or writes it. Wire
it up: Day Start, theme, and the reminder fields.

Day Start currently sits hardcoded at 04:00 in `day.ts`. Making it a real
setting means R0 takes it from the profile, and every caller of `today()` must
be routed through that rather than the default.

`profiles` is the one table with no `deleted_at` and exactly one row per user,
so it needs its own sync path rather than being folded into the generic loop.

**Done when:** changing Day Start on one device changes what "today" means on
the other after a sync; and changing it does **not** rewrite any history, since
Completions are stored as plain dates that were already resolved (ADR 0003).

**Result:** `src/lib/profile.ts`, `src/Settings.tsx`, migration `0003`. 9 further
tests, 77 passing overall.

`profiles` rides the same outbox as everything else, so a setting changed offline
survives a reload, but it is **pulled on its own path**: the row is keyed `id`
rather than `user_id` and there is exactly one of it, so cursor paging would be
machinery around a single fetch. Migration 0003 gives it `synced_at` and the
`lww_guard` trigger — the column is unused as a cursor and exists so the table
can share the one guard function rather than needing a stamp-less copy of it.

**Day Start reaches R0 through the store, not through props.** `currentDay(userId)`
reads the profile from the mirror, and `createHabit`, `setSchedule` and
`archiveHabit` all resolve their Day through it. Passing the value in from the
component that happened to have it would mean any future caller could silently
fall back to the 04:00 default and write a Completion onto the wrong Day.

**A missing profile row renders rather than blocks.** `withDefaults` supplies the
column defaults, duplicated from `0001_init.sql` on purpose: the client cannot
ask the server what its defaults are while offline, which is exactly when it
needs them. The placeholder is stamped at the epoch so it loses every
last-write-wins comparison — a device that has never synced must not push its
defaults over a real setting.

**Theme now has one owner.** It was a hook called independently by `App` and
`HabitList`, which gave each its own copy of the state: toggling in the header
re-stamped the document but left the habit colours resolved against the previous
theme. It is now resolved once in `App` and passed down. The synced profile is
the preference and `localStorage` is a cache of it — the cache cannot be dropped,
because the no-flash script in `index.html` runs before any of this has parsed.
On first launch on a device the local choice seeds the profile, so signing in
does not silently reset the theme to `system`.

Reminder fields sync but have no UI: a toggle that sends no notification is worse
than no toggle. V2-6 adds the delivery and the control together.

**Not done:** migration 0003 has not been applied to the live project — the CLI
cannot log in from a non-TTY shell, so it needs pasting into the dashboard SQL
Editor. Until then profile settings still sync; they simply lack the stale-write
guard, so a device that was offline for a while could overwrite a newer setting.

## V2-2 · R8 — completion rate, trend, streak summary ✅

`completionRate(habit, window)` = completions ÷ opportunities within the window,
excluding out-of-range and archived spans from the denominator.

`trend` compares the current window against the immediately preceding one.

Two traps:

- **The unit must match the cadence.** For daily and weekday habits an
  opportunity is a Scheduled Day. For a weekly-quota habit it is a **week**, and
  the rate is quota-meeting weeks ÷ weeks — the same unit R4 uses for streaks.
  Counting days would let a 3×/week habit that hit quota every single week
  report roughly 43%.
- **The denominator must exclude untracked time.** A habit created five days ago
  has five opportunities, not ninety. Without this every new habit opens at a
  demoralising near-zero and the ranking is dominated by how old a habit is.

**Done when:** unit tests cover both traps, plus a habit whose cadence changed
mid-window, and a trend that reports "insufficient data" rather than a number
when the previous window holds too few opportunities to compare against.

**Result:** `src/lib/stats.ts`, documented as R8 in `derivation-rules.md`. 18
further tests, 95 passing overall.

**R8 reuses R4's units rather than re-deriving opportunities.** `rules.ts` now
exports `timeline()`, which both consume. This is what makes the unit trap
structural rather than something the rate has to remember: a weekly-quota habit
already accrues per ISO week for streak purposes, so the rate cannot count days
for it by accident. It also means the rate and the streak on one card cannot
disagree — two contradictory numbers are worse than either being absent.

Both traps and the cadence change are covered, as is the trend refusal. Three
behaviours fell out of the shared timeline that are worth naming:

- **A partial week at a window edge is dropped, not judged.** A 30-day window
  opens mid-week; scoring that week would demand a full quota from two days. The
  cost is that "30 days" may really score 21, which is why the UI must report
  the unit count rather than the window length.
- **The current week counts once its quota is met.** A target hit on Wednesday
  is not still pending on Saturday — R4's rule, inherited rather than restated.
- **`daily` → `weekdays` is not a unit change.** Both accrue per day, so that
  history stays whole; only a switch to or from `weekly_quota` splits it.

Thresholds: movement under 5 percentage points reads as steady, and a window
with fewer than 4 opportunities on either side reports `insufficient`. At three,
one unit moves the rate 33 points, so a "decline" would mean a single missed
day.

Streak summary is not here: `streaks()` already returns `current` and `longest`,
and V2-3 calls it directly rather than having R8 re-wrap it.

## V2-3 · Statistics UI ✅

Per habit: completion rate, trend, current Streak, longest Streak. Ranked so
the slipping habits are visible without hunting. Window toggle 7 / 30 / 90 /
all-time, defaulting to 30 (Q13).

**Trend is the headline, not the rate.** A habit at 80% that was at 95% last
month is the actionable signal; the rate alone hides it.

**Done when:** a habit that is slipping is identifiable at a glance, and no
statistic is shown for a habit too new to support it.

**Result:** `src/Stats.tsx`, a second card below the habit list. 4 further
tests, 99 passing overall.

**The ranking key lives in `stats.ts`, not in the component.** "A slipping habit
is identifiable without hunting" is an ordering claim, so it is testable logic
rather than presentation. `concernOf` is shortfall plus decline — how far below
perfect a habit is now, plus whatever ground it lost since the previous window.

That formula is a deliberate compromise. Ranking on trend alone buries a chronic
30% beneath every small wobble; ranking on rate alone is exactly what hides a
slide from 95% to 80%. Both are pinned by tests, in both directions. The score
is never displayed, so it cannot be misread as a measurement.

Trend sits at the end of the habit's row on its own, ahead of the rate, and is
the only element that carries colour. `insufficient` renders as "no comparison
yet" rather than as nothing — silence there reads as "no change", which is a
claim the data does not support.

A habit with no rate shows one sentence and no bar, no percentage and no trend,
and sorts to the bottom in its own order rather than being ranked against
habits that have signal.

Totals are stated in units — "4 of 6 weeks" — rather than as a share of the
window, because a weekly habit's 30-day window really scores whole weeks (V2-2).
The card says so in a footnote.

## V2-4 · Notes ✅

Free text on a Completion, edited in the day-detail sheet. Cells carrying a
note get a marker.

The column already exists on `day_entries`, so this is UI and sync only.

**Done when:** a note survives a round trip through sync, and a Cell with a note
is distinguishable from one without at a glance.

**Result:** `setNote` in `store.ts`, `useNotesByHabit`, an editor in the
day-detail sheet, and a corner fold on the Cell. 8 further tests, 107 passing
overall. `fake-indexeddb` added as a dev dependency so the store's transactional
rules can be tested at all.

**Sync needed no change.** `note` was already a column and the whole row is
upserted, so the round trip works through the existing path.

**A Note belongs to a Completion, so `setNote` is a no-op without a live entry.**
Writing one must not create an entry or revive a tombstoned one — that would
quietly turn "add a note" into "mark this day done". The test for it fails if the
guard is removed, which was checked rather than assumed.

**A Note survives an un-tick and returns if the day is ticked again.** An
accidental tap should not destroy something the user wrote; clearing is its own
explicit action. It is invisible while tombstoned, since notes are collected from
live rows only.

**Empty text stores null, never `''`**, so "has a note" stays one unambiguous
test for the marker.

**The 500-character cap is enforced client-side, not left to the column.** A
row over it is rejected by the check constraint on push, and a failed push aborts
the whole cycle — one oversized note would stall every other table's sync behind
it.

The marker is a corner fold rather than a colour or a dot: it has to stay legible
on gold, which already owns both the fill and a ring, and on all twelve hues. Only
completed Cells can carry a Note, so contrast is guaranteed.

**Not covered:** a Note on a Miss. There is no note-only state in the data model
— a live `day_entries` row *is* a Completion — so "was ill" cannot be recorded
against a day that was missed. Noted here rather than worked around.

## V2-5 · Export and import

JSON export of everything; CSV export of Completions for spreadsheets. Import
restores a JSON export.

Export is the escape hatch that makes ADR 0001's lock-in acceptable, so it must
be complete rather than convenient — habits, schedules, entries, profile.

**Import must reuse the sync merge**, not insert blindly: same keys, same
last-write-wins comparison. A naive import would duplicate every habit and
resurrect tombstoned rows.

**Done when:** exporting, clearing local data, and importing reproduces the
original state exactly; and importing the same file twice changes nothing.

## V2-6 · Daily reminder

One configurable daily nudge (Q16), suppressed when the day is already
complete, so a notification always means something.

Needs a service worker push handler, VAPID keys, a subscriptions table, and a
scheduled Supabase edge function. Android only — iOS was dropped in Q8.

**Done when:** a reminder arrives with the app closed, and does not arrive on a
day where everything scheduled was already completed.
