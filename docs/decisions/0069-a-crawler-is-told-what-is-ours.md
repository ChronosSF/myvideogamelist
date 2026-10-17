# 0069. A crawler is told what is ours: the member score in the server render, a description that leads with it, and structured data

**Status:** Implemented
**Amends:** [0028](0028-a-games-community-view.md) §4, for the scores and not the reviews

## Context

An assessment of the site's search presence on 17 October 2026 found
[0036](0036-what-a-crawler-is-told.md)'s plumbing sound — `noindex` rather than `Disallow`,
canonical URLs built from data, a sitemap from our own tables — and what a crawler finds on a game
page thin.

- **The indexed text was IGDB's.** The meta description was the summary cut at 200 characters,
  wherever the cut fell: the text every site built on IGDB serves for that game. Google's guidance
  on snippets is that identical or similar descriptions "aren't helpful".
- **The one figure that is ours was not in the HTML.** The member score was fetched after hydration
  ([0028](0028-a-games-community-view.md) §4), so a crawler indexing the server render read IGDB's
  two badges and not ours.
- **There was no structured data.** 0036 left it out in so many words.

0036 §4 also left one question open: whether the sitemap could be topped up with popular games.

## Decision

### 1. The loader reads the members' figures beside the game; the reviews stay after hydration

The game page's loader asks for `/api/games/{id}/community-scores` and `/community-times` in
parallel with the game. The hero's members badge, and a new sidebar row — "Member Score … from N
scores", below the critic and player rows that already print their counts — render from the loader's
read. Once the page has hydrated, `useGameCommunity`'s own request replaces it, and the reader's own
writes ask that hook again exactly as before (0028 §6), so somebody who has just scored the game
sees their score counted. If the browser's request fails, the loader's figure stays rather than the
badge disappearing, and the members' section is handed the same scores as the hero so the two cannot
disagree.

0028 §4 kept the whole community view off the server, for three reasons. None of them carries to the
aggregate:

- **Withdrawal decided it, and a mean has nothing to withdraw.** A review names its author, and its
  author's privacy change must not wait out the page's hour at the edge. A mean over everybody names
  nobody (0028 §2). The reviews stay exactly where 0028 put them: `/reviews` is still fetched only
  by the browser, and no review text enters the HTML or the loader's data.
- **The cost is staleness, and it is bounded.** The page is shared for an hour and servable stale
  for a day ([0013](0013-http-caching-policy.md)), so the figure in the HTML is up to an hour old,
  and once older for a page nobody asked for in a day. A reader with JavaScript sees it until
  hydration; the member most likely to look, who has just scored the game, gets the hook's figure
  from their own write on. What a crawler that does not run scripts indexes is a mean that moves one
  score at a time, an hour late.
- **The time to first byte grows by two reads of our own tables**, made while the page already waits
  for the IGDB-backed game. Both are bounded by the `(GameId, Score)` index (§2), and the times have
  the five-minute cache [0025](0025-playthroughs-and-reviews.md) gave them. A miss pays it once per
  page per hour at the edge.

**A render missing either read is degraded**: the loader attaches `no-store`, as the home page does
(0013's later note). Shared, it would go on leaving out our score, the description's lead and the
rating for an hour after the API recovered, and a day stale after that. An answer with no `tracked`
count is from an API older than this build, in the middle of a deploy, and counts as missing.

The loader also hands `meta` the day it ran, in UTC, for the one rule below that depends on the
date. `meta` runs in the browser too, and a date it read there could differ from the server's and
write a different tag.

### 2. The scores also say how many members track the game

`CommunityScoresDto.Tracked`: entries in one of the five lists, over everybody — the figure a
profile's statistics call `Tracked` (`LibraryStatsDto`), counted per game. It names nobody, so every
profile counts, as the scores do (0028 §2); the sitemap already says that somebody tracks each game
it lists (0036 §4).

It rides on the scores rather than a new endpoint so that the loader makes one request for both. It
is a second query rather than the status folded into the first, which would cost the scores read its
index-only scan. `EXPLAIN` against the local copy, with sequential scans off because the table is
too small for the planner to prefer an index: a bitmap scan on `IX_UserGameEntries_GameId_Score`,
the status checked as a filter.

### 3. The description leads with ours and ends with the summary's first sentence, in 160 characters

What only this site knows comes first, each figure behind the floor the page applies and with its
count ([0016](0016-scores-carry-their-sample-size.md)): how many members track the game; the member
score, at `MIN_MEMBER_SCORES` or more, out of 100 ([0021](0021-one-control-for-a-score.md)); and the
median time of the `normally` tier, at `MIN_PLAYTHROUGH_SAMPLES` or more. Then the first sentence of
IGDB's summary, cut after a whole word with an ellipsis so that the whole fits. From the local copy:

> Tracked by 3 members. Member score 94/100 from 5 scores. Normally beaten in 50h (median of 3
> playthroughs). Metal Gear Solid 3: Snake Eater is the prequel to…

> Mario is super in a whole new way!

- **One tier, `normally`**, so the sentence means the same thing on every game. It is the middle
  tier, where most logged runs land — the import maps both of Grouvee's "Main Story" levels to it
  ([0050](0050-an-imported-run-takes-its-type-from-the-source.md)) — and the one IGDB's "normally"
  answers to. A game whose members log only rushed runs gets no time in its description.
- **The first sentence and no more**, even when the second would fit. The first is the one that says
  what the game is; running on into the second is the summary cut short again. A first sentence is
  found by a heuristic: a stop before a capital or a number ends one, unless it follows a listed
  abbreviation, a lone initial or letters written with stops.
- **160 is ours.** Google sets no limit and cuts a snippet to fit the device; this is about what a
  desktop result shows whole, so the cut falls at a word we chose. When fewer than twenty characters
  would be left for the sentence, the description ends on our last figure instead.
- No summary is our figures alone, and nothing at all is the old "Track … on MyVideoGameList."
  `og:description` is the same text, through `pageMeta`.

### 4. Structured data: `VideoGame` and `BreadcrumbList` on a game page, `WebSite` on the home page

| Property | From | Rule |
|---|---|---|
| `name`, `url` | the title, the canonical URL | the same path `pageMeta` is given |
| `image` | the cover, else the key art | |
| `description` | IGDB's summary | the page's About text |
| `datePublished` | the release date | only once that day has come, in UTC |
| `genre`, `gamePlatform` | names | |
| `author`, `publisher` | developers, publishers, as `Organization`s | schema.org gives a game no `developer` |
| `aggregateRating` | the members' scores | at `MIN_MEMBER_SCORES` or more; never IGDB's |

- **The rating is ours or nothing.** Google's review-snippet guidelines say not to aggregate ratings
  from other websites, and IGDB's critic score and player rating are IGDB's. `ratingValue` is the
  badge's number, `ratingCount` the scores behind it, `bestRating` 100, and `worstRating` 10 — half
  a star, a 1 of 10 — rather than Google's default of 1. Google also wants a marked-up rating
  visible on the page, which is what §1's server-rendered badge and row are for. The block holds the
  loader's figure; a crawler that runs the page may by then see the hook's fresher one in the badge,
  within the cache window.
- **`datePublished` waits for the day** because IGDB dates a game it knows only by its year with the
  year's last day (the evidence table in `specs/release-timeline-and-calendar.md`), so an unreleased
  game would announce a day nobody named.
- **The breadcrumb is Home, Games, the game**, the page's own "Games" link above the title made
  explicit.
- **The home page's `WebSite`** carries the site's name and its canonical address — what Google
  reads for the site name over a result, and only from the home page — and a `SearchAction` to
  `/games?search={search_term_string}`, built through `@/lib/gameBrowse`'s `browseParams` so that it
  names the parameter the browse page reads. Google stopped showing the sitelinks search box that
  the action asked for on 21 November 2024, and says the markup can stay. It costs nothing and other
  readers of schema.org may use it.
- **No `SITE_URL`, no structured data.** Every URL in it is absolute and built from the configured
  origin, as the canonical URL is (0036 §6), so a deployment with no public address writes none.

### 5. Through `meta`, and what 0053's script policy makes of it

Each block is a `script:ld+json` descriptor returned from the route's `meta`, which React Router
8.4's `<Meta>` renders on the server as `<script type="application/ld+json">` in the head. It
escapes the JSON's `&`, `<`, `>`, U+2028 and U+2029 as `\u` sequences, so a title holding
`</script>` cannot end the block; Super Mario 64's developer arrives as `Nintendo Entertainment
Analysis \u0026 Development`.

Under ADR 0053's policy, `script-src 'self' 'nonce-…'`, which
[#254](https://github.com/ChronosSF/myvideogamelist/pull/254) adds, the blocks carry no nonce and
need neither it nor a hash. A script whose type is not JavaScript is a data block: the browser never
runs it, so it never consults `script-src` about it. #254's own entry test already leaves data
blocks out of its check that every script carries the nonce. And 0053 §2's rule that no
`dangerouslySetInnerHTML` enter `src/` holds: the one that writes these is React Router's, and it
writes escaped JSON into an element whose contents HTML reads as raw text, so no markup can come of
it. Checked with #254's branch merged into this one locally: the header names a nonce, every
JavaScript block carries it and the two JSON-LD blocks do not, the page hydrates, no violation is
reported on load or on a client-side navigation to another game, which rewrites both blocks, and the
client suite passes.

### 6. The sitemap is not topped up: `CachedGames` has nothing it does not already list

0036 §4 rejected topping the game files up with popular games because it would make the sitemap
depend on IGDB, and left the door open for later. Read from `CachedGames` alone, there is nothing to
top up with. The sitemap already lists every row that is not a tombstone, and the table is written
only by reads of games somebody has — lists, wishlist, favourites, profiles, an import's review —
and by the import matcher warming the games it is about to show. Browse, search, the trending rail
and the game page never write to it, on purpose: `IGameCacheService.StoreAsync` explains why filling
it from listings would grow it without bound, and [0012](0012-steam-news-without-a-database.md)
keeps the rail out of the database. In the local copy that is 682 rows, 682 listed. Any rule for
"popular" over that table picks a subset of what is already there.

A real top-up needs games from outside the table: an IGDB call in the sitemap, or rows written for
games no member has. Both are what 0036 §4 and `StoreAsync` reject, so it stays rejected.

The count turned up one thing beside the point: 29 of the 682 belong to no entry, wishlist item or
favourite — games somebody later deleted everything about, or candidates an import offered that
nobody chose — and are listed anyway, so 0036 §4's "games a member has put on a list" is slightly
wider in practice.

## Consequences

- **0028 §4 holds for the reviews and no longer for the scores.** Its status line points here.
  Review text is still indexed only where it belongs, on its author's profile.
- **A database outage makes game pages `no-store`**, so every request for one reaches the origin
  while it lasts — the trade the home page already makes. An IGDB outage was already a 502.
- **The floors now reach further than the page.** A change to `MIN_MEMBER_SCORES` or
  `MIN_PLAYTHROUGH_SAMPLES` changes the descriptions and the structured data as well.
- **Structured data says only what the page shows.** Something taken off the page comes out of
  `gameStructuredData` in the same change, or the markup claims what a reader cannot see.
- **A new figure of ours on the game page goes through the loader** if it should reach a crawler,
  and answers this record's question first: whether it names anybody, and how long it may be stale.
- **Not done:** an `alternateName` for the site, an `Organization` with a logo, and the default
  share image 0036 left open.
