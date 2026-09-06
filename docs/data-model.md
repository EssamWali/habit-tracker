# Data model

Postgres on Supabase. Every table carries `user_id`, `updated_at`, and `deleted_at`, because all three are load-bearing for sync (ADR 0002) and row-level security (ADR 0001).

## Conventions

- **`updated_at timestamptz not null`** — set by the *client*, not the server. It is the last-write-wins comparand.
- **`deleted_at timestamptz null`** — tombstone. Nothing is hard-deleted at write time; a device that was offline must be able to learn that a row died. A background purge removes tombstones older than 90 days.
- `profiles` is the sole exception to `deleted_at`: it is a singleton per user, created by trigger and removed only by cascade, so a tombstone would be a footgun rather than a feature.
- **`user_id uuid not null`** — denormalised onto every table, including child tables, so each RLS policy is a single-column comparison with no joins.
- **`synced_at timestamptz not null default now()`** — set by the *server* on every accepted write, and the only safe pull cursor. `updated_at` cannot serve this purpose: being client-set, a device with a lagging clock would write rows beneath a cursor another device had already passed, and they would never be pulled. Two columns, two jobs.
- `profiles` carries `synced_at` but does not use it as a cursor. It is one row per user, so the client fetches it whole every cycle; the column exists only so `profiles` can share the single `lww_guard` function instead of needing a near-identical copy without the stamp.
- Dates are `date`, never `timestamptz` (ADR 0003).

## Tables

### `profiles`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | references `auth.users` |
| `day_start_minutes` | int not null default 240 | 04:00; minutes past midnight |
| `theme` | text not null default `'system'` | `system` \| `light` \| `dark` |
| `reminder_enabled` | bool not null default false | |
| `reminder_minutes` | int null | minutes past midnight |

`day_start_minutes` is the input to R0 and therefore decides which Day every new Completion lands on. Changing it is **forward-only**: Completions are stored as the plain dates R0 already resolved (ADR 0003), and nothing re-derives them, so a new Day Start cannot move history. Pushed and pulled like any other row, but on its own path — see V2-1.

### `habits`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `name` | text not null | |
| `colour` | text not null | Palette key, not a hex value |
| `start_date` | date not null | |
| `archived_at` | date null | Archive point; `date` because it affects scoring |
| `sort_order` | int not null | drag-to-reorder |

Cadence and Weight are deliberately **absent** here — see below.

### `habit_schedules`

The effective-dated record from ADR 0004. Cadence and Weight share one row because they change under the same circumstances and always resolve together.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `habit_id` | uuid | |
| `user_id` | uuid | |
| `effective_from` | date not null | |
| `cadence_type` | text not null | `daily` \| `weekdays` \| `weekly_quota` |
| `weekdays` | smallint[] null | 1–7, Mon=1. Required iff `weekdays` |
| `weekly_target` | smallint null | Required iff `weekly_quota` |
| `weight` | smallint not null default 2 | 1 Minor, 2 Core, 3 Unskippable |

`unique (habit_id, effective_from)`. Index `(habit_id, effective_from desc)`.

Every habit has **at least one** row, created with the habit at `effective_from = start_date`. In v0/v1 the UI only ever writes one row per habit; the table is versioned from the first migration anyway, because retrofitting it later is a migration across all history.

### `day_entries`

The core table, and the one the whole sync model rests on.

| column | type | notes |
|---|---|---|
| `habit_id` | uuid | PK part |
| `day` | date not null | PK part |
| `user_id` | uuid | |
| `kind` | text not null | `completed` \| `frozen` |
| `value` | numeric null | Reserved. Unused in v1 — see ADR 0002 |
| `note` | text null | |

`primary key (habit_id, day)`. Index `(user_id, day)`.

**Why Completions and Freezes share one table**, despite being separate domain concepts in the glossary: a composite primary key on `(habit_id, day)` structurally prevents a day from being both completed and frozen — an invalid state that two tables would permit and require application code to police. It also keeps exactly one LWW key per Cell, which is precisely the property ADR 0002 depends on for conflict safety. The glossary distinction is preserved in `kind`.

**Freeze Tokens have no table.** The balance is derived (see derivation rules R7). A stored counter would be the one piece of state in this system where last-write-wins genuinely loses information — two devices each decrementing from 1 would both write 0.

## Row-level security

Identical on every table:

```sql
alter table <t> enable row level security;
create policy owner_all on <t>
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

`profiles` uses `id = auth.uid()`.

## Sync queries

- **Pull**: `select * from <t> where user_id = auth.uid() and updated_at > $last_sync`, tombstones included.
- **Push**: plain upsert on the natural key. The conditional part is enforced *server-side* by a `BEFORE UPDATE` trigger (`lww_guard`), not by the client — PostgREST emits an unconditional `ON CONFLICT DO UPDATE`, so a client-side condition is unenforceable. The trigger returns `OLD` when the incoming `updated_at` is not newer, making the write a no-op.

Because `day_entries` is keyed by `(habit_id, day)`, an upsert *is* the conflict resolution. There is no read-modify-write anywhere in the write path.
