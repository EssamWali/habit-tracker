-- v0 schema. Implements docs/data-model.md.
-- Cadence and Weight live in habit_schedules, never on habits (ADR 0004).
-- Completions and Freezes share day_entries, keyed (habit_id, day) (ADR 0002).

-- gen_random_uuid() is core Postgres since 13; no extension needed, and
-- creating pgcrypto here would collide with Supabase's managed extensions schema.

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  day_start_minutes int  not null default 240 check (day_start_minutes between 0 and 1439),
  theme             text not null default 'system' check (theme in ('system', 'light', 'dark')),
  reminder_enabled  boolean not null default false,
  reminder_minutes  int check (reminder_minutes between 0 and 1439),
  updated_at        timestamptz not null default now()
);

-- profiles is the one table with no deleted_at: it is a singleton per user,
-- created by trigger and destroyed only by cascade. A tombstone would be a
-- footgun, not a feature.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ habits

create table public.habits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  colour     text not null,                 -- Palette key, never a hex value
  start_date date not null,
  archived_at date,                         -- date, not timestamptz: it affects scoring
  sort_order int  not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index habits_user_updated on public.habits (user_id, updated_at);

-- --------------------------------------------------------- habit_schedules

create table public.habit_schedules (
  id             uuid primary key default gen_random_uuid(),
  habit_id       uuid not null references public.habits (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  effective_from date not null,
  cadence_type   text not null check (cadence_type in ('daily', 'weekdays', 'weekly_quota')),
  weekdays       smallint[],                -- ISO 1..7, Mon=1
  weekly_target  smallint,
  weight         smallint not null default 2 check (weight in (1, 2, 3)),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (habit_id, effective_from),
  constraint cadence_shape check (
       (cadence_type = 'daily'
          and weekdays is null and weekly_target is null)
    or (cadence_type = 'weekdays'
          and weekly_target is null
          and weekdays is not null
          and array_length(weekdays, 1) between 1 and 7
          and weekdays <@ array[1,2,3,4,5,6,7]::smallint[])
    or (cadence_type = 'weekly_quota'
          and weekdays is null
          and weekly_target between 1 and 7)
  )
);

create index habit_schedules_lookup on public.habit_schedules (habit_id, effective_from desc);

-- ------------------------------------------------------------- day_entries

create table public.day_entries (
  habit_id   uuid not null references public.habits (id) on delete cascade,
  day        date not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('completed', 'frozen')),
  value      numeric,                       -- reserved; unused in v1 (ADR 0002)
  note       text check (note is null or length(note) <= 500),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (habit_id, day)
);

create index day_entries_user_day     on public.day_entries (user_id, day);
create index day_entries_user_updated on public.day_entries (user_id, updated_at);

-- --------------------------------------------------------------- LWW guard

-- Enforces last-write-wins server-side. PostgREST upserts emit an
-- unconditional ON CONFLICT DO UPDATE, so without this a stale write from a
-- device that was offline for a week would silently clobber newer data.
-- Returning OLD from a BEFORE UPDATE trigger makes the update a no-op.

create or replace function public.lww_guard()
returns trigger language plpgsql as $fn$
begin
  if new.updated_at <= old.updated_at then
    return old;
  end if;
  return new;
end $fn$;

create trigger lww before update on public.habits
  for each row execute function public.lww_guard();
create trigger lww before update on public.habit_schedules
  for each row execute function public.lww_guard();
create trigger lww before update on public.day_entries
  for each row execute function public.lww_guard();

-- --------------------------------------------------------------------- RLS

alter table public.profiles        enable row level security;
alter table public.habits          enable row level security;
alter table public.habit_schedules enable row level security;
alter table public.day_entries     enable row level security;

create policy owner_all on public.profiles for all
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy owner_all on public.habits for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy owner_all on public.habit_schedules for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy owner_all on public.day_entries for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
