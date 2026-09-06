# Roadmap

Ordered by risk, not by visible progress. Each version ends with something
verifiable rather than something demoable.

| | Scope | Status |
|---|---|---|
| **v0** | Walking skeleton: auth, schema, RLS, local-first sync, one heatmap | ✅ complete |
| **v1** | The core loop: cadence, palette, both heatmaps, streaks, backfill | ✅ complete |
| **v2** | Insight: statistics, trend, notes, export, reminders | ✅ complete |
| **v3** | Motivation: Freeze Tokens and Flawless Months | ✅ complete — Weight tiers shipped early, in V1-4 |
| **v4** | Polish: canvas-rendered share PNG | ✅ complete |

## Deliberately excluded

- **Month calendar view** — dropped in Q22.
- **Public share links** — Q25 chose download-only. Reaching this data without
  authentication would be the only such hole in the design and deserves its own
  decision, not a side effect of wanting a pretty image.
- **Habit weighting beyond three tiers** — free-form weights make the Aggregate
  ratio non-comparable against its own past.

## Schema commitments already paid for

Both exist since v0 because retrofitting either is a migration across all history:

- `habit_schedules` is versioned, though v0's UI only ever wrote one row per habit.
- `day_entries.value` is nullable and unused, so optional per-Completion
  quantities stay a non-breaking addition. Note ADR 0002: introducing them
  requires reopening the last-write-wins decision.
