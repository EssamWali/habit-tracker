# v2 — Insight

**Goal:** the app answers *"what am I actually consistent at, and what am I
letting slide?"* rather than only recording what happened.

v1 made the data trustworthy. v2 draws conclusions from it, which means the
risk is now **misleading numbers** rather than broken ones — a statistic that is
quietly wrong is worse than one that is missing, because it gets believed.

**Out of scope** (see `roadmap.md`): Freeze Tokens and Flawless Months (v3),
share images (v4), month calendar view (dropped in Q22).

---

## V2-1 · Profile sync and settings

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

## V2-2 · R8 — completion rate, trend, streak summary

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

## V2-3 · Statistics UI

Per habit: completion rate, trend, current Streak, longest Streak. Ranked so
the slipping habits are visible without hunting. Window toggle 7 / 30 / 90 /
all-time, defaulting to 30 (Q13).

**Trend is the headline, not the rate.** A habit at 80% that was at 95% last
month is the actionable signal; the rate alone hides it.

**Done when:** a habit that is slipping is identifiable at a glance, and no
statistic is shown for a habit too new to support it.

## V2-4 · Notes

Free text on a Completion, edited in the day-detail sheet. Cells carrying a
note get a marker.

The column already exists on `day_entries`, so this is UI and sync only.

**Done when:** a note survives a round trip through sync, and a Cell with a note
is distinguishable from one without at a glance.

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
