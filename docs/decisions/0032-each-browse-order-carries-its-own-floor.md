# 0032. Browse filters: every order is one IGDB query, and each carries its own floor

**Status:** Implemented

## Context

Tier 2 asked for real browse filters: *"genre, platform, release year, score range, ESRB, and sort by
rating / release date / name / popularity"*, and suggested IGDB's popularity types 2 ("Want to Play")
and 3 ("Playing") as the basis for a popularity sort. The listing offered a search and one order, the
critic score over games with at least eight critic reviews ([0016](0016-scores-carry-their-sample-size.md)),
which that record said would make `/games` "the well-reviewed slice" of the catalogue — and that "if the
listing should ever offer 'everything, newest first', that is a new sort mode rather than a relaxation of
this threshold".

Everything below was checked against live IGDB on 15 September 2026, because each finding changed the
design.

**Popularity lives on another endpoint.** `popularity_primitives` rows carry a `game_id` and a value, and
Apicalypse has no join. A popularity order with filters would therefore be two queries: a bounded top
list, at most 500 rows a request, then the games among them that match the filters — and a narrow filter
leaves little of a top 500.

**The two suggested types read worse than a third.** The top 25 of type 3, "Playing", included stream-
driven entries such as *Marbles on Stream* and *Pokémon Community Game*. Type 2, "Want to Play", led on
anticipation, with *The Elder Scrolls VI* — no release date — in its top 25. Type 4, "Played", read as the
canon, and its top was close to the games' own `total_rating_count` in descending order: *Grand Theft Auto
V*, *The Witcher 3* and *Portal 2* were the first three of both.

**The critic floor hides recent games.** The newest game with eight critic reviews was released on
1 December 2025. Top rated narrowed to 2026 returned nothing. Well-known 2025 releases carry four to
seven: *Hollow Knight: Silksong* four, *Clair Obscur: Expedition 33* five.

**Without a floor, newest first and A to Z are junk.** Newest first opened on games released that day
that nobody has heard of. A floor of ten ratings fixed newest first, but A to Z still had a series of
cat-collecting games in its first ten, holding twelve to sixteen ratings with no critic review and no hype.
Rating counts alone cannot separate them from real releases: the past month's games with a critic review
— *Mortal Shell II*, *The Blood of Dawnwalker*, *Big Walk* among them — held between twelve and thirty.

**Two more facts constrained it.** IGDB answers a `search` that carries a `sort` with a 406. And
`age_ratings` rows no longer return `category` or `rating`, only `organization` and `rating_category`,
which is what the existing ESRB mapping reads.

## Decision

### 1. Four orders, each one query, each with a floor that makes it mean something

| Order | Sort | Lists only |
|---|---|---|
| **Top rated** (default) | `aggregated_rating desc` | at least eight critic reviews — unchanged from 0016 |
| **Popular** | `total_rating_count desc` | at least ten ratings |
| **Newest** | `first_release_date desc` | released, at least ten ratings, at least one critic review |
| **A to Z** | `name asc` | at least ten ratings, at least one critic review |

Popularity is the game's own rating count rather than a popularity primitive. It composes with every
filter in one `where` clause, pages by offset like the other orders, and ranks the catalogue the way type 4
does. The trending rail keeps type 5, which answers a different question: what is being played on Steam
today.

Popular needs no critic, because its ranking already is a measure of attention: a game players rated
heavily and no outlet reviewed belongs near its top. Newest and A to Z rank by nothing about the game, so
they take both floors. Newest first is the "new sort mode" 0016 anticipated, and it relaxes nothing about
Top rated.

### 2. Four filters, all in the same clause, all applying to a search

- **Platform**, from `ActivePlatforms` — the same list the calendar's preference uses.
- **Genre**, from IGDB's own genres through `GET /api/genres`, cached for a day. IGDB is the source of truth
  for what a genre is ([0001](0001-igdb-as-source-of-truth.md)), and the ids are what the filter sends.
- **Release year**, as the whole UTC calendar year of first release. The select runs from this year back
  to 1970: next year's games have too few ratings for any order's floor, so it would only ever be empty.
- **Critic score**, 60 to 90 and above, out of 100 as every aggregate is shown
  ([0021](0021-one-control-for-a-score.md)). It brings the eight-critic floor with it whatever the order,
  or "80 and above" is every game one critic loved.

A search keeps the filters and drops the order and its floor. It must reach thinly reviewed games
(0016), and IGDB orders search results itself. The order control is disabled while searching and says why.

**ESRB is left out.** The fields the current mapping reads no longer come back, so a filter built on them
would match nothing, silently. Fixing the mapping is its own piece of work.

### 3. The URL is the state

`search`, `sort`, `platform`, `genre`, `year` and `minScore`, with every default left out, so the plain
catalogue has exactly one address — and it is the only one that is indexable; every other combination is
`noindex, follow`, as a search already was. The loader reads the URL, server-renders the first page, and
fetches the genres and platforms alongside. If either fails, that one filter is left out and the render is
`no-store`, so the gap is not pinned at the edge.

One module, `@/lib/gameBrowse`, turns a query string into a browse and back. The loader, the "load more"
requests and the controls all go through it. A malformed value is dropped there rather than sent, and the
API refuses the same values with a 400 on its own: an unknown order, a year outside 1950–2100, a score
outside 1–100.

A well-formed value the controls do not offer is honoured, and shown. A stale link can name a platform no
longer active or a genre IGDB has dropped, and a hand-edited one a year or a score between the offered
steps. The listing is narrowed by it either way, and a select with no option for its value displays its
first one — "All platforms" over a page that is not all platforms. So each select adds the value as an
option of its own ("Unlisted platform", "75 and above"), and keeps it on screen even when that filter's list
failed to load, where it can be seen and cleared.

A filter change is a new history entry; typing a search still replaces the entry, as before, and a filter
picked before the search debounce fires carries the typed term with it.

### 4. Each order says what it leaves out

A floor the reader cannot see makes the catalogue look smaller than it is. Under the controls, one line
names the current order's floor. When Top rated is filtered to nothing, the empty page says that it only
ranks games with at least eight critic reviews, and that Popular and Newest reach further.

## Consequences

**The CDN cache key for `/games` grows from one parameter to six.** ROADMAP D12 and `CACHE_GAMES_LIST`
say so; a behaviour keyed on `search` alone would serve one visitor's filters to the next.

**Each combination is its own IGDB query.** The API caches each for thirty minutes per instance, keyed on
every input — not on the clock newest first reads, so a cached page can miss a release made in the last
half hour, as every other cached page here can.

**Paging by offset over one sort field can repeat a game** when neighbours tie. The page drops a game it
has already shown when it appends the next page, rather than rendering it twice under one key.

**Top rated stays blind to recent games.** That is a property of how few critic reviews IGDB aggregates for
them, not something a filter can fix, and the empty state is where it is explained.

**The popularity primitives are not used by the listing.** If a "popular right now" order is ever wanted,
type 3's stream-driven entries are the thing to deal with first.
