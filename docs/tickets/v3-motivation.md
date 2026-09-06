# v3 — Motivation

**Goal:** make a broken streak survivable, and make a clean month worth
something, so the tracker rewards recovery rather than only punishing lapses.

v2's risk was misleading numbers. v3's is different: **a reward system that can
be gamed is worse than none at all**, because it quietly turns the whole record
into fiction. Nearly every trap below is a loop that prints free tokens or
launders a bad month.

Weight tiers were listed for v3 on the roadmap but shipped in V1-4 — the editor
already writes Minor / Core / Unskippable as effective-dated rows. What is left
is Freezes and Flawless Months.

The rules were specified in `derivation-rules.md` as R6 and R7 during the design
interview and have not been touched since. The data model has been ready the
whole time: `day_entries.kind` already accepts `'frozen'`, R3 already returns a
`frozen` Cell state, R4 already treats a Freeze as preserving a run without
extending it, and R5 already counts one in the denominator but never the
numerator. **Nothing can create one yet.** That is the gap v3 closes.

**Out of scope:** share images (v4), and any second Freeze source — one grant
per Habit per calendar month is the only way tokens are ever minted.

---

## V3-1 · R6 — `isFlawlessMonth`

A calendar month in which a Habit was active throughout and every Scheduled Day
was completed, with no Misses and **no Freezes**.

Three conditions, each load-bearing:

- **Active for the entire month.** `start_date <= monthStart` and the Archive,
  if any, falls after `monthEnd`. A partial month never qualifies — otherwise
  creating a habit on the 28th and completing three days earns the same reward
  as a whole clean month.
- **Zero Frozen entries.** This is the one that matters most: if a Freeze did
  not disqualify, spending a token could produce the Flawless Month that
  refunds it. That is a loop which prints free tokens.
- **Cadence-relative completeness.** `daily`/`weekdays`: every Scheduled Day in
  the month has a Completion. `weekly_quota`: every ISO week **fully contained**
  in the month met its quota. Weeks straddling a month boundary belong to
  neither month, for the same reason R8 drops a partial week — a quota cannot be
  fairly demanded of four days.

**Done when:** unit tests cover a partial month, a month containing one Freeze
and no Misses, a weekly-quota month whose straddling weeks are short, and a
cadence change mid-month.

## V3-2 · R7 — the Freeze Token balance

`freezeTokens(habit, asOf) → int`. **Derived, never stored** — a stored balance
is a second source of truth that sync would have to reconcile, and the ledger
that produces it is already in the entries.

Walking calendar months from the Start Date:

- grant `+1` at the start of each month
- spend `1` per Frozen entry **dated in that month**
- at month end, an unused grant **expires** unless `isFlawlessMonth`, in which
  case it carries over
- the balance is capped at **3**

Order within a month is not cosmetic: grant, then spend, then expire. A Freeze
applied on 2 October to 28 September spends a *September* token, and it must
spend it before September's expiry runs, or the token vanishes and reappears as
a negative balance.

**Done when:** tests cover the cap, expiry after an imperfect month, carryover
after a Flawless one, and a cross-month Freeze spending the right month's grant.
Plus the loop that must not exist: a month whose only blemish is a Freeze must
not carry over.

## V3-3 · Spending and refunding a Freeze

Writing a Frozen entry, with eligibility enforced in the store rather than only
in the UI.

A Freeze may be applied only where **all** of these hold:

- the Day is within the **last 7 days** (`derivation-rules.md`, R7)
- `cellState` for that Day would otherwise be `missed`
- the balance as of that Day is at least 1

Un-freezing refunds by tombstoning the entry, exactly as un-ticking does. Since
the balance is derived, the refund needs no bookkeeping — the ledger simply
loses a spend.

The trap: a Freeze must never be writable onto a Day that is `unscheduled`,
`out_of_range`, or already `completed`. The first would let someone freeze days
they never owed and bank the difference; the third would silently downgrade a
real Completion.

**Done when:** the store refuses each ineligible case in a test, not merely the
UI, and freezing then un-freezing leaves the balance where it started.

## V3-4 · Freezes and Flawless Months in the UI

The Freeze action in the day-detail sheet, the balance shown where it can be
spent, and a Flawless Month marked somewhere it can be seen.

**A Freeze must never look like a Completion.** R3 already gives it its own Cell
state and the heatmap already renders it at reduced opacity; the sheet must say
plainly that the streak was protected and the day was not done.

The balance needs to explain itself — an unexplained "2" invites the assumption
that tokens are unlimited or purchasable. It should say where the next one comes
from.

**Done when:** the Freeze action is offered only on days it is actually allowed,
a spent token is visibly gone, and a frozen day is distinguishable from a
completed one at a glance in the heatmap.

## V3-5 · Offline overspend reconciliation

The one place the last-write-wins model does not fully resolve itself, called
out in R7 during design and deferred until there was something to reconcile.

Two devices offline can each spend the last token. Both writes are valid, both
sync, and the recomputed balance goes negative.

Resolution, per `derivation-rules.md`: keep the earliest Freezes by `updated_at`
up to the available balance, revert the excess to `missed`, and **surface what
happened** rather than fixing it silently. A streak that quietly un-breaks
itself is worse than one that explains why it broke.

This is bounded, rare and recoverable, which is why it is acceptable at all —
but it must be handled, not ignored. An unreconciled negative balance would let
the next month's grant be consumed by a debt the user cannot see.

**Done when:** a simulated double-spend reconciles deterministically regardless
of which device syncs first, and the user is told which Freeze was reverted.
