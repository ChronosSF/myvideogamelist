# 0018. Status changes are recorded in an append-only event log

**Status:** Implemented

## Context

`UserGameLists` held current state and nothing else: a composite key of `(UserId, GameId)`, a
`ListType` string, and no timestamp of any kind. `SetListEntryAsync` moved a game with
`existing.ListType = listType` — an in-place `UPDATE`.

That table can answer "what is in my lists right now" and nothing else. It cannot answer how many
games someone finished in March, what they were playing last summer, whether they are on a streak,
or which games the most people finished this month. Every one of those is a Tier 1 or Tier 3
roadmap item (activity history, H6's stats strip, the activity feed, yearly wrapped).

The distinguishing property is that **this gap cannot be closed later**. Almost every other schema
change in `docs/data-model-plan.md` is recoverable: add a column, ship a migration, users fill it
in. History is not, because the information was never written down. Adding a `FinishedAt` column a
year from now yields a column full of nulls.

Two further requirements shaped the design rather than just the timing:

- The taxonomy grew from three lists to **five** — Backlog, Playing, On Hold, Finished, Dropped —
  and users will eventually be able to rename them. A renameable label cannot be the thing history
  is recorded against.
- **Custom lists** are coming as a paid feature, and the temptation was to give both them and the
  statuses one generic activity table.

## Decision

**`UserGameEvents` is append-only and records status transitions only.**

```
Id · UserId · GameId · FromStatusId? · ToStatusId? · OccurredAt
```

Both ends are nullable: a null `FromStatusId` means the game was not tracked before, and a null
`ToStatusId` means it was removed from tracking entirely. Both are real events.

**There is no foreign key to `UserGameLists`.** A removal is an event, so a cascade from the entry
would delete exactly the history being kept. The row carries `UserId` and `GameId` directly and
outlives the entry it describes.

**The event and the state change share one `SaveChangesAsync`,** so they land in the same
transaction or neither does. A recorded transition that did not happen is as bad as a missing one.

**A move to the status a game already holds records nothing.** The optimistic-update UI and
ordinary double-clicks both send these; unguarded they would inflate every count later derived
from the log.

**Statuses are a seeded system-owned lookup, referenced by id.** `ListStatuses` carries a stable
`Key`, a `DefaultName`, and three semantic flags — `IsStarted`, `IsTerminal`,
`CountsAsCompletion` — so that no query hardcodes a set of keys. Terminality alone cannot
distinguish Finished from Dropped, which is precisely why the completion rate needs two of the
three flags: `IsTerminal` is its denominator and `CountsAsCompletion` its numerator.

Renaming, when it ships, will write a display name to a separate `UserListSettings` table and
leave `Key` untouched. **Renaming is cosmetic; repurposing a list must never be possible** — a
user turning Finished into Dropped would silently corrupt every aggregate they appear in, with no
way to detect it afterwards.

**Custom lists stay out of this table.** They differ in shape, not just in policy: a game is in
exactly one status but in many custom lists, and being added to a list has no *from* endpoint.
Merging them would mean nullable columns on every row and a discriminator that every statistical
query has to filter on. The activity feed will union `CustomListItems.AddedAt` with these events at
read time — safe to defer, because a timestamp column captures that data the moment the table
exists.

## Consequences

Every status change now costs one extra insert. At one row per list move that is nothing: a heavy
user touching 200 games a year with three transitions each writes 600 rows. Never prune it — it is
the user's own history and it is small.

**The log is now load-bearing for correctness, not just for features.** Any future code path that
changes a game's status must go through `ListService` or record its own event; a direct `UPDATE`
would leave a permanent hole in a history that cannot be reconstructed. That is the one rule this
record exists to protect.

**On Hold makes naive duration calculations wrong.** `finished − first playing` looks like calendar
duration but is not: somebody who plays for two weeks, shelves a game for eight months and returns
for three days reads as a nine-month playthrough. The honest figure sums only the intervals whose
target status was `playing`, which is computable *because* the log keeps the intermediate
transitions. Call that metric active time, not elapsed time.

Monthly rollups derived from the log are regenerable and belong in the cache, not in a table —
consistent with [0012](0012-steam-news-without-a-database.md). The events are source data and
belong in PostgreSQL; the aggregates over them do not.

The API response shape changed as a consequence. `ListsDto` was one property per list
(`Playing`, `Backlog`, `Finished`), which five statuses made unwieldy and custom lists would break
outright; it is now keyed by status key, always including the statuses that are empty so the client
never guards a missing key.

Migrating `ListType` to a foreign key was free this time and will not be again. Keeping `backlog`
and `finished` as keys — rather than the roadmap's earlier "Plan to Play" and "Completed" — meant
the three existing values mapped across untouched and the two new statuses were additive rows.
Note that the scaffolded migration dropped the column and defaulted the new one to `0`, discarding
every entry's status and pointing the rest at a status id that does not exist; it was rewritten to
seed the lookup, map the values, and only then drop the old column. **Scaffolded migrations that
change a column's type need reading before they are run.**
