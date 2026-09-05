# Supabase as the backend

Cross-device sync requires accounts and a hosted database. We chose Supabase over Firebase and over a self-hosted Node/Postgres stack because the statistics this app exists to produce — completion rate per habit over a rolling window, excluding unscheduled days and archived periods — are relational aggregate queries that are natural in SQL and painful in a document store. Row-level security gives per-user data isolation with no backend code of our own, and auth ships with it.

## Consequences

This is real lock-in: row-level security policies, the auth model, and the realtime channel are all Supabase-shaped. JSON/CSV export is treated as a first-class feature rather than a nice-to-have precisely because it is the escape hatch from this decision.
