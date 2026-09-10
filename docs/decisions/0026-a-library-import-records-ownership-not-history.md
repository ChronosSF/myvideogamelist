# 0026. A library import records ownership, not history

**Status:** Accepted

## Context

The roadmap calls importing from Steam an early bet, on the grounds that retyping 300 games is the
single biggest reason people abandon a new tracker. The plumbing looks close to free:
`IgdbService.GetSteamAppIdsAsync` already resolves IGDB games to Steam AppIDs through
`external_games` for the news feature ([0012](0012-steam-news-without-a-database.md)), and an import
needs the same endpoint, the same `external_game_source = 1` constant and the same chunking with the
`where` clause inverted — `where uid = (...)` instead of `where game = (...)`.

That cheapness was the wrong reason to reach for the feature, and it nearly hid the question that
actually decides it: **does Steam model the concept we would be importing into?**

### What Steam returns

`IPlayerService/GetOwnedGames` gives one row per owned game: `appid`, `name`, `playtime_forever` in
minutes, `playtime_2weeks` (present only when non-zero), `rtime_last_played`, and per-OS playtime
splits. That is the entire surface relevant to a status.

Two operational notes that do not appear in the happy path. It needs a Steam Web API key, unlike the
keyless `ISteamNews` endpoint we already call, so it is the first Steam credential the project has to
hold. And it requires the user's *Game details* privacy setting to be public: when it is not, the call
returns an empty payload rather than an error — the same silent-empty failure class as IGDB's removed
`external_games.category`, and it must not be reported to the user as "you own nothing".

### What that maps to

| Signal | Infers | Confidence |
|---|---|---|
| `playtime_forever == 0` | Backlog | High — owned, never launched |
| `playtime_2weeks > 0` | Playing | Medium — our statuses are exclusive, a player's attention is not |
| `playtime_forever > 0`, not recent | Finished? Dropped? On Hold? | **None** |

The third row is most of a real library. `rtime_last_played` records when someone stopped, never why,
so a twelve-hour narrative game with the credits rolled and a three-hour abandonment are identical in
the payload. Worse, a game with no ending at all — Factorio, Dota, a city builder — accumulates the
largest `playtime_forever` in the library, so any heuristic ranked on hours promotes exactly the games
for which "finished" is meaningless.

Achievements look like a refinement and are a dead end: not every game has them, Valve does not flag
which achievement means the credits rolled, and checking them is one call per game against a
rate-limited API for a signal that would still need a curated per-game mapping to interpret.

## Decision

### 1. The import records what the user owns, and infers exactly one status

- `playtime_forever == 0` → **Backlog**. High confidence, and also the harmless default: Backlog is
  the status that means "I have not decided about this yet", so being wrong costs nothing.
- Anything played → an **entry with `StatusId` null**. [0019](0019-entry-survives-leaving-every-list.md)
  already defines that shape as "a game the user has data about but is not currently tracking", which
  is precisely and honestly what an imported played game is.
- The Steam wishlist → **our wishlist axis**, one-to-one with nothing inferred, because
  [0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) made the wishlist non-exclusive and
  `AddedAt` its entire history. (Steam's wishlist endpoint needs its own verification before this part
  is built; the store-side one has historically been undocumented and unstable.)
- All of it behind a **review-and-confirm screen**, never a background auto-write.

`playtime_forever` is real data and is deliberately *not* imported as a playthrough. A playthrough
needs a type to be worth anything — [0025](0025-playthroughs-and-reviews.md) only counts runs carrying
both a type and a duration towards the community medians — and Steam cannot supply one. An import that
created typed playthroughs would be inventing the same answer this record refuses to invent for
statuses, and it would pollute a figure other users read.

### 2. The import writes no events, and that is the point

`ListService.AppendEvent` stamps `OccurredAt` from `timeProvider.GetUtcNow()`. An imported status
routed through the normal path would therefore write *"started playing Half-Life 2 on the day of the
import"* into `UserGameEvents` — a table that is append-only by design and is the one thing in the
schema no migration can reconstruct ([0018](0018-append-only-status-event-log.md)).

That asymmetry is what settles the design. A wrong `StatusId` is a value the user overwrites in one
click. A wrong event is permanent fabricated history, and deleting the entry afterwards does not
remove it — the log holds no key to the entry and survives on purpose. So an import may write current
state and must not write history.

Nothing in the database prevents this: `UserGameEntries` and `UserGameEvents` are independent tables
with no trigger and no constraint between them. The invariant is a convention that lives in
`ListService` alone, which is exactly why the exemption has to be written down rather than discovered.

### 3. The statistics already split the right way

No special-casing is needed in `StatsService`, because [0023](0023-profile-statistics-derived-at-read-time.md)
split its four sections by what each depends on and they do not overlap:

| Section | Reads | Includes imported games |
|---|---|---|
| `BuildLibrary` — counts, completion rate | entries | Yes |
| `BuildScores` — histogram, mean | entries | Yes, though an import carries no scores |
| `BuildActivity` — monthly chart, streaks, median active time | **events** | **No** |
| `BuildPlaytime` — hours, per-platform | playthroughs | No |

An import of 312 unplayed games raises the backlog count, because the user genuinely does own 312
unplayed games, and leaves the activity chart, the finish streak and the median time-to-finish
untouched, because they did not do those transitions this month. The entry table answers *what you
hold* and the event log answers *what you did*; an imported status is a true statement about the first
and would be a false one about the second.

### 4. `Origin` on the entry, so the exemption is explicit

The absence of an event must not be the way imported rows are identified. Absence is indistinguishable
from a bug that dropped an event, and reading a rule as "unless somebody imported it" from missing
rows is precisely the reverse-engineering these records exist to prevent.

So `UserGameEntry` carries an `Origin` — `manual` by default, `steam` for imported rows. It makes
0018's rule checkable rather than folklore: *a status has an event behind it unless its entry's
`Origin` is not `manual`*. It gives the UI something concrete to attach the disclaimer to. And it
makes "undo my import" possible, which matters more than it sounds when somebody's first import goes
wrong and the alternative is unpicking hundreds of rows by hand.

A string rather than a boolean, for the reason `Reviews.Visibility` is a string in
[0025](0025-playthroughs-and-reviews.md): PSN, Xbox and GOG are additional values, and adding a value
to a string column is additive where splitting a boolean is not.

### 5. `StatusChangedAt` stays null on an imported status

It is the sort key behind "recently moved". Setting it to the import timestamp puts the entire
imported library at the top of that order and buries everything the user actually touched. Steam
cannot say when the status became true, and null is how this schema already says "no known transition
time".

## Consequences

**0018's invariant becomes conditional, and that is the real cost of this decision.** "Every status
has an event behind it" stops being true of the data. Anything written later that assumes it —
a Tier 3 activity feed, an audit, a backfill, a timeline reconstruction — has to consult `Origin`.
The column is what keeps that discoverable, but the burden is genuine and is the reason this record
exists rather than a comment in an importer.

**`UserOwnedDataTests` will not catch the new column.** The export manifest is keyed by entity `Type`
and `UserGameEntry` is already registered, so adding a column trips no guard — but `ReadEntriesAsync`
in `UserDataExporter` is a hand-written projection, so `Origin` has to be added to it deliberately or
it is silently missing from the export.

**The import needs a Steam Web API key**, the project's first. It follows [0005](0005-secrets-handling.md)
like every other credential: user secrets locally, an environment variable when deployed.

**We give up any claim that the import knows what the user finished**, which is the feature people
expect and the one Steam cannot support. The honest pitch is de-duplication and data entry: "here are
312 games you own that are not in MyVideoGameList, most of them unplayed." That is worth building; a
status oracle is not, and would have been worth *less* than nothing given what it writes to the log.

**PSN, Xbox and GOG inherit this shape.** They differ in what they expose, but none of them models our
five statuses either, and `Origin` is where each of them lands.

**Nothing blocks this.** It needs no public profiles, no metadata cache and no schema surgery beyond
one nullable column — which is also why it is safe to leave until the items ahead of it are done.
