-- Do not remind a user who has no Habits (V2-6 follow-up).
--
-- The bug: delete every habit and the nudge still arrives, every evening,
-- saying "Still something left for today."
--
-- Suppression in 0004 is a per-day stamp. The client decides nothing is
-- outstanding and writes profiles.last_clear_day; due_reminders() compares it
-- to the user's local Day. Only an *open* client can write that stamp, so a
-- stale value means "notify" -- deliberately, because someone who has not
-- opened the app today genuinely might owe something.
--
-- That reasoning does not survive an empty account. A user with no Habits has
-- no reason to open the app ever again, so the stamp stays frozen on the day
-- they deleted the last one and every day after it is due a reminder about
-- nothing. The staleness fallback fails open, and there is nothing the user can
-- do to close it short of turning reminders off.
--
-- The fix is a second suppression clause the server can answer alone: does this
-- user have a Habit that is live on their local Day? This is not the rules
-- engine 0004 refuses to duplicate. There is no cadence here, no weekly quota,
-- no weight, no notion of a Scheduled Day -- only R1's three range boundaries,
-- which are plain column comparisons. It cannot answer "is today complete?",
-- so it cannot drift from the client's answer to that question; it only
-- declines to ask when there is provably nothing to ask about.

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
      -- An unrecognised zone makes `at time zone` raise, which would take the
      -- whole query down rather than just that row. Skipping is the safe
      -- failure: no reminder, instead of no reminders for anyone.
      and exists (select 1 from pg_timezone_names z where z.name = p.timezone)
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
    and (r.last_notified_day is distinct from d.local_day)
    -- Nothing that could be owed in the first place. Deleted, archived and
    -- not-yet-started are the same three boundaries R1 calls out of range, and
    -- a Habit outside all of them cannot appear in any Day's denominator.
    and exists (
      select 1
      from public.habits h
      where h.user_id = d.id
        and h.deleted_at is null
        and h.start_date <= d.local_day
        and (h.archived_at is null or h.archived_at > d.local_day)
    );
$fn$;

-- CREATE OR REPLACE keeps the existing ACL, so this is a restatement rather
-- than a repair. It is here so the function's grants can be read in the same
-- file as its definition, and applying it twice changes nothing.
revoke all on function public.due_reminders() from public, anon, authenticated;
grant execute on function public.due_reminders() to service_role;
