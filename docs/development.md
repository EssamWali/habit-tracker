# Development

How to run, test, release and check the app. The README covers what it is; this
file covers working on it.

## Running locally

```sh
npm install
cp .env.example .env.local     # fill in from Supabase → Project Settings → API
npm run dev
```

```sh
npm test          # vitest, no network or browser needed
npm run typecheck # tsc -b --noEmit
npm run build     # typecheck, bundle, and generate the service worker
npm run preview   # serve the built bundle on the LAN
```

Tests run against `fake-indexeddb`, so the Dexie store and sync code are
exercised without a browser or a Supabase project.

## Database migrations

Postgres lives on Supabase. Migrations in `supabase/migrations/` are applied by
hand through the dashboard's SQL Editor, in order:

| File | Adds |
|---|---|
| `0001_init.sql` | The four tables, row-level security, and the `lww_guard` trigger |
| `0002_synced_at.sql` | `synced_at` cursor column for incremental pull |
| `0003_profiles_sync.sql` | Profiles included in sync |
| `0004_reminders.sql` | Reminder columns and `due_reminders()` |
| `0005_reminder_requires_a_habit.sql` | `due_reminders()` skips accounts with no live Habit |

Migrations are not deployed by anything else, and the order relative to a
client release matters: a client that writes a column the database does not
have yet fails *every* push, not just that one, because a rejected batch throws
out of `push()` and aborts the whole sync cycle. Apply the migration first, then
deploy the client.

## Deploying

**Pushing does not deploy.** The Vercel–GitHub connection was never completed,
so a release is a manual step:

```sh
npm run build
npx vercel --yes --prod
```

Then check that what is live is what was built by comparing the bundle hash in
`dist/assets/` against the deployed page:

```sh
ls dist/assets/index-*.js
curl -s https://habit-tracker-gilt-two.vercel.app/ | grep -o 'assets/index-[^"]*\.js'
```

Use the `gilt-two` alias. The team-named alias is behind Vercel's SSO and asks
for a login.

The reminder sender is a Supabase Edge Function and is deployed separately:

```sh
supabase functions deploy daily-reminder
```

Scheduling it is covered in [reminders-setup.md](reminders-setup.md).

## Checking row-level security

The anon key is public by design, so RLS is the only boundary between one
account's rows and another's. `scripts/rls-isolation-test.mjs` creates two
throwaway users and asserts, per table and per operation, that neither can read
or write the other's rows:

```sh
node scripts/rls-isolation-test.mjs
```

Sign-ups are disabled on the project, so the script fails with "Signups not
allowed" until sign-ups are temporarily re-enabled under Authentication → Sign
In / Providers. Turn them back off afterwards.

## Screenshots

`scripts/screenshots.mjs` renders every image under `docs/img/` from synthetic
data with headless Chrome, in both themes. The header comment in the script
says how to run it.
