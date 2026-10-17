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
- **A check constraint keeps it beside its score.** `CK_UserGameEntries_ScoredAt_HasScore` allows a
  moment only when there is a score. Without it, a date left by a cleared score would be shown against
  whatever an import put in the column next.
- **Never backfilled.** Nothing recorded when an existing score was given, so any value would be a
  moment made up for the history to show. Scores given before the column existed have no item.
- **Never set by an import**, for the reason `StatusChangedAt` is left null there (0026 §5). The
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
sit among the next day's moves. The client then gives that day a second heading rather than moving the item, because
the order is the server's and a page boundary can fall anywhere.

In SQL the day becomes `CAST((d + TIME '12:00') AT TIME ZONE 'UTC' AS timestamptz)`, written as
`(DateTimeOffset)DateTime.SpecifyKind(day.ToDateTime(noon), DateTimeKind.Utc)`. That is the one form
both providers run the same way. `new DateTimeOffset(…)` reads the same and is not translated: EF runs
it on the client, and a union cannot follow a client projection.

### 4. Ordered by moment, kind and row id, and paged by an encrypted cursor

Newest first, by `(moment, kind, id)`, each descending. The kind breaks a tie of moments, numbered so
that a run started and finished on one day lists its finish above its start. The row id breaks a tie
within a kind, as the review id does in [0028](0028-a-games-community-view.md) §7. None of the three
changes under a reader. An event is never updated, and a date or a score that is edited moves its
own item rather than shifting the ones around it.

Pages of thirty, with one row over-read to learn whether there is another. They are never paged by
offset: a move made in another tab adds an item at the top, and an offset would then repeat one.

The cursor is encrypted with ASP.NET Data Protection under its own purpose, for 0028's two reasons.
An event id counts every status change anybody has made, and nothing else hands one to the client.
Protection also authenticates, so a cursor cannot be forged. A cursor that does not decrypt is a 400
beside `after`. The client tells that apart from a failure worth retrying, and offers the first page
again.

### 5. Records, not acts: 0047's precedence is not applied here

A run's finish date and a move to Finished are two records and two items, each labelled by what it
is. 0047's precedence decides what the activity figures *count*: a game's moves to Finished settle
its finishes, so that one act recorded twice is one finish. A list of records counts nothing. Hiding
a run's date because the game also moved would hide something its owner wrote down, and it would
contradict nothing to show it. The figures still count one finish. A typed date in the future is
listed as written too. 0047 §6 keeps one out of the counts, because it would be a finish that has not
happened. In a list of records it is still the user's record, and the top of their history is where
a mistyped year gets noticed.

### 6. What has no moment has no item, and the page is told how much

An imported status has no event, and an undated score has no moment, so neither is an item and
neither is placed somewhere plausible. Every page carries two counts instead, so the page can say
why those are absent:

- `ImportedStatuses`: entries whose `Origin` is not `manual`. That is the column 0026 §4 exists for,
  and the history reads it rather than inferring anything from a missing event.
- `UndatedScores`: scores with no `ScoredAt`.

An import's playthrough dates are listed. They are its owner's own dates, as 0047 reads them.

### 7. The owner's page only, and not on the tiers line

`GET /api/user/history` reads the user id from the principal and says `no-store`, like
`/api/user/news`. **The public profile does not carry it, and has not been widened.** 0027 §8
publishes counts, a month series and streaks. A dated, game-by-game record of what somebody did
is a different kind of thing, and publishing it would be a consent decision for its owner, as review
visibility is.

It is not a statistic either, so it is not on `specs/profile-statistics-tiers.md`'s line. It is the
owner's own records read back, which the free export already carries in full (0024), and
[0010](0010-monetization-model.md) sells depth, not access. The spec now says so.

### 8. Titles from the cache, for the page's games only

Covers and titles come from `IGameCacheService`, for the thirty items on the page, so the history
renders through an IGDB outage ([0035](0035-a-local-copy-of-what-igdb-said.md)). A game the cache
cannot name keeps its item, with no game. The record is still the user's, and dropping it would make
a page shorter than it says.

## Consequences

**The two kinds of verification were both needed.** The tests run on the in-memory provider, which
evaluates the union in .NET and so cannot notice it translating differently. The SQL was checked by
hand against PostgreSQL 18.6, through EF Core 10.0.12 and Npgsql 10.0.3:

- The query is one statement. PostgreSQL pushed the cursor's comparison into every branch.
- EF types the `NULL` placeholders itself, writing `NULL::smallint` or `NULL::text` on the first
  branch wherever two branches leave a column empty. PostgreSQL needs that: two bare `NULL`s resolve
  to `text`, and then fail to match a `smallint` further on. The branches can be in any order; both
  orders that matter were checked.
- Paging through bob2870's 94 items returned each exactly once, and so did a synthetic account's
  5,700.

**Cost at a thousand entries.** The synthetic account had 1,000 entries, 3,000 events, 1,000 dated
runs and 700 dated scores. Once warm, EXPLAIN ANALYZE put a page at about 5 to 8 ms of execution,
as a top-N heapsort in 29 kB, plus about 7 ms of planning on a new connection. Through EF the union
averaged 11 ms a page and the counts query 4 ms, on local Docker. No index was added. Per user these rows are
the small set 0023 sized, the event branch already has `(UserId, OccurredAt)`, and the rest are
read per user through the existing keys. Revisit when one user's log reaches tens of thousands of
rows.

**Score items begin now.** Every score given before this shipped has no item, permanently, and the
page says how many. That is the price of not inventing the moments.

**The feed has its query.** #120's activity feed is this union over the people somebody follows,
with the visibility gates added on top. It inherits the noon convention, the cursor and the counts'
honesty, and it must consult `Origin` exactly as this does.

**Deleting an entry takes its score and runs out of the history and leaves its moves.** The log
outlives the entry by design (0018); the score and the runs were the entry's.

**A renamed list renames its past.** Items carry keys, and the owner's page labels them through
`nameFor` ([0031](0031-a-list-rename-is-a-label-its-owner-sees.md)), so *Moved to Finished* reads as
whatever Finished is called now. That is what a rename means here: a label, never a repurposing.
