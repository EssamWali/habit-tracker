-- Daily reminders (V2-6).
--
-- The design problem here is suppression: "do not notify on a day that is
-- already complete" is a question about Scheduled Days, cadences and weekly
-- quotas, and answering it on the server would mean a second implementation of
-- R1, R2 and R5 that is free to drift from the client's.
--
-- So the server never asks it. The client, which owns the rules, writes down
-- the *conclusion* -- profiles.last_clear_day -- and the server does a date
-- comparison. One rules engine, no drift. A user who has not opened the app
-- today leaves a stale value and gets their reminder, which is exactly right.

-- ------------------------------------------------------------- profiles

-- IANA zone, set by the client from the browser. Needed because the cron runs
-- in UTC and "20:00" is a local claim.
alter table public.profiles add column timezone text not null default 'UTC';

-- The last Day on which nothing was left owing: every Scheduled Habit
-- completed, or nothing scheduled at all. Client-owned, synced like any other
-- profile field.
alter table public.profiles add column last_clear_day date;

-- --------------------------------------------------- push_subscriptions

-- Deliberately outside the sync engine. A push subscription belongs to one
-- browser on one device, not to the user's data, and mirroring it to every
-- device would mean each one holding endpoints it must never use. Subscribing
-- requires the network anyway, so there is nothing for an outbox to buy.

create table public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  failed_at  timestamptz                    -- set when the endpoint stops accepting
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

-- ------------------------------------------------------ reminder_state

-- Server-owned, and kept off profiles on purpose: a client pushing its profile
-- row would carry a stale copy of this and clobber the server's record of what
-- it has already sent, which is how a nudge becomes three nudges.
create table public.reminder_state (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  last_notified_day  date,
  updated_at         timestamptz not null default now()
);

-- ------------------------------------------------------------------ RLS

alter table public.push_subscriptions enable row level security;
alter table public.reminder_state     enable row level security;

create policy owner_all on public.push_subscriptions for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- No policy for reminder_state: nothing but the service role ever touches it,
-- and RLS with no policy denies everyone else by default.

-- ------------------------------------------------------------ selection

/**
 * Who is due a reminder right now.
 *
 * All of the timing lives here rather than in the edge function, so it is
 * versioned in a migration and can be inspected with a plain SELECT.
 *
 * The local Day is shifted by day_start_minutes, matching R0 exactly: with a
 * 04:00 Day Start, a reminder at 02:00 is still about yesterday.
 *
 * The one-hour window means a cron run that is late, or one that fails, does
 * not silently drop the day's reminder -- the next run inside the window picks
 * it up. last_notified_day is what stops that becoming four notifications.
 */
create or replace function public.due_reminders()
returns table (
  user_id   uuid,
  local_day date,
  endpoint  text,
  p256dh    text,
  auth      text
)
language sql
security definer
set search_path = ''
as $fn$
  with ctx as (
    select
      p.id,
      (now() at time zone p.timezone) as local_now,
      p.reminder_minutes,
      p.last_clear_day,
      p.day_start_minutes
    from public.profiles p
    where p.reminder_enabled
      and p.reminder_minutes is not null
  ),
  due as (
    select
      c.id,
      ((c.local_now - make_interval(mins => c.day_start_minutes))::date) as local_day,
      (extract(hour from c.local_now) * 60 + extract(minute from c.local_now))::int as local_minutes,
      c.reminder_minutes,
      c.last_clear_day
    from ctx c
  )
  select d.id, d.local_day, s.endpoint, s.p256dh, s.auth
  from due d
  join public.push_subscriptions s on s.user_id = d.id and s.failed_at is null
  left join public.reminder_state r on r.user_id = d.id
  where d.local_minutes >= d.reminder_minutes
    and d.local_minutes < d.reminder_minutes + 60
    -- Already done everything owed today: a notification here would mean
    -- nothing, which is the whole point of Q16.
    and (d.last_clear_day is distinct from d.local_day)
    and (r.last_notified_day is distinct from d.local_day);
$fn$;

/** Record a delivered reminder. Called only after a send actually succeeds. */
create or replace function public.mark_reminded(p_user_id uuid, p_day date)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.reminder_state (user_id, last_notified_day, updated_at)
  values (p_user_id, p_day, now())
  on conflict (user_id) do update
    set last_notified_day = excluded.last_notified_day, updated_at = now();
$fn$;

/** An endpoint the push service has rejected: stop sending to it. */
create or replace function public.retire_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $fn$
  update public.push_subscriptions set failed_at = now() where endpoint = p_endpoint;
$fn$;

-- These read across every user, so they exist for the service role alone.
revoke all on function public.due_reminders()             from public, anon, authenticated;
revoke all on function public.mark_reminded(uuid, date)    from public, anon, authenticated;
revoke all on function public.retire_subscription(text)    from public, anon, authenticated;
