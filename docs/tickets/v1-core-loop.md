# v1 — The core loop

**Goal:** the product described in the design session. v0 proved the plumbing;
v1 is where the thing becomes worth using.

The risk has moved from infrastructure to **logic**. R1–R7 are pure functions
over local data, so most of v1 is verifiable by `npm test` rather than by
toggling squares on a phone. Rules come first: everything else consumes them.

**Out of scope for v1** (see `roadmap.md`): statistics and trend, notes, export,
reminders, Freeze Tokens, Flawless Months, share images.

---

## V1-1 · R1 + R2 — schedule resolution and scheduled days ✅

`resolveSchedule(habit, day)` returns the `habit_schedules` row in force *on
that day*, or `OUT_OF_RANGE` for days before Start Date, on/after Archive, or in
the future. `isScheduled(habit, day)` answers the Aggregate denominator question
only — never whether something was missed.

**Result:** `src/lib/rules.ts`, 16 tests. Resolution scans for the latest `effective_from` at or before the day regardless of array order, and ignores tombstoned rows and rows belonging to other habits.

**Done when:** unit tests cover a habit whose cadence changed mid-history and
prove the old schedule still governs old days (ADR 0004); a `weekly_quota`
habit entering and leaving the denominator as its quota is met and the week
rolls over; and all three OUT_OF_RANGE boundaries.

## V1-2 · R3 + R4 — cell state, streaks, gold ✅

`cellState` returns `completed | frozen | missed | unscheduled | out_of_range`.
`streaks` iterates Scheduled Days for daily/weekday habits and ISO weeks for
`weekly_quota`, returning current, longest, and the gold runs.

Implement the Freeze branch now even though no UI creates one until v3 —
retrofitting it into the streak walk later means rewriting it.

**Result:** 16 further tests, 53 passing overall.

Two rules the design never settled, decided here and documented in the source:

- **A change of cadence *type* ends the current run.** The unit of measurement changes with it, so carrying a count of days into a regime measured in weeks compares unlike things. Changing which weekdays, or the weekly target, does *not* break a run — the unit is unchanged.
- **The current unit is pending, not failed.** Otherwise an unfinished today reads as a broken streak every morning. For weekly habits the current ISO week is likewise pending until it either meets quota or ends.

Also settled: for a weekly-quota habit a Freeze protects the *week*, since the week is the unit a token can meaningfully buy.

**Done when:** tests prove a `weekly_quota` habit never produces a daily Miss;
gold applies retroactively across a whole run and survives the streak breaking
(both fall out of computing runs over full history, so neither needs stored
state); thresholds are cadence-relative — 7/30 consecutive completions for
daily and weekday habits, 4/12 consecutive quota-meeting weeks for weekly ones;
and a Freeze preserves a run without extending it.

## V1-3 · R5 — aggregate ratio

Weighted ratio per day: `sum(weight of completed scheduled) ÷ sum(weight of
scheduled)`, weights resolved as of that day. Four bands. Zero denominator
renders neutral, never 0%.

**Done when:** tests prove a Freeze counts toward the denominator but never the
numerator; bonus completions on unscheduled habits raise the numerator and clamp
at 1.0; a rest day with nothing scheduled is neutral rather than a failure; and
**`isPerfectDay` is structural, not `ratio >= 1.0`** — a bonus completion can
push the numerator to the denominator while a scheduled habit was actually
missed, and that must not award a Perfect Day.

## V1-4 · Cadence and weight editing

Create/edit a habit with a name, colour, cadence (`daily`, chosen weekdays, or
N per week) and Weight (Minor / Core / Unskippable).

Editing cadence or weight **writes a new `habit_schedules` row** dated today. It
never updates the existing one — that is the whole point of ADR 0004.

**Done when:** changing a habit's cadence leaves its historical Cells scored
under the old cadence, verified in the UI and not only in tests.

## V1-5 · Palette and dark mode

Twelve curated hues, each with contrast-checked light and dark ramps. Gold,
neutral grey, and the Aggregate Heatmap's own hue are reserved and unselectable.
Theme follows the system preference with a manual override.

**Done when:** every hue is legible against both backgrounds, no habit colour
can be confused with gold or with the empty-cell grey, and the override persists
across a reload.

## V1-6 · Habit heatmap

Replace v0's two-tone grid with real Cell states: habit colour for completed,
grey for missed, blank for unscheduled and out-of-range, gold for runs past
threshold, and the second-tier treatment at 30 days / 12 weeks.

**Done when:** a habit with a weekday cadence shows blanks — not grey misses —
on days it was never scheduled.

## V1-7 · Aggregate heatmap

One grid over all habits, the only one with graduated shading, using R5. Perfect
Days get a distinct treatment above the top band. Pinned above the habit list.

**Done when:** it reads correctly on a day mixing a completed Unskippable habit
with a missed Minor one — the weighting must be visible, not merely implemented.

## V1-8 · Backfill

Tapping any past Cell opens a day detail with a completion toggle. Unlimited
backfill (Q14): no lookback window, no flag marking backfilled entries.

**Done when:** a past day can be corrected on a phone without mis-taps — which
means the target is the detail sheet, not a 10px square.

## V1-9 · Archive, delete, start date

Archive keeps history and stops accruing Misses from the archive date; it is
reversible, and pausing is archive-then-restore rather than a third concept.
Delete is irreversible and needs a typed confirmation. Start Date is editable so
a long-running habit can be backdated.

**Done when:** an archived habit disappears from the dashboard, keeps its
history, and stops affecting the Aggregate denominator from its archive date.

## V1-10 · Reordering

Drag to reorder, writing `sort_order`. Flat list, no grouping (Q20).

**Done when:** an order set on desktop survives a sync and appears on the phone.

## V1-11 · Layout and accessibility pass

Mobile heatmap scrolling, tap targets at least 24px, keyboard navigation, focus
states, and `aria-pressed` on every toggle.

**Done when:** the whole app is operable by keyboard, and the page never scrolls
horizontally at 360px.
