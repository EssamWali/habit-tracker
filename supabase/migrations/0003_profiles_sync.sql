-- Brings profiles onto the same write path as the other tables (V2-1).
--
-- profiles has been present since v0 but nothing read or wrote it, so it never
-- needed a conflict rule. Now that Day Start and theme sync, two devices can
-- disagree about a single row and the older write must lose.

alter table public.profiles add column synced_at timestamptz not null default now();

-- Unlike the other tables, synced_at here is not a pull cursor: profiles is a
-- singleton per user, so the client fetches the whole row every cycle and there
-- is nothing to page through. The column exists so profiles can share the one
-- lww_guard function rather than needing a near-identical copy of it.

create trigger lww before update on public.profiles
  for each row execute function public.lww_guard();
