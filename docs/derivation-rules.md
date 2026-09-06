# Derivation rules

Everything visible in this app beyond raw ticks is computed. Nothing here is stored: no cached streaks, no materialised ratios, no token counters. These are pure functions over `habits`, `habit_schedules`, and `day_entries`, and they should be unit-tested in isolation with no database.

Storing any of these would mean two sources of truth reconciling across offline devices — the exact failure ADR 0002 avoids by keeping one LWW key per Cell.

---

## Resolved contradiction: what "Scheduled" means for weekly habits

Writing these rules surfaced a genuine conflict between two decisions:

- **Q12** (Aggregate denominator): a `weekly_quota` habit counts as scheduled on *every day* until its weekly quota is met, then drops out for the rest of the week.
- **Q21** (Streaks): a `weekly_quota` habit's streak is measured in *consecutive quota-meeting weeks*.

Applied naively, the first rule makes every day before quota a Scheduled Day, so any day you don't go to the gym is a **Miss** — and a Flawless Month would require doing a 3×/week habit on Monday, Tuesday and Wednesday of every single week. That is absurd and was never the intent.

**Resolution — the two rules answer different questions, and only one is about failure:**

| | daily / weekdays | weekly_quota |
|---|---|---|
| Aggregate denominator | per-day (Q12) | per-day, until quota met (Q12) |
| Miss / Streak / Flawless | per-day | **per-week** |

So `isScheduled(habit, day)` exists **solely** to compute the Aggregate Heatmap's denominator. It must never be used to decide whether something was missed. A `weekly_quota` habit has **no daily Misses at all**: an uncompleted day renders `unscheduled`, and failure is recorded at week granularity. Two distinct functions, deliberately not merged.

---

## R0 · `today(now, dayStartMinutes) → Date`

Subtract `dayStartMinutes` from local wall-clock `now`; take the calendar date of the result. At 01:30 with the 04:00 default this returns *yesterday*. This is the only place clock time is ever consulted.

## R1 · `resolveSchedule(habit, day) → {cadence, weight} | OUT_OF_RANGE`

`OUT_OF_RANGE` if `day < habit.start_date`, or `habit.archived_at` is set and `day >= archived_at`, or `day > today()`. Otherwise the `habit_schedules` row with the greatest `effective_from <= day`.

Never read a habit's *current* schedule to judge a historical day (ADR 0004).

## R2 · `isScheduled(habit, day) → bool` — Aggregate denominator only

- `OUT_OF_RANGE` → false
- `daily` → true
- `weekdays` → `isoWeekday(day) ∈ weekdays`
- `weekly_quota` → `completionsInWeekBefore(habit, day) < weekly_target`

Weeks are **ISO weeks, Monday-start**, and the heatmap grid uses Monday-start rows to match. Decided explicitly, and a deliberate divergence from GitHub, which renders Sunday-start.

## R3 · `cellState(habit, day) → completed | frozen | missed | unscheduled | out_of_range`

1. `resolveSchedule` returns `OUT_OF_RANGE` → `out_of_range` (covers before Start Date, on/after Archive, **and future days**)
2. entry exists → its `kind` (`completed` or `frozen`)
3. cadence is `weekly_quota` → `unscheduled` — never `missed`, per the resolution above
4. `isScheduled` → `missed`
5. otherwise → `unscheduled`

## R4 · `streaks(habit) → {current, longest, goldRuns}`

**Unit of iteration depends on cadence**: Scheduled Days for `daily`/`weekdays`; ISO weeks for `weekly_quota` (a week qualifies when completions in it `>= weekly_target`).

Walking the history, a run extends on a qualifying unit and ends on a failing one. A **Freeze preserves a run but does not extend it** — you did not do the habit, so it neither breaks the streak nor adds to its length. A 7-length run may therefore span 8 scheduled days.

**Gold thresholds** (Q21, cadence-relative):

| cadence | gold | second tier |
|---|---|---|
| daily, weekdays | 7 consecutive completions | 30 |
| weekly_quota | 4 consecutive qualifying weeks | 12 |

**Gold is a property of runs, not of state.** Compute all maximal runs across full history and mark every completion in any run reaching threshold. Both "gold applies retroactively to the whole run" and "gold survives breaking the streak" fall out of this automatically — there is no persistence logic to write, and no flag to store.

## R5 · `aggregate(day) → {ratio, band, isPerfectDay}`

Over all non-`OUT_OF_RANGE` habits, using each habit's weight resolved **as of `day`**:

- `isScheduled(habit, day)` → `denominator += weight`
- entry `kind = completed` → `numerator += weight`
- entry `kind = frozen` → contributes to denominator only; a Freeze never counts toward completion (glossary)
- completed while *not* scheduled (bonus) → numerator only, then clamp `ratio` to 1.0

  Note: the UI no longer *offers* a tick on an unscheduled day — declaring a cadence and then inviting a completion outside it undermines the cadence. The rule stays because such entries can still arise from a cadence change, and must be scored when they do.

`denominator == 0` → render **neutral/unscheduled, never 0%**. A rest day is not a failure.

Bands: `(0, .25]`, `(.25, .5]`, `(.5, .75]`, `(.75, 1]`, with `ratio == 0 && denominator > 0` rendering as the empty-but-owed state.

**`isPerfectDay` is structural, not a ratio test.** It is true when `denominator > 0` and *no* scheduled habit lacks a `completed` entry. Testing `ratio >= 1.0` is wrong: bonus completions can push the numerator to the denominator while a scheduled habit was actually missed, falsely awarding a Perfect Day. Freezes also break it.

## R6 · `isFlawlessMonth(habit, month) → bool`

1. Habit active for the **entire** calendar month: `start_date <= monthStart` and (`archived_at` null or `archived_at > monthEnd`). Partial months never qualify.
2. Zero `frozen` entries in the month.
3. `daily`/`weekdays`: every Scheduled Day in the month has a `completed` entry. `weekly_quota`: every ISO week **fully contained** in the month met its quota.

Freezes must disqualify: otherwise spending a token could produce the Flawless Month that refunds it, a loop that prints free tokens.

## R7 · `freezeTokens(habit, asOf) → int`

Derived, never stored. Walking months from `start_date`:

- grant `+1` at the start of each calendar month
- at month end, an unused grant **expires** unless `isFlawlessMonth` — in which case it carries over
- balance is capped at **3**
- each `frozen` entry spends 1

A Freeze may only be applied to a day within the **last 7 days**, and only where `cellState` would otherwise be `missed`.

**Offline overspend.** Two devices offline can each spend the last token. On sync the balance recomputes negative; resolve by keeping the earliest freezes by `updated_at` up to the available balance and reverting the excess to `missed`, then surfacing what happened. This is the one place the LWW model does not fully self-resolve, and it is bounded, rare, and recoverable rather than silent.

## R8 · `habitStats(habit, window) → {rate, trend}`

The statistics rule. v1 made the data trustworthy; v2 draws conclusions from it, which moves the risk from broken numbers to *misleading* ones — a statistic that is quietly wrong is worse than one that is missing, because it gets believed.

Derived from the **same units R4 uses for streaks**, not from a second reading of the entries. A rate with its own private notion of an opportunity would be free to disagree with the streak shown beside it, and two numbers on one card that contradict each other are worse than either being absent.

`rate = hits / opportunities`, where an opportunity is one unit that has resolved:

- `pending` units are excluded from both sides. An unfinished today is not yet a failure.
- `frozen` units are excluded from both sides. A Freeze is neither a Completion nor a Miss, so counting one in the denominator would push the rate down for something that did not go wrong.
- `opportunities == 0` → `rate` is **null**, never 0%. No statistic is shown for a habit too new to support one.

**The unit follows the cadence.** `daily` and `weekdays` accrue per Scheduled Day; `weekly_quota` accrues per ISO week, and its rate is quota-meeting weeks ÷ weeks. Counting days for a weekly habit is the headline failure mode: a 3×/week habit that hit quota every single week would report roughly 43%.

**A unit belongs to a window when its anchor does** — the Day itself, or the week's Monday. A week only partly inside the window is therefore dropped rather than judged, since scoring it would demand a full quota from a fraction of a week. The cost is that a 30-day window may really score 21 days' worth of weeks, which is why the UI reports the unit count rather than the window length.

**A cadence change splits history by unit, and only the most recent unit is counted.** Days and weeks are not commensurable, so the older regime is dropped rather than blended — the same reason R4 ends a run when the unit changes. `daily` → `weekdays` is *not* such a change: both accrue per day, so that history stays whole.

**The denominator excludes untracked time.** Opportunities exist only between the Start Date and an Archive, and never in the future — all three fall out of R1 returning `OUT_OF_RANGE`. A habit created five days ago has five opportunities, not ninety. Without this every new habit opens at a demoralising near-zero and any ranking measures nothing but how old each habit is.

### Trend

Compares the window against the one immediately preceding it, of equal length. Reported as a percentage-point change, with movement under **5 points** called steady rather than given a direction.

**It refuses to answer more often than it rounds.** `insufficient` when either window holds fewer than **4** opportunities, and always for the all-time window, which has nothing before it. At three opportunities a single unit moves the rate by 33 points, so "down 33%" would mean "missed one day" — a reading that sends someone chasing a decline that never happened. A habit three weeks old has no month before last, and inventing a direction for it would manufacture the exact signal the user is being asked to act on.
