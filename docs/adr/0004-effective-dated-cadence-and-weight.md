# Cadence and Weight are effective-dated, not mutable fields

A Habit's Cadence and Weight live in a versioned record carrying a start date, rather than as columns on the Habit that can be edited in place. Every "was this a Scheduled Day?" and every Aggregate ratio resolves the schedule *as of the date being scored*.

## Consequences

The motivating scenario: a habit runs as daily for three months and accumulates a wall of Misses, then is changed to three times per week. With mutable fields, history is silently re-interpreted — the Misses evaporate and the completion rate jumps — which means a bad month can be laundered by loosening the schedule after the fact. That defeats the purpose of honest tracking, and statistics that rewrite their own past cannot be trusted.

The cost is real and paid everywhere: no code may read a Habit's current cadence to judge a historical day. Cadence and Weight share one versioned record rather than two, since they change under the same circumstances and always need resolving together.
