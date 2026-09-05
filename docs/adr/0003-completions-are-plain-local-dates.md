# Completions are plain local dates with no timezone

A Completion stores a bare calendar date (`YYYY-MM-DD`) and never a timestamp or timezone. The boundary between one Day and the next is a configurable Day Start defaulting to 04:00, applied only when resolving what "today" means at the moment of logging; once resolved, the date is stored as an opaque local calendar day.

## Consequences

A reader expecting `timestamptz` will find this surprising, so: a habit is honoured on a *human calendar day*, not at an instant. Storing instants would force every streak, week-boundary, and heatmap-column computation through timezone conversion to recover the only fact that actually matters — which square to light up. The 04:00 default exists because logging something at 1am should credit the day you think you are still in.

The trade-off accepted: if the user crosses timezones, a Completion carries no record of where it happened, and a day can feel stretched or compressed. For a personal habit tracker this is the correct thing to not care about.
