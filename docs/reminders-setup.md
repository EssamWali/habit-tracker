# Reminders: setup runbook

The V2-6 daily reminder has four moving parts that live outside the repo: a
VAPID keypair, three edge-function secrets, a deployed function, and a schedule.
This is the sequence, and what each step is actually for.

Project ref: `ogylocnwwgakcmhcfjbq`.

---

## 1 · The VAPID keypair

VAPID is how a push service knows a notification came from this application and
not from anyone else who happened to learn a subscription endpoint.

- The **public** key ships in the bundle as `VITE_VAPID_PUBLIC_KEY`. It is
  public by design — the browser needs it to subscribe.
- The **private** key signs every send. It belongs in Supabase's function
  secrets and nowhere else. It must never be committed, and it is not in this
  repository.

A keypair was generated for this project during V2-6. To make a new one:

```sh
node --input-type=module -e "
import { webcrypto } from 'node:crypto'
const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify'])
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+\$/,'')
console.log('public ', b64u(await webcrypto.subtle.exportKey('raw', kp.publicKey)))
console.log('private', (await webcrypto.subtle.exportKey('jwk', kp.privateKey)).d)
"
```

Rotating the keypair invalidates every existing subscription: each device has to
turn the reminder off and on again to re-subscribe.

## 2 · Apply migration 0004

Dashboard → SQL Editor → paste `supabase/migrations/0004_reminders.sql` → Run.

It adds `profiles.timezone` and `profiles.last_clear_day`, creates
`push_subscriptions` and `reminder_state`, and defines the three functions the
sender calls. `due_reminders()` holds all of the timing logic, so it can be
inspected directly:

```sql
select * from public.due_reminders();
```

That returns nothing until a subscription exists and a reminder is due.

## 3 · Set the function secrets

Dashboard → Edge Functions → Secrets (or `supabase secrets set NAME=value`):

| Secret | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the public key from step 1 |
| `VAPID_PRIVATE_KEY` | the private key from step 1 |
| `VAPID_SUBJECT` | `mailto:` and your email address |
| `REMINDER_SECRET` | any long random string |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

`REMINDER_SECRET` is what stops the function being a public "notify everyone"
button: the scheduler sends it as `x-reminder-secret` and anything else is
refused. If the secret is unset the function accepts every caller, which is
acceptable only while testing.

## 4 · Deploy the function

```sh
supabase functions deploy daily-reminder --project-ref ogylocnwwgakcmhcfjbq
```

This needs an interactive login (`supabase login`) — it cannot be done from a
non-interactive shell.

Verify it end to end before scheduling anything:

```sh
curl -X POST https://ogylocnwwgakcmhcfjbq.functions.supabase.co/daily-reminder \
  -H "Authorization: Bearer <VITE_SUPABASE_ANON_KEY>" \
  -H "x-reminder-secret: <REMINDER_SECRET>"
```

**Both headers are needed.** Supabase's gateway verifies a JWT before the
function is reached at all, so a request carrying only the secret is rejected
with `UNAUTHORIZED_NO_AUTH_HEADER` and never runs a line of our code. The anon
key satisfies that check — it ships in the bundle and gates nothing. The real
gate is `REMINDER_SECRET`, checked inside the function: the anon key with a
wrong secret comes back `forbidden`.

It replies with `{"due":N,"sent":N,"retired":N,"failed":N}`. `due: 0` with a
reminder switched on means the current time is outside the one-hour window, or
today is already clear — both correct.

## 5 · Schedule it

Dashboard → Integrations → Cron, or in SQL:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daily-reminder',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ogylocnwwgakcmhcfjbq.functions.supabase.co/daily-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <VITE_SUPABASE_ANON_KEY>',
      'x-reminder-secret', '<REMINDER_SECRET>'
    )
  );
  $$
);
```

If `create extension` is refused, enable **pg_cron** and **pg_net** from
Dashboard → Database → Extensions first, then run the `cron.schedule` call on
its own.

The anon key rather than the service role key: the job body is stored in
`cron.job`, readable by anyone with database access, and the anon key is public
already. The function reaches the database with its own injected service role
key, so nothing is given up.

Every fifteen minutes, against a one-hour delivery window. The window is what
makes a late or failed run harmless — a later run inside it still delivers —
and `reminder_state.last_notified_day` is what stops that becoming four
notifications.

To inspect or remove it:

```sql
select * from cron.job;
select cron.unschedule('daily-reminder');
```

---

## How suppression actually works

The server has no idea what a Scheduled Day is.

Answering "is today already complete?" needs R1, R2 and R5 — cadences,
effective-dated schedules, weekly quotas, and the structural Perfect Day test.
Implementing that a second time in SQL would create two rules engines free to
drift apart, and a suppression rule that drifts either nags people who are
finished or silences people who are not.

So the client answers it, using the same `aggregate()` that draws the aggregate
heatmap, and writes the conclusion to `profiles.last_clear_day`.
`due_reminders()` compares that date to the user's local Day.

The cost is that the answer is only as fresh as the last time the app was open
and syncing. That failure mode points the right way: someone who has not opened
the app today leaves a stale value and gets their reminder.

## Things worth knowing

- **iOS is out of scope** (Q8). Safari only subscribes once a site is installed
  to the home screen, and the setting simply reports that push is unavailable
  where the APIs are missing.
- **Subscriptions are per browser, not per user.** Phone and laptop are separate
  rows and each has to be turned on where it is used. The preference syncs; the
  subscription does not.
- **A dead endpoint retires itself.** A 404 or 410 from the push service means
  the browser discarded the subscription, so the row is marked `failed_at` and
  skipped from then on. Turning the reminder on again revives it.
- **Marking happens after sending.** A push-service outage costs a duplicate
  next run rather than a silently skipped day.
- **Two gates, only one of them real.** The platform's JWT check is satisfied by
  a key that ships in the bundle, so it keeps nobody out. `REMINDER_SECRET` is
  what actually stops the endpoint being a public "notify everyone" button.
