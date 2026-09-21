# 0036. What a crawler is told, and which deployment tells it

**Status:** Implemented

## Context

Server rendering ([0002](0002-server-side-rendering.md)) made the pages readable by a crawler, and
nothing since had told one *which* pages, under *which* address, or from *which* deployment. There
was no `robots.txt`, no sitemap and no canonical URL (ROADMAP D8), and the social tags were stated
page by page with gaps (D9).

Three things were wrong rather than merely missing:

- **One page answered to many addresses.** `/games/0012` and `/games/12?ref=x` both render game 12,
  and `/u/ALICE` renders `/u/alice`, because the profile lookup matches `NormalizedUserName`
  ([0027](0027-usernames-and-public-profiles.md)). Nothing said which address was the page's own.
- **The game page declared `og:type` `video.game`**, which is not a type. Open Graph's
  [list](https://ogp.me/#types) has `video.movie`, `video.episode`, `video.tv_show` and
  `video.other`, and nothing for a game.
- **It asked for the large card with a portrait cover.** A large card is cropped wide, so a cover
  came out as a strip across its middle.

Two constraints shape the rest. The API serves `/api/*` and nothing else
([0003](0003-two-process-deployment.md)), so anything that lives at the site's root is the
front-end server's to serve. And one image is built once and deployed to dev and then to production
(ROADMAP §6), so whatever differs between them has to be read at run time, not baked in — and dev
must never be indexed beside production (D3).

## Decision

### 1. Two environment variables, and forgetting fails closed

The front-end server reads `SITE_URL`, the origin the public sees, and `SITE_INDEXABLE`, which must
be exactly `true`. A deployment is indexable only with both.

`SITE_URL` is configuration and never the request's own origin: behind a CDN and a load balancer
the request names whichever of them spoke to the process last, and a canonical URL pointing at an
internal hostname is worse than none.

The default is *not indexable*, for the reason the root's cache policy is `no-store`
([0013](0013-http-caching-policy.md)): the cost of forgetting should land on the side that is cheap
to notice. A production deployment missing a variable goes unindexed, which one `curl -I` shows. A
staging deployment indexed by accident competes with production for every page it has.

### 2. `noindex`, never `Disallow` — for staging, for the per-user pages and for the API

A deployment that is not indexable sends `X-Robots-Tag: noindex, nofollow` on every response, from
`entry.server.tsx`, so that its 404s carry it too. Its `robots.txt` disallows **nothing**, and that
is the part that reads as a mistake and is not. Google's
[documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing) is
explicit: a crawler refused by `robots.txt` "will never see the `noindex` rule", and the page "can
still appear in search results, for example if other sites link to it". Letting the crawler in and
telling it no is the only one of the two that keeps a page out.

The same reasoning, twice more:

- `/lists`, `/wishlist`, `/user` and `/news` carry a `noindex` of their own. What a crawler is
  served there is the signed-out shell.
- **`/api/` is not disallowed either.** The API sends `X-Robots-Tag: noindex` on everything instead.
  A crawler that renders a page fetches what the page fetches, and a game's member reviews and
  completion times arrive after hydration by design ([0028](0028-a-games-community-view.md)).
  Disallowing `/api/` would hide exactly the part of a game page that is ours.

The browse filters are `<select>`s, so there is no lattice of filter links for a crawler to walk.
If they ever become links, revisit this: every distinct filtered URL is an IGDB query.

### 3. `robots.txt` and the sitemap are routes on the front-end server

Resource routes under `src/resources/`, not files in `public/`, because what they say depends on
the deployment. A resource route returns its own `Response` and never passes through
`entry.server.tsx`, so `resourceResponse` adds by hand what that file adds to a document.

### 4. The sitemap lists what we have something to say about, from our own tables

- **Games: every `CachedGames` row that is not a tombstone** — the games a member has put on a list,
  a wishlist or a shelf of favourites ([0035](0035-a-local-copy-of-what-igdb-said.md)). A page that
  only repeats IGDB is a page every IGDB-backed site has; these are the ones that have, or are about
  to have, something of ours on them.
- **Profiles: public, and not empty.** A private name must never appear — a sitemap is a
  publication, and that would answer the question a private profile's 404 exists to refuse. An empty
  profile is left out because the profile page marks it `noindex`; the two tests
  (`SitemapService.ListedProfiles` and `ProfilePage`'s `meta`) have to agree.
- The two static pages that are the same for everybody: `/` and `/games`.

It makes **no IGDB call**, for the reason the statistics ([0023](0023-profile-statistics-derived-at-read-time.md))
and the export do not. And when the API behind it does not answer, the sitemap is a `502` and
uncached rather than a valid file with nothing in it: a crawler retries a failure, whereas an empty
list is an answer.

*Membership names nobody.* A listed game says somebody here tracks it, never who — the reading 0028
gives an aggregate score, with the caveat it records: at a handful of members the set is small
enough to be one person's library, unattributed.

Each entry is a `<loc>` and nothing else. Google
[ignores](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
`<priority>` and `<changefreq>`, and uses `<lastmod>` only where it is "consistently and
verifiably" accurate, which nothing here could promise: `RefreshedAt` is when we last asked IGDB,
and a profile changes with every score, playthrough and favourite.

An index from the first day, 10,000 URLs to a file against the protocol's 50,000, so the address
given to a search console never has to change. The page size travels from the API with the counts.

**Rejected:** listing IGDB's whole catalogue, and topping the list up with the most popular games.
The second is reasonable and can be added later; it was left out because it makes the sitemap depend
on IGDB, and because a crawler already reaches those games through the home page's rails and the
similar-games links.

### 5. One cache, and the profile file keeps the profile's hours

The API's three feeds send `no-store`; the XML in front of them states the policy. Two TTLs would
add up, as the home page's already do (0013). The index, the static file and the game files are
held for an hour. **The profile files use `CACHE_PROFILE`**, so a sitemap cannot go on naming a
profile for longer than the profile's own page could have been served.

### 6. The canonical URL is built from the data, never from the request

`/games/{id}` from the game the API answered with; `/u/{name}` from the name as its owner
capitalised it, plus `?page=N` past the first page of reviews, each of which is a document of its
own. The sitemap writes the same strings. A page that is `noindex` — a filtered `/games`, an empty
profile — gets no canonical URL: the two together say different things about the page.

`meta` runs in the browser as well, where the environment does not exist, so `site` travels as
**loader data on each indexable route**. A root loader was the obvious home for it and was rejected:
it would either add a server round trip to every navigation to a route that has no loader today
(`/lists`, `/user`), or need `shouldRevalidate`, which puts a `_routes` parameter on every `.data`
URL the CDN behaviours are about to be written against (ROADMAP D13).

### 7. Every indexable page's tags come from one function

A leaf route's `meta` replaces its parents', so site-wide tags cannot live on the root. `pageMeta`
returns the whole set — title, description, canonical, `og:site_name`, `og:type`, `og:title`,
`og:description`, `og:url`, the image and the card — so no page states half of them. The game page
shares key art on the large card where IGDB has any, and the cover on the small square one where it
does not.

## Consequences

- **Deployment has two more variables to set**: `SITE_URL` everywhere, `SITE_INDEXABLE=true` in
  production only. Basic auth in front of dev is still D3's other half and belongs to the CDN.
- **ROADMAP D14 grows by one URL.** A profile switched to private, renamed or deleted has to change
  in `/sitemaps/profiles-*.xml` when it changes at `/u/{name}`, so the invalidation names both.
- A new indexable route needs three things: `site` in its loader data, `pageMeta` with a `path`
  built from data, and a place in the sitemap.
- The API's `X-Robots-Tag` is what makes leaving `/api/` crawlable safe. Removing it, or adding a
  `Disallow`, each breaks the other's reasoning.
- **Not done:** a default share image, so the home page, the catalogue and profiles unfurl without
  one — it needs a designed raster image the repository does not have. Structured data is not part
  of this. Neither is registering the site with a search console, which is a DNS record and belongs
  with the infrastructure.
