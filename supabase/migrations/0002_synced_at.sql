-- Separates the pull cursor from the conflict comparand.
--
-- updated_at is client-set, because last-write-wins needs the originating
-- device's intent (ADR 0002). That makes it unusable as a pull cursor: a device
-- with a lagging clock writes rows whose updated_at is below a cursor another
-- device has already passed, and those rows are never pulled again.
--
-- synced_at is set by the server on every accepted write and is monotonic per
-- database, so it is safe to page through.

alter table public.habits          add column synced_at timestamptz not null default now();
alter table public.habit_schedules add column synced_at timestamptz not null default now();
alter table public.day_entries     add column synced_at timestamptz not null default now();

create index habits_user_synced          on public.habits          (user_id, synced_at);
create index habit_schedules_user_synced on public.habit_schedules (user_id, synced_at);
create index day_entries_user_synced     on public.day_entries     (user_id, synced_at);

-- Fold the stamp into the existing guard rather than adding a second trigger.
-- Two BEFORE triggers would chain: lww_guard returning OLD to reject a stale
-- write would still be handed to a separate stamping trigger, which would bump
-- synced_at on a write that was rejected and cause a pointless re-pull.
create or replace function public.lww_guard()
returns trigger language plpgsql as $fn$
begin
  if new.updated_at <= old.updated_at then
    return old;
  end if;
  new.synced_at := now();
  return new;
end $fn$;
