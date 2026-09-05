# v0 — Walking skeleton

**Status: complete.** All eight tickets closed and verified on real hardware.

**Goal:** prove the offline→online round trip and per-user isolation end to end, on a real Android phone, before any feature depends on them. Deliberately ugly. If v0 works, the rest is drawing.

**Explicitly out of scope for all of v0:** weekly/weekday cadence, the colour Palette, the Aggregate Heatmap, streaks and gold, freezes, weights, statistics, notes, reminders, export, archive, dark mode, backfill.

---

## V0-1 · Project scaffold ✅

Vite + React + TypeScript. PWA manifest and a registered service worker (offline shell only — no push). Responsive layout down to 360px. Light theme only.

Deploy to Vercel as part of this ticket, not later: Android will not register a service worker or offer installation over a plain-HTTP LAN address, so an HTTPS origin is a prerequisite for this ticket's acceptance test and for V0-3's OAuth redirect.

- Production URL: **https://habit-tracker-gilt-two.vercel.app**
- Vercel project: `<team>/habit-tracker`
- Note: the `habit-tracker-<team>.vercel.app` alias is gated by Deployment Protection and 302s to SSO. Use the `habit-tracker-gilt-two.vercel.app` alias for device testing.

**Done when:** the app installs to an Android home screen from the production URL and opens with no network.

## V0-2 · Supabase schema and RLS ✅

Implement `docs/data-model.md` as a migration: all four tables, `updated_at`/`deleted_at` on each, the `(habit_id, day)` primary key on `day_entries`, and the `owner_all` policy everywhere. Include `habit_schedules` as a versioned table and `day_entries.value` as nullable, even though nothing writes to them yet.

**Done when:** an integration test signed in as user A cannot read, update, or delete any row belonging to user B — verified per table, not just on `habits`.

**Result:** `scripts/rls-isolation-test.mjs` — 16/16 passing. Covers SELECT/UPDATE/DELETE isolation on all four tables, INSERT spoofing rejected by `WITH CHECK`, the owner still able to read its own rows (proving the policies are not simply denying everything), and the `lww_guard` trigger rejecting a stale write while accepting a newer one.

Project ref `ogylocnwwgakcmhcfjbq`. Migration applied via the dashboard SQL Editor; the CLI needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` set as machine environment variables before it can run headlessly.

## V0-3 · Auth ✅

Google OAuth and email magic link. Session persists across restarts and survives being offline at launch.

**Carried over from V0-2:** "Confirm email" was turned **off** so the isolation test could obtain sessions for two users. Email/password is not a product feature (Q10 settled on Google OAuth plus magic link), but leaving confirmations off means anyone can register against an address they do not own. Decide deliberately as part of this ticket: either re-enable confirmations, or disable email/password sign-up while keeping the email provider on for magic link.

**Done when:** cold-starting the installed PWA in airplane mode lands on the logged-in view, not a login screen.

**Result:** verified on a real Android device. Google OAuth is live (Google Auth Platform app kept in Testing with the owner added as a test user — Testing mode is sufficient because Supabase uses Google only for initial identity and then issues its own session tokens, so Google's 7-day refresh expiry never applies). Magic link is wired but untested: it needs redirect URLs allowlisted, and the default 2 emails/hour cannot be raised without custom SMTP. Since Google OAuth is the primary method, SMTP was deliberately not set up.

## V0-4 · Local store ✅

IndexedDB (Dexie) mirroring the server schema exactly, plus an `outbox` of pending mutations. All reads in the app go through the local store — never directly to Supabase. Writes are synchronous to local and enqueue.

**Done when:** every UI surface renders from IndexedDB with the network disabled.

**Result:** Dexie mirrors the server schema exactly, including the compound `(habit_id, day)` key. Habits are read through the `[user_id+sort_order]` index — querying by `user_id` alone orders by primary key, which is a random UUID. Signing in as a different account drops and rebuilds the mirror.

## V0-5 · Sync engine ✅

Push the outbox; pull `where updated_at > last_sync` including tombstones; merge by last-write-wins on client-set `updated_at`. Upsert-based, with no read-modify-write in the write path. Retry with backoff; survive being killed mid-flight.

**Done when:** the two-device conflict test in V0-8 passes.

**Result:** push/pull verified round-tripping against Supabase. Migration 0002 adds server-set `synced_at` as the pull cursor, because the client-set `updated_at` is unusable for paging — a device with a lagging clock writes rows beneath a cursor another device has passed. Cursors are per table. Timestamp comparison goes through `Date.parse`, since the client writes `...Z` and Postgres returns `...+00:00`.

## V0-6 · Create habit and toggle today ✅

Daily cadence only. Creating a habit also writes its initial `habit_schedules` row at `effective_from = start_date`. Tapping today's cell toggles a `day_entries` row (`kind = 'completed'`) and un-toggling writes a tombstone. Implement R0 (`today()`) with the 04:00 Day Start — hardcoded, no settings UI.

**Done when:** toggling at 01:30 local credits the previous day.

**Result:** R0 implemented in `src/lib/day.ts` and covered by 8 unit tests (`npm test`), including month and year rollover and an explicit regression guard against `toISOString()` UTC leakage. Vitest added — `derivation-rules.md` requires R0–R7 to be unit-testable in isolation, so v1 inherits the harness.

## V0-7 · Minimal heatmap ✅

Rolling last 365 days, Monday-start rows, right-aligned on today, horizontally scrollable on mobile with the viewport pinned to the right edge. Two-tone: completed vs not. One habit per row.

**Done when:** it renders 365 cells at 360px wide without the page scrolling horizontally.

**Result:** `src/lib/calendar.ts` covered by 13 unit tests — Monday-start columns, seven days per column, window coverage including both endpoints, leap-day arithmetic, and local-time parsing (`Date.parse` on a bare `YYYY-MM-DD` reads UTC and shifts the day west of GMT). The scroll container is the heatmap, never the page.

## V0-8 · Real-device verification ✅

Not a code ticket — the point of v0. On an actual Android phone plus a desktop browser:

1. Toggle offline on the phone; confirm the UI updates instantly.
2. Reconnect; confirm the change appears on desktop.
3. **Conflict:** with both devices offline, toggle the *same* day on for one and off for the other. Reconnect both. Confirm they converge, that the later `updated_at` wins, and that neither device is left in a state disagreeing with the server.
4. Kill the app mid-sync; confirm the outbox replays without duplicating or losing entries.

**Done when:** all four pass. If step 3 fails, stop and reopen ADR 0002 before starting v1.

**Result:** all four passed on a real Android device plus desktop. The convergence test — both devices offline, the same Cell toggled opposite ways, reconnected in sequence — converged on the later write with no divergence and no flapping.

Additionally verified, unplanned: a **server-originated deletion** propagating to clients. Bulk-tombstoning 39 test habits directly in SQL cleared them from both devices without user action, exercising the pull path picking up tombstones and the mirror learning about rows it never wrote. Both sync directions are now proven.

**ADR 0002 is validated.** v1 can be built on the sync model rather than around it.
