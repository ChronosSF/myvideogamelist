# 0035. A local copy of what IGDB said, so a library renders without them

**Status:** Implemented

## Context

IGDB is the source of truth for game data ([0001](0001-igdb-as-source-of-truth.md)), and until now
that meant every page showing somebody's games asked IGDB on every render. Seven call sites did it:
the lists, the wishlist, the favourites, the public profile twice, and the Steam news mapping.

The consequence was out of proportion to what IGDB actually supplies. A list is *our* row — a
status, a score, when it moved — and IGDB contributes a title and a cover. Yet an IGDB outage made
the whole page fail, so a user could not see their own library because a third party was down.
That has been structural issue #2 in `ROADMAP.md` since the roadmap was written, and
`docs/data-model-plan.md` sequenced this table **before public profiles and any SEO-bearing page**,
"because those have to render without a live IGDB call". Public profiles shipped first
([0027](0027-usernames-and-public-profiles.md)), then the game-page community view
([0028](0028-a-games-community-view.md)); the table did not.

It also made `/readyz` dishonest. That endpoint returns 200 for a degraded IGDB on the argument
that "browsing breaks but stored lists still work, so the instance should stay in rotation". The
second half was not true.

There was a cache, but of the wrong shape: `GetGamesByIdsAsync` memoised **the exact set of ids**
for thirty minutes, so a different combination of the same games was a complete miss, and the whole
thing died with the process.

## Decision

### 1. One row per IGDB id, holding the document IGDB gave us

`CachedGames`: the IGDB id as the key, the mapped `GameDto` as `jsonb`, and `Title`,
`ReleaseDate`, `CoverImageUrl` and `Rating` extracted beside it for reading a shelf without
deserialising every payload. `RefreshedAt` says how old it is, and is indexed because that is what
a refresh job will order by.

Not a normalised catalogue of games, genres and platforms. That existed here once and was deleted:
its `Platform` ids collided with IGDB's — local 6 meant Switch where IGDB's 6 means PC. A document
keyed on IGDB's own id cannot collide with anything and needs no migration when IGDB adds a field.

### 2. Refreshed on read, a day old

A request asks IGDB only for the ids it has never seen or has not read for a day. What the table
holds barely moves — a title, a cover, a release date — and the one figure that does, the player
rating, moves slowly and is displayed rounded. Shorter would spend IGDB's four-a-second allowance
re-reading games nobody's shelf has changed; much longer would leave a new release looking unrated
for a week.

A background refresh job is the better long-term shape and is listed in the roadmap's §5 beside the
distributed cache. Rows carry the timestamp and the index it would need; nothing here has to change
when it lands.

### 3. An IGDB failure is swallowed, and that is the whole point

`GameCacheService` catches a failed IGDB call and serves whatever is stored, **however old**. The
backend rules say a service must not swallow a third party's failure to fake a 500, and ask the
deliberate exceptions to say so out loud: this is one, next to the home composite and the health
check.

A cancellation is deliberately *not* swallowed. A reader who navigated away is not an outage, and
treating it as one would hide the cancellation the whole stack propagates
([0034](0034-failing-in-one-shape.md)).

**Only the call to IGDB is inside that catch**, which the first version got wrong and review on the
pull request caught: it wrapped the write as well, so a database hiccup was logged as an IGDB
outage and threw away games already in hand. The write is tolerated too — a cache that cannot be
written is a page that is slower next time, where a cache that throws is a page that fails now —
but it is caught separately, reported as itself, and the answer is whatever IGDB just said. Rows
left pending are detached either way, so a failed cache write cannot be retried by whatever the
request saves next and fail that too.

### 4. An id IGDB cannot answer gets a tombstone

A row with a null payload records that IGDB had no such game when we asked. Without it, a game
withdrawn from IGDB but still sitting on somebody's list means an IGDB call on every page load
forever — which is the "cache misses as well as hits" rule the backend conventions already state,
applied to a durable table.

### 5. Known ids only

Browse and search stay on `IIgdbService`. They are arbitrary queries over the whole catalogue, not
lookups of games somebody already tracks, and no local copy could answer them. So an IGDB outage
now costs *browsing* — which is what `/readyz` has always claimed.

### 6. Not user-owned, and therefore outside the ownership contract

`CachedGames` carries no `UserId`. It is shared by every account, holds nothing anybody entered,
and is regenerable from IGDB. So it has no cascade from `AspNetUsers` and no entry in the export
manifest ([0024](0024-the-ownership-contract.md)) — deleting an account must not delete the games
that account happened to be first to cache, and exporting a user's data should not hand them a copy
of IGDB.

## Consequences

- **Measured**, against bob2870's 27 games: a cold list took 1.12s and filled the table; the next
  took 0.05s with no IGDB call at all. With a deliberately broken IGDB credential, the list still
  rendered all 27 entries with their titles and covers, `/api/games` returned 502, and `/readyz`
  reported degraded — the promise that endpoint has been making since it was written.
- **The staleness is real and bounded**: a title or a rating can be a day old on a list, where
  before it was thirty minutes old at most. The game page is unaffected — it asks IGDB directly for
  the detail fields ([0017](0017-detail-data-off-the-listing.md)), and nothing detail-shaped is
  stored here.
- **A change to `GameDto`'s shape makes stored payloads unreadable.** One is dropped, logged, and
  rewritten at the next refresh, so the cost is one game missing from one page for up to a day
  rather than an exception. A change that must take effect immediately needs the table truncated.
- **Two singletons still call IGDB directly** — the Steam news mapping and the home composite — so
  the set-keyed in-memory cache stays for them. It is now redundant for everything else, and
  removing it belongs with moving those two behind this service or behind the distributed cache.
- **The distributed cache in §5 does not replace this.** Redis would hold the same data with a TTL;
  this is the durable copy that survives a restart and an outage, and PostgreSQL is already shared
  between instances.
- **[0012](0012-steam-news-without-a-database.md)'s parked question is now answerable but stays
  parked.** That record keeps the IGDB→Steam AppID map in memory, noting that once this table exists
  the AppID is "just another IGDB-sourced field of a cached game". It is — but the mapping is fetched
  from a different IGDB endpoint than the one that fills this table, so folding it in is its own
  change rather than a line in this one.
