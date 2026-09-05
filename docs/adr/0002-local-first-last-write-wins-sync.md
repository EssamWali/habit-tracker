# Local-first sync with last-write-wins per Completion

The app must be fully usable offline — habits get logged in gyms, on planes, and in basements, and a tracker that refuses to record a completion at the moment it happens will simply stop being used. Every action therefore writes to local storage immediately and a background queue reconciles with Supabase when connectivity returns. The full history is stored locally, since a decade of Completions is well under a megabyte.

Conflicts resolve by last-write-wins on a client-set update timestamp, with tombstones for un-ticking.

## Consequences

Last-write-wins is normally a data-loss risk, and it is worth recording why it is not one here. A Completion is uniquely keyed by (Habit, Day) and is binary — it is set membership, not a document being concurrently edited. There is no merge in which information can be lost; the losing write was only an older statement of intent about a single Cell. This reasoning holds *only* while Completions stay binary. If per-Completion quantities are ever introduced, this decision must be revisited, because summing or averaging conflicting values is a genuine merge and LWW would start discarding real data.

A CRDT was considered and rejected as machinery far beyond what a set of binary per-day flags requires.
