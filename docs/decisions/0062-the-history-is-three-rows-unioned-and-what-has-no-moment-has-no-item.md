# 0062. The history is three kinds of row unioned at query time, and what has no moment has no item

**Status:** Implemented

## Context

The profile showed what a user had done only as figures: the monthly chart, the streaks, the time
to finish ([0023](0023-profile-statistics-derived-at-read-time.md),
[0047](0047-a-playthroughs-dates-count-and-a-status-change-comes-first.md)). The old roadmap marked
*activity history* done for status changes, because `UserGameEvents` recorded every transition
([0018](0018-append-only-status-event-log.md)), and left scores and playthroughs open. #118 asks for
the list itself: the scores set and the playthroughs logged, alongside the status changes.

What was already settled narrowed the design to one shape. The event log records status transitions
and nothing else, and gets no new event type (0018). A playthrough writes no event
([0025](0025-playthroughs-and-reviews.md) §4), and neither does a score
([0019](0019-entry-survives-leaving-every-list.md)). So the three kinds have to be read from their
own rows and unioned at query time, which is how `docs/data-model-plan.md` says the activity feed
will union custom-list additions with the events. An imported status has no event behind it
([0026](0026-a-library-import-records-ownership-not-history.md) §2,
[0037](0037-a-tracker-import-carries-history.md)), and `Origin` is what says so.

Two things were missing. **No column recorded when a score was given.** The entry held the score
and nothing else about it. `AddedAt` is when the game was first recorded, and `StatusChangedAt` is
when it last moved. And **a playthrough's date is a day**, not an instant, so there was no settled
place for it in an order that is otherwise made of instants.

## Decision

### 1. One query of four branches, and no row written to make an item exist

`HistoryService.Items` is one `UNION ALL` through EF, with four branches:

- the user's events, at `OccurredAt`;
- their scored entries, at the new `ScoredAt`;
- their playthroughs' start dates;
- their playthroughs' finish dates.

A run with both dates is two items, because two things happened on two days. Each item carries its
run's type when it has one. Every branch is scoped on its own table's `UserId`. A run reaches its
game through its entry, and the composite key makes that entry the same user's (0025 §3). The status
and type keys are joined in, so the response carries keys and never ids.

No event type was added, no table was added, and nothing is synthesised. An item exists only because
a row the user wrote records that moment.

### 2. `ScoredAt` on the entry, stamped from now on, and never backfilled

The honest shape is a nullable `UserGameEntries.ScoredAt`: *when the user gave the game the score it
holds now*.

- **Only the score write stamps it.** `ListService.SetScoreAsync` stamps it when the score changes.
  A write of the score the game already holds leaves it alone, as a move to the status a game already
  holds records nothing (0018); stamped, a repeated save would carry an old score to the top of the
  history. Clearing the score clears it.
- **Written as a pair with the score.** EF's `UPDATE` carries only the columns it saw change, and a
  moment that was null and stays null has not changed. So clearing an undated score wrote the score
  alone, and a score given meanwhile in another tab kept its moment beside no score, which the
  constraint below refuses as a 500. An import filling an empty score had the same race, and it would
  have put the other tab's moment beside the imported score. Every write that changes a score
  therefore writes the moment with it (`EntryStore.WriteScoredAtWithScore`), so the last writer wins
  whole. Any later path that changes a score without the user scoring it now must clear the moment;
  keeping it would date a score nobody gave then.
- **A check constraint refuses a moment with no score**, and nothing more.
  `CK_UserGameEntries_ScoredAt_HasScore` cannot tell which score a moment belongs to; the writes are
  what keep it with the right one.
- **Never backfilled.** Nothing recorded when an existing score was given, so any value would be a
  moment made up for the history to show. Scores given before the column existed have no item.
- **Never set by an import**, for the reason `StatusChangedAt` is never stamped there (0026 §5). The
  source says what the score is, not when it was given, and the import's clock would put a whole
  library at the top of the history as though it had all been scored in one afternoon.
- **Current state, like the score.** Changing a score moves its item, and the earlier score is gone.
  A history of scores would be the separate table 0019 left as a separate decision.

The export carries the column, because `ReadEntriesAsync` is a hand-written projection that no guard
checks ([0024](0024-the-ownership-contract.md)).

### 3. A day sorts at noon UTC, and goes out as the day

The cursor and the order need one comparable key, so a playthrough's date is placed at **noon UTC**
on its day. That instant is only a sort position. The item sends the day as written (`on`), and no
instant (`at`).

Noon rather than midnight, which is how 0047 §6 places a date in a month. For a month the hour makes
no difference; here it does. A reader sees each instant on their own calendar, and midnight UTC on
the 17th is still the 16th anywhere west of Greenwich. A run finished on the 17th would then sit
among that reader's moves of the 16th, which is the slip `@/lib/stats` documents for
`new Date('2026-05-01')`. Noon UTC falls inside the day it names for every offset from UTC−12 up to,
but not including, UTC+12. From UTC+12 eastward it is already the next morning, so a dated item can
sit among the next day's moves. The client then gives that day a second heading rather than moving
the item, because the order is the server's and a page boundary can fall anywhere.

In SQL the day becomes `CAST((d + TIME '12:00') AT TIME ZONE 'UTC' AS timestamptz)`, written as
`(DateTimeOffset)DateTime.SpecifyKind(day.ToDateTime(noon), DateTimeKind.Utc)`. That is the one form
both providers run the same way. `new DateTimeOffset(…)` reads the same and is not translated: EF runs
it on the client, and a union cannot follow a client projection.

### 4. Ordered by moment, kind and row id, and paged by an encrypted cursor

Newest first, by `(moment, kind, id)`, each descending. The kind breaks a tie of moments, numbered so
that a run started and finished on one day lists its finish above its start. The row id breaks a tie
within a kind, as the review id does in [0028](0028-a-games-community-view.md) §7. An event is never
updated, so its place never moves. A run's date or a score that is edited mid-read moves its own
item, which may then be passed over or shown twice in that reading. Nothing else moves: an item
whose key is unchanged is never skipped or repeated, which is what an offset could not promise.

That relaxes 0028 §7, which asks every key a cursor is built on to be immutable. It cannot hold
here. The moment *is* the order, and an edited score or run date is meant to move to its new moment.
What 0028's rule exists for still holds: an item nobody touched is never lost to another's edit.

Pages of thirty, with one row over-read to learn whether there is another. They are never paged by
offset: a move made in another tab adds an item at the top, and an offset would then repeat one.

The cursor is encrypted with ASP.NET Data Protection under its own purpose, for 0028's two reasons.
An event id counts every status change anybody has made, and nothing else hands one to the client.
Protection also authenticates, so a cursor cannot be forged. A cursor that does not decrypt is a 400
beside `after`. The client tells that apart from a failure worth retrying, and offers the first page
again.

### 5. Records, not acts: 0047's precedence is not applied here, and the page says where they differ

A run's finish date and a move to Finished are two records and two items, each labelled by what it
is. 0047's precedence decides what the activity figures *count*: a game's moves to Finished settle
its finishes, so that one act recorded twice is one finish. A list of records counts nothing, and
hiding a run's date because the game also moved would hide something its owner wrote down.

The two can visibly disagree. Take 0047's own case: a run dated the 30th, and the move to Finished
made on the 2nd. The chart counts one finish, in the month of the move. The history lists the
run's finish on the 30th as well as the move. So the history's caption says it: a finish recorded
both ways is listed twice here and counted once, by the move, in the chart. 0047 ends by saying that
anything later that reads activity inherits its rule. That holds for anything that *counts*
activity, and 0047's Status line now points here for the list that does not.

A typed date in a month that has not begun is listed as written too. 0047 §6 leaves such a month
out of the counts, because it would be a finish that has not happened. In a list of records it is
still the user's record, and the top of their history is where a mistyped year gets noticed.

### 6. What has no moment has no item, and the page is told how much

An imported status has no event, and an undated score has no moment, so neither is an item and
neither is placed somewhere plausible. Every page carries two counts instead, so the page can say
why those are absent:

- `ImportedStatuses`: entries whose `Origin` is not `manual`. That is the column 0026 §4 exists for,
  and the history reads it rather than inferring anything from a missing event.
- `UndatedScores`: scores with no `ScoredAt`.

An import's playthrough dates are listed. They are its owner's own dates, as 0047 reads them.

### 7. The owner's page only, and its tier left to the owner

`GET /api/user/history` reads the user id from the principal and says `no-store`, like
`/api/user/news`. **The public profile does not carry it, and has not been widened.** 0027 §8
publishes counts, a month series and streaks, and the profile lists the reviews its owner chose to
publish. A dated, game-by-game record of everything somebody did is a different kind of thing, and
publishing it would be a consent decision for its owner, as review visibility is.

Which side of `specs/profile-statistics-tiers.md`'s line it falls on is **not decided here**. That
line is the owner's, and #149 draws it for the rest of the page. The history fits neither of the
spec's two kinds: it derives no figure from the records it lists, beyond the two counts of what it
cannot list. This record proposes **free**, because these are the owner's own records read back, and
the free export already carries them in full (0024). The argument the other way is 0024 §5's own: a
nicer presentation of the export's data is convenience, and [0010](0010-monetization-model.md) sells
convenience. The spec lists it among its open questions. Until #149 ships, the whole page is free, and
the history with it.

### 8. Titles from the cache, for the page's games only

Covers and titles come from `IGameCacheService`, for the thirty items on the page, so the history
renders through an IGDB outage ([0035](0035-a-local-copy-of-what-igdb-said.md)). A game the cache
cannot name keeps its item, with no game. The record is still the user's, and dropping it would make
a page shorter than it says.

That holds once the cache has an answer. A game whose copy is missing, or more than a day old, is
refreshed from IGDB inside the request, as on every page that reads the cache. So an IGDB that is
slow rather than down holds a page until the pipeline gives up, after at most its 30-second total
timeout, or until its breaker opens. #102 would take that refresh out of the request.

## Consequences

**The two kinds of verification were both needed.** The tests run on the in-memory provider, which
evaluates the union in .NET. One of them asks Npgsql to translate the query, with no connection, and
checks that it is one statement and that each day is placed in UTC by the database. What PostgreSQL
then does with that SQL was checked by hand against PostgreSQL 18.6, through EF Core 10.0.12 and
Npgsql 10.0.3:

- The query is one statement. PostgreSQL pushed the cursor's comparison into every branch.
- EF types the `NULL` placeholders itself, writing `NULL::smallint` or `NULL::text` on the first
  branch wherever two branches leave a column empty. PostgreSQL needs that: two bare `NULL`s resolve
  to `text`, and then fail to match a `smallint` further on. The branches can be in any order; both
  orders that matter were checked.
- Paging to the end returned every item exactly once and in order: bob2870's 95 and a synthetic
  account's 5,700.

**Cost at a thousand entries.** The synthetic account had 1,000 entries, 3,000 events, 1,000 dated
runs and 700 dated scores.
- **The database:** once warm, EXPLAIN ANALYZE put a page at about 5 to 8 ms of execution, as a
  top-N heapsort in 29 kB, plus about 7 ms of planning on a new connection.
- **Through EF:** the union averaged 11 ms a page and the counts query 4 ms, on local Docker.
- **Not counted:** those are the queries. A page also reads up to thirty `CachedGames` rows, and waits
  on IGDB for any game whose copy is missing or stale (§8). The synthetic account's games have no
  copies at all, so its timings are the queries' alone.

The cost grows with one user's own history, never with the table: for an account holding a small
share of the rows, the planner already reads every branch through its `UserId`-leading key, and the
event branch has `(UserId, OccurredAt)`. It is linear in that history, because no branch hands
ordered rows to the `LIMIT`. No index was added. Revisit when one user's log reaches tens of
thousands of rows, by taking the cursor, the order and the limit into each branch.

**Score items begin now.** Every score given before this shipped has no item, permanently, and the
page says how many. That is the price of not inventing the moments.

**The feed is not decided here.** #120 has the activity feed as `UserGameEvents` joined to
`UserFollows`. This union is one shape it could take instead, and a cheaper one to build now that it
exists. But a feed of other people's scores and run dates is a consent decision for each of them,
as §7 says of the public profile, and in a feed of other people's acts 0047's double-counting
argument applies in full. Both are #120's to settle, as whether custom-list additions belong in this
list is #134's. Whatever it takes from here, it must consult `Origin` as this does.

**Deleting an entry takes its score and runs out of the history and leaves its moves.** The log
outlives the entry by design (0018); the score and the runs were the entry's.

**A renamed list renames its past.** Items carry keys, and the owner's page labels them through
`nameFor` ([0031](0031-a-list-rename-is-a-label-its-owner-sees.md)), so *Moved to Finished* reads as
whatever Finished is called now. That is what a rename means here: a label, never a repurposing.
