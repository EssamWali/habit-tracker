# Habit Tracker

Habits as GitHub-style heatmaps. One per habit, plus an aggregate that shades by
how much of the day you actually got through. Local-first, so it works with no
network and syncs when there is one.

Live at **[habit-tracker-gilt-two.vercel.app](https://habit-tracker-gilt-two.vercel.app)**.
Single-user: sign-ups are closed.

## What it does

- **A heatmap per habit**, in a chosen colour from a curated palette, over a
  month, quarter or year.
- **An aggregate heatmap** weighted by how much each habit counts — a day with
  an Unskippable habit done reads stronger than one with a Minor habit done.
- **Cadences**: every day, chosen weekdays, or *N* times a week.
- **Streaks**, with a gold mark once a run reaches seven (or four quota-meeting
  weeks), and a second tier beyond that.
- **Statistics**: completion rate and trend over 7 / 30 / 90 days or all time,
  ranked so a habit that is slipping surfaces without hunting for it.
- **Freeze Tokens**: one a month, spendable to keep a streak alive across a day
  you missed. Unused ones carry over only after a flawless month, up to three.
- **Notes** on a completion, **export and import**, a **daily reminder**, and a
  **shareable PNG**.

## Running it

```sh
npm install
cp .env.example .env.local     # fill in from Supabase → Project Settings → API
npm run dev
```

```sh
npm test          # 185 tests, no network or browser needed
npm run build     # typecheck, bundle, and generate the service worker
```

Postgres lives on Supabase. Migrations in `supabase/migrations/` are applied by
hand through the dashboard's SQL Editor, in order.

## Deploying

**Pushing does not deploy.** The Vercel–GitHub connection was never completed,
so a release is a manual step:

```sh
npx vercel --yes --prod
```

Then check what is live is what you built — compare the bundle hash in
`dist/assets/` against the deployed page:

```sh
curl -s https://habit-tracker-gilt-two.vercel.app/ | grep -o 'assets/index-[^"]*\.js'
```

Use the `gilt-two` alias. The `habit-tracker-<team>` one is behind Vercel's SSO
and will ask for a login.

Migrations are not deployed by any of this, and the order matters: a client that
writes a column the database does not have yet will fail *every* push, not just
that one, because a rejected batch aborts the whole sync cycle. Apply the
migration first, then deploy.

## Where the design lives

The reasoning is written down rather than remembered, and most of it predates
the code:

| | |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | The glossary. 23 terms with the words to avoid for each — read this first, it is what the rest is written in. |
| [`docs/derivation-rules.md`](docs/derivation-rules.md) | R0–R8. Every derived value, as a pure function of rows. Opens with a contradiction found during design and how it was resolved. |
| [`docs/data-model.md`](docs/data-model.md) | Four tables, and why each column is the type it is. |
| [`docs/adr/`](docs/adr/) | Four decisions with their consequences: Supabase, last-write-wins sync, dates as plain dates, and effective-dated schedules. |
| [`docs/roadmap.md`](docs/roadmap.md) | v0 through v4, and what was deliberately left out. |
| [`docs/tickets/`](docs/tickets/) | Every ticket, each with a **Result** recording what was actually built and what went wrong. |
| [`docs/reminders-setup.md`](docs/reminders-setup.md) | The runbook for switching push reminders on. |

Four ideas carry most of the weight:

- **Dates are plain dates.** A completion is `2026-09-05`, never a timestamp.
  A "day" starts at a configurable hour (04:00 by default), so a late night
  lands where you would expect. [ADR 0003](docs/adr/0003-completions-are-plain-local-dates.md)
- **Schedules are effective-dated.** Changing a cadence writes a new row rather
  than editing the old one, so loosening a habit today cannot launder last
  month. [ADR 0004](docs/adr/0004-effective-dated-cadence-and-weight.md)
- **The client owns the rules.** Nothing on the server knows what a Scheduled
  Day is — even the reminder's "already finished today?" check is answered by
  the client and written down as a date for the server to compare.
- **Everything derived is derived.** Streaks, rates, freeze balances and flawless
  months are computed from the entries on every read. Nothing is cached, so
  nothing can be stale.

## How it is built

Vite, React, TypeScript. Dexie over IndexedDB as a full local mirror; every read
in the UI goes there and never to the network. Writes land in the mirror and an
outbox in one transaction, and a background loop pushes them. Conflicts resolve
last-write-wins per row, which is only safe because a completion is set
membership on `(habit, day)` rather than a document to merge — a constraint
[ADR 0002](docs/adr/0002-local-first-last-write-wins-sync.md) spells out, along
with what would have to be reconsidered to break it.

Row-level security is the security boundary. The anon key is public by design.
`scripts/rls-isolation-test.mjs` checks that one account cannot reach another's
rows.
