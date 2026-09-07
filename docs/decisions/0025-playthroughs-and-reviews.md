# 0025. Playthroughs and reviews: what a user records about actually playing a game

**Status:** Implemented

## Context

`docs/data-model-plan.md` puts `UserGamePlaythroughs`, `PlaythroughTypes` and `Reviews` at step 3
of its sequencing, immediately after the surgery in [0022](0022-entry-surrogate-key-and-the-wishlist-axis.md),
and says why the order matters: the alternative is putting playtime and platform on the entry
first and moving them afterwards.

Three things were waiting on this.

**The roadmap's Tier 1 "per-entry tracking data"** — start date, finish date, hours played,
platform played on, replay count, notes — none of which is a property of the entry. A replay on a
different platform is not an edit to how you played it the first time.

**[0023](0023-profile-statistics-derived-at-read-time.md) had to leave two figures out**, and said
so at length: nothing recorded hours, so "total hours" could not be built and "most-*played*
platform" was unbuildable in principle. The page says "most of your games are on" for exactly that
reason.

**The game page shows IGDB's completion times and nothing of our own.** IGDB reports three tiers —
`hastily`, `normally`, `completely` — and we had no comparable figure to put beside them.

## Decision

### 1. The three types mirror IGDB's tiers, and the mapping lives in one place

`PlaythroughTypes` is a seeded, system-owned lookup shaped exactly like `ListStatuses`: assigned
ids, a permanent `Key`, a `DefaultName`, a `SortOrder`. The three rows are `rushed`, `normally`
and `completionist`, and they are deliberately the same three buckets as IGDB's.

That is what lets the game page show

```
IGDB community          45h  / 119h / 174h   (312 submissions)
MyVideoGameList members 51h  / 130h / —      (5 / 8 / 2 playthroughs)
```

as two readable rows from two sources, rather than one blended figure of unclear provenance. Two
rows only work if the columns line up, so both rows always render all three tiers and a tier with
nothing behind it is an em dash rather than a missing card in one row and a present one in the
other.

**We do not store IGDB's names.** Their vocabulary is theirs and ours is ours; the mapping between
them is one constant on the client, `PLAYTHROUGH_TIERS` in `types/playthrough.ts`, which
`CompletionTimes` derives its own tiers from. A second copy would drift, and the symptom would be
two rows silently comparing different things.

The keys are permanent for the same reason `ListStatusKeys` are: they are what the API, the export
document and every aggregate are written against.

### 2. Median with counts, and the display floor lives in the client

Every MVGL figure is subject to [0016](0016-scores-carry-their-sample-size.md). `CommunityTimesDto`
carries `samples` beside every `medianMinutes`, and the client suppresses a tier under
`MIN_PLAYTHROUGH_SAMPLES`, which sits in `@/lib/score` next to `MIN_CRITIC_REVIEWS`. A median over
two members is exactly as uninformative as a critic score from one review.

The floor is 3, lower than the critic floor of 4, because the two ask different things of
different pools: four reviews is a low bar among the thousands IGDB aggregates, and a floor that
nothing on a site this size ever clears shows nobody anything.

**Median, not mean.** Self-reported playtime has a long idle-hours tail; one person who left the
game running over a weekend should not move the number.

**Only playthroughs with both a type and a duration are counted.** An untyped run has no tier to
belong to and one with no hours has nothing to contribute — counting either would inflate a sample
size behind a figure it did not help produce, which is the one thing a count is for.

Aggregated in C# after a scoped query, following 0023: the tests run on the EF in-memory provider,
so a median computed in SQL would be verified against something PostgreSQL never runs.

### 3. Both children carry `UserId`, and reach their entry through a composite foreign key

A playthrough and a review each carry a `UserId` column of their own, even though the entry they
hang off already identifies the owner. That is not redundancy — it is what makes them visible to
the guard. `UserOwnedDataTests` (ADR [0024](0024-the-ownership-contract.md)) selects user-owned
entities *by the presence of a `UserId` property* and then demands a cascading foreign key tied to
that column. A child keyed only through the entry carries no such column, so it would escape both
halves of the ownership contract — the cascade assertion and the export manifest — without failing
anything.

Consistency between the two is then a **composite foreign key** on `(UserGameEntryId, UserId)`
against a new alternate key on `UserGameEntries (Id, UserId)`. A row whose owner is not its entry's
owner is refused by PostgreSQL rather than by a service remembering to check. The alternate key
adds a unique constraint over a pair the primary key already made unique, so it constrains nothing
new on the existing rows; it exists to be referenced. EF and Npgsql accepted the shape and the
generated SQL is one `ADD CONSTRAINT` — no fallback to a plain key plus a service-level promise was
needed.

The two overlapping cascade paths this creates — account → entry → playthrough, and account →
playthrough — are fine on PostgreSQL, which does not have SQL Server's multiple-cascade-path
restriction.

### 4. Neither writes an event, and neither touches a status

[0018](0018-append-only-status-event-log.md) keeps `UserGameEvents` typed and narrow: status
transitions only, no discriminator, because every statistic derived from it assumes one shape.
Playing a game and moving it between lists are different acts and they **genuinely diverge** —
replaying something already marked Finished adds a playthrough with no transition at all, which is
the case the data-model plan uses to argue that both logs are needed.

So nothing in `PlaythroughService` or `ReviewService` appends an event or writes `StatusId`. Status
changes go through `ListService` and nowhere else. Three tests pin it.

Both services do create the entry when there is none, exactly as `SetScoreAsync` does (ADR
[0019](0019-entry-survives-leaving-every-list.md)) — logging a playthrough of a game you never put
in a list is legitimate. Find-or-create moved out of `ListService` into `EntryStore` unchanged,
because a second copy of it is how a table with a unique `(UserId, GameId)` index acquires a path
that writes a second row.

### 5. Almost every field is optional, and that is the point

A playthrough logged the day someone starts a game has a platform and a start date and nothing
else. The type and the hours arrive when it ends, if they ever do — and "still playing, do not know
how thoroughly yet" has to be expressible, or people log nothing until they finish and the feature
records only completed games.

The form says so rather than leaving a blank option in a required-looking select unexplained. The
cost is borne by the aggregate, which ignores incomplete rows, and by nothing else.

Two constraints are in the database as well as on the input DTO, because a column outlives any one
validation attribute: `MinutesPlayed` between 1 and 600,000, and `FinishedOn >= StartedOn`. The
date order is *also* checked by `IValidatableObject` on the input, so it reaches the user as a 400
beside the field rather than as a 500 out of the check constraint.

### 6. The community row is fetched client-side and cached briefly

`GET /api/games/{id}/community-times` is public, unauthenticated and always 200 — a game nobody has
logged returns three buckets of zero samples, which is an answer, where a 404 would be
indistinguishable from the game not existing.

The client fetches it **after hydration**, not in the route loader. The game page is edge-cached
for an hour ([0013](0013-http-caching-policy.md)), and the person most likely to look at this row
is the one who has just logged a playthrough of their own; serving them an hour-old figure of their
own data would read as the write having failed. Keeping it off the loader also keeps a public
page's time-to-first-byte free of a query crawlers do not need, exactly as `GameNewsPanel` does for
Steam. A failed fetch renders nothing and says nothing — a community row that did not load is not
worth an error banner on a page that rendered perfectly well.

Server-side it is cached in `IMemoryCache` for five minutes per game, consistent with
[0012](0012-steam-news-without-a-database.md): derived, regenerable, TTL'd data does not go in
PostgreSQL. Every write for a game evicts that game's key, so the member who just logged a run sees
it counted. **That eviction is per instance**: behind more than one task, another instance keeps
serving the old figure until the TTL expires, and five minutes is what bounds that staleness. It
stops being an approximation when the cache moves to Redis.

### 7. One review per entry, the score stays on the entry, and visibility ships now

`Reviews` is keyed to the entry with a unique index — one review per user per game. The **score is
not on it**: a score with no prose is the common case and must not require a review row to exist,
which is exactly why 0019 put it on the entry in the first place.

An optional `PlaythroughId` points at the run the review is about, with `OnDelete(SetNull)` —
deleting a playthrough must not take the prose with it. It is validated to belong to this user and
this entry, so it cannot be made to point at somebody else's row.

**`Visibility` ships now rather than later**, even though there are no public profiles to be
visible on. Defaulting it silently would be making a consent decision on the user's behalf and
then changing what it meant the day profiles launch — a review written privately would become
public because a feature shipped. Two values today, `public` and `private`, enforced by a check
constraint; `friends` is a third string value once following exists, which is additive.

It is a string rather than a boolean for that reason: adding a value to a string column is
additive, splitting a boolean is not.

### 8. Deleting the entry takes both, and the confirmation says so

`DELETE /api/entries/{gameId}` already meant "delete everything I have recorded about this game".
The composite foreign key cascades the playthroughs and the review with it, and the confirmation
copy now names them — the score is no longer the only thing being discarded.

The event log survives, as it always has: it records what the user *did*, not what they currently
hold, and it holds no key to the entry.

## Consequences

**The two figures 0023 could not build are now buildable, and one of them is.** `/api/user/stats`
gains a playtime section — total minutes, playthroughs, how many carry hours, and minutes per
platform — from one more scoped query over the user's own rows. Still no IGDB call: the platform
ids are resolved to names on the client, from the lists already loaded, exactly as the existing
breakdowns are.

**"Played" is now a word the data supports, but only in one place.** The existing "Most of your
games are on" row stays as it is, because a game with four platforms still counts towards all four
and that row is about library composition, not time. The new breakdown says "Most played on" and is
backed by hours. Two rows that look similar and mean different things is a risk; the labels are the
mitigation and the reason this is written down.

**The panel's playthrough writes are not optimistic**, unlike every list mutation. Optimism pays
for itself on a status toggle, where the change is one field and the gesture has to feel instant. A
seven-field form has nothing to gain from showing a row that may be about to vanish and everything
to lose from the user editing it while it does. `ListsProvider` is untouched.

**There is no test that a deletion actually cascades**, for the reason 0024 gives: the in-memory
provider cascades only to rows the context happens to be tracking, so such a test would pass or
fail on fixture ordering. The cascade is established by the model assertion in `EntryKeyTests` plus
the `ON DELETE CASCADE` the migration emits, and the migration SQL was read before it was run.

**A review is written and stored and nothing reads it but its author.** There is no public profile,
no game-page review list, no helpful-votes and no site-wide score histogram — those are Tier 2's
community signal and they need public profiles first. What ships here is the writing half, which is
the half that cannot be backfilled: a review nobody wrote in 2026 is not recoverable in 2027.

**What this unblocks.** H6's stats strip can show hours. Tier 2's community signal has review text
to aggregate. "Most played platform" is answerable. And the completion-states roadmap item is
answered by the type rather than by a percent-complete field, which nobody would keep up to date.

**What it deliberately leaves.** Ownership and personal notes on the entry, which are still
nullable columns waiting for UI. A per-game list of other people's reviews, which needs public
profiles. And any notion of a playthrough being "current" — the status list already says which game
someone is playing, and a second source of truth for that would immediately disagree with the
first.
