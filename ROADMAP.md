# MyVideoGameList — Feature & Platform Roadmap

A gap analysis of the current codebase plus the feature set required to reach a complete,
polished game-tracking product that runs on AWS and ships safely on every commit.

---

> **Status:** Phase 0 is complete, and D10 (SSR) landed early because it gates the SEO items.
> See §7 for what that covered and what is next.
>
> This file is the **plan**, and it gets rewritten as phases land. For *why* the code is the
> way it is — the decisions and the alternatives rejected — see [`docs/decisions/`](docs/decisions/).
> When a decision here is made and built, graduate the reasoning into a record there rather
> than leaving it buried in a plan that will be rewritten around it.

## 1. Where the app stands today

**Works end to end**

- Cookie-based auth (register / login / logout / `me`) on ASP.NET Core Identity — `Controllers/AuthController.cs`
- Browse & search games backed live by IGDB, 20 per page with "load more" — `Controllers/GamesController.cs`, `Services/IgdbService.cs`
- Three lists (`playing`, `backlog`, `finished`) with optimistic updates and rollback — `Services/ListService.cs`, `src/contexts/ListsProvider.tsx`
- Game detail page (server-rendered), upcoming-releases timeline over a 30-day window, per-user hidden-platform filter
- Server-persisted light/dark theme
- Server-side rendering via React Router 8 framework mode, with real titles and Open Graph tags
- CI: lint, type-check, build, unit tests and CodeQL on PRs and pushes to `master`

**Structural issues**

| # | Issue | Status |
|---|---|---|
| 1 | The `Game` / `Developer` / `Publisher` / `Genre` tables were seeded with 5 hardcoded games and were effectively dead, while `GamesController` read IGDB only. Two sources of truth. | **Fixed** — they were UI scaffolding from before IGDB was wired up. Seed data, controllers, entity classes and all nine tables removed (`DropLocalGameCatalog`). The metadata cache will be designed fresh around IGDB ids |
| 2 | No local cache of game metadata: every list load fans out to IGDB (`GetGamesByIdsAsync`). If IGDB is down or rate-limits, users cannot see their own lists. | **Fixed** — `CachedGames` holds one `jsonb` row per IGDB id, refreshed on read after a day and served however stale when IGDB is unreachable. Measured with IGDB deliberately broken: a 27-game list rendered in full while browsing returned 502 (ADR [0035](docs/decisions/0035-a-local-copy-of-what-igdb-said.md)) |
| 3 | Lists are `playing` / `backlog` / `finished`, but the docs promised Playing, Completed, On Hold, Dropped, Plan to Play and a Wishlist. | Docs corrected to match the code; the taxonomy expansion itself is Phase 2 |
| 4 | Google/Facebook auth is registered in `Program.cs` but has no challenge/callback endpoints and no UI — half-wired. | Open — blocked on OAuth app registration (D6) |
| 5 | `WeatherForecastController` template leftovers shipping as public API. | **Fixed** — deleted |
| 6 | IGDB credentials sitting in the tracked `appsettings.json`. | **Fixed** — moved to user secrets; `appsettings.json` documents the env-var names. **Rotation is still outstanding and only you can do it** |
| 7 | No `CancellationToken` plumbed through any controller or service. | **Fixed** — plumbed through controllers, services and every IGDB call |
| 8 | Zero tests. CI compiled but never ran lint or tests. | **Fixed** — 33 server unit tests; CI runs lint, typecheck, build, tests and CodeQL |
| 9 | The upcoming timeline was built on `first_release_date`, so a game already out on one platform never appeared when it reached another. | **Fixed** — rebuilt on the `release_dates` endpoint. Measured against live IGDB, ~6% of entries in a 30-day window were previously invisible |
| 10 | Crawlers saw an empty `<div id="root">`. | **Fixed** — SSR (D10) |
| 11 | ~~Two transitive packages carry known high-severity advisories: `Microsoft.OpenApi` 2.0.0 and `SQLitePCLRaw.lib.e_sqlite3` 2.1.11.~~ | **Fixed.** `SQLitePCLRaw` left the dependency graph entirely with the PostgreSQL swap, and `Microsoft.OpenApi` has moved to 2.7.5. `dotnet list package --vulnerable --include-transitive` now reports none |

---

## 2. Product features — what "complete and cool" needs

### Tier 1 — Core tracking (required for the product to make sense)

- ~~**Full list taxonomy**~~ **DONE for the five statuses.** Backlog, Playing, On Hold, Finished and Dropped ship as a seeded `ListStatuses` lookup carrying semantic flags, replacing the hardcoded `ValidListTypes` set. Keys are `backlog` / `finished` rather than "Plan to Play" / "Completed", which is what made the expansion a no-migration change. The separate **Wishlist** axis now ships too — its own table, its own endpoints, and a game can sit on it alongside any status (ADR [0022](docs/decisions/0022-entry-surrogate-key-and-the-wishlist-axis.md)). ~~Per-user renaming~~ **ships as well**, from `/user`: `UserListSettings` holds a label and nothing else, the five names must differ from one another, defaults included, and a rename is seen only by its owner — a public profile keeps the usual names (ADR [0031](docs/decisions/0031-a-list-rename-is-a-label-its-owner-sees.md)). See ADR [0018](docs/decisions/0018-append-only-status-event-log.md).
- ~~**Per-entry tracking data**~~ **DONE.** User score (ADR [0019](docs/decisions/0019-entry-survives-leaving-every-list.md)), and now start date, finish date, hours played, platform played on, replay count and per-run notes — all of which live on a **playthrough** rather than the entry, so a replay on a second platform is another row instead of an overwrite (ADR [0025](docs/decisions/0025-playthroughs-and-reviews.md)). Logged, edited and deleted from the game page's own panel. Ownership — owned, subscription or borrowed — and private notes on the game as a whole ship too, as columns on the entry: current state, never published, exported in full, and written under the same per-game lock as a score (ADR [0030](docs/decisions/0030-ownership-and-notes-belong-to-the-entry.md)). **Still open:** a lists-page filter or column for ownership, which needs the field on the list row.
- ~~**Completion states**~~ **DONE, as a type rather than a percentage.** A playthrough is Rushed, Normally or Completionist — the same three tiers IGDB reports, which is what lets the game page show our medians against their averages as two comparable rows. Deliberately not "percent complete": nobody keeps a percentage up to date, and a tier is answerable once, at the end. The type is optional, because a run in progress has no answer yet.
- ~~**Reviews**~~ **DONE, both halves.** One review per game, with a spoiler flag, an optional pointer to the playthrough it is about, and a public/private choice that was asked for at write time rather than defaulted later — a default is a consent decision. The reading half now ships on the author's public profile, where the two visibility settings compose and the narrower wins: a public review on a private profile is visible to nobody (ADR [0027](docs/decisions/0027-usernames-and-public-profiles.md)). ~~A per-*game* review list~~ **ships too**, on the game page behind the same two gates. It is fetched after hydration rather than server-rendered, so a withdrawn review is not held for a day in the game page's edge cache (ADR [0028](docs/decisions/0028-a-games-community-view.md)).
- ~~**Favourites**~~ **DONE.** Marked from the game page's panel with a rosette rather than a star, because stars are the user's score and nothing else ([0021](docs/decisions/0021-one-control-for-a-score.md)). An axis with the wishlist's shape — a timestamp, no events, no foreign key to the entry — and the wishlist's code: both write through `GameAxisStore` and both providers run on `useGameAxis`, so a guard added to one cannot miss the other. Shown at the top of `/user` and, when the profile is public, at the top of `/u/{name}`, server-rendered, where the wishlist shows only its size (ADR [0029](docs/decisions/0029-favourites-are-an-axis-and-a-showcase.md)). **Still open:** a marker on game cards, and a hand-arranged order.
- ~~**Activity history**~~ **DONE for status changes.** `UserGameEvents` records every transition append-only, including first adds and removals, and is the one thing in the schema that could not have been backfilled later (ADR [0018](docs/decisions/0018-append-only-status-event-log.md)). **Still open:** scores and playthroughs. The profile UI that reads the log shipped with ADR [0023](docs/decisions/0023-profile-statistics-derived-at-read-time.md).
- ~~**User profile stats**~~ **DONE.** `/api/user/stats` derives counts, score distribution, completion rate, a monthly started/finished/dropped chart, finish streaks and median *active* time to finish, all from our own tables at read time (ADR [0023](docs/decisions/0023-profile-statistics-derived-at-read-time.md)). Hours logged and a most-played-platform breakdown joined once playthroughs existed to count (ADR [0025](docs/decisions/0025-playthroughs-and-reviews.md)); "played" is a word the data now supports, but only on that row, so the older "most of your games are on" row stays as it is. Platform and genre breakdowns are still counted client-side from the lists already loaded, so an IGDB outage costs those rows rather than the page.
- ~~**Public profiles**~~ **DONE.** Identity's `UserName` is now the public handle rather than a copy of the email, with a reserved list, a rename cooldown and a deterministic backfill for the accounts that predate it. `/u/{username}` is server-rendered and shared-cacheable, and `ProfileVisibility` defaults to **private** for new accounts as well as old ones — publishing somebody's library is a consent decision. **Still open:** the `friends` value, which needs a follow graph and is one additive migration in each of two columns. See ADR [0027](docs/decisions/0027-usernames-and-public-profiles.md).
- **Account lifecycle** — ~~self-service account deletion with data export~~ **DONE.** `GET /api/user/export` returns everything the user has entered as one JSON document, and `DELETE /api/user` deletes the account and cascades to every user-owned table, confirmed by re-entering the password. A test walks the EF model and fails the build if a user-owned table is ever added without both a cascade and an export registration, in both directions (ADR [0024](docs/decisions/0024-the-ownership-contract.md)). The export is deliberately **free and IGDB-free** — portability is a right, not a feature. Both now have buttons on `/user`: a download, and a deletion behind a dialog that asks for the password and offers the download first. **Still open:** email confirmation, password reset and email change, all of which need an email sender that does not exist yet (`SignIn.RequireConfirmedAccount` is off).
- **Social login finished** — Google and Facebook challenge/callback endpoints, account linking, and buttons in `LoginDialog`.

### Tier 2 — Discovery and daily-use polish

- ~~**Real browse filters**~~ **DONE, less ESRB.** Platform, genre, release year and a critic-score floor, all in the URL and all applying to a search too, with four orders: Top rated, Popular, Newest and A to Z. Each order is one IGDB query with a floor of its own, checked against live IGDB — Popular ranks by the game's own rating count rather than a popularity primitive, because primitives cannot be filtered in the same query and type 3's top was stream-driven noise (ADR [0032](docs/decisions/0032-each-browse-order-carries-its-own-floor.md)). **Still open:** ESRB. The mapping it was waiting on now reads `age_ratings.organization` and `rating_category`, the fields IGDB actually returns, so the badges are back; the filter itself is not built.
- ~~**List views**~~ **Partly done.** Tiles and a condensed table view, switchable and remembered per account, with a sort order remembered per status list and a transient platform filter (ADR [0020](docs/decisions/0020-list-view-preferences-in-the-database.md)). Scores are settable inline in the table. **Still open:** multi-select bulk actions (move, remove, tag) and drag-to-reorder for a manual backlog priority.
- **Search everywhere** — a global search in the navbar with typeahead, not just on `/games`.
- **Game page depth** — *mostly done*: screenshot gallery, embedded trailer, similar games, franchise/series grouping, DLC and expansions, completion times, how-to-play modes and language support all ship (ADR [0017](docs/decisions/0017-detail-data-off-the-listing.md)). Still open: "where to play" store links.
- **Community signal** — *partly done*. **Community completion times ship**: a median per tier, each carrying the number of playthroughs behind it, behind a display floor, beside IGDB's own figures on the game page — which is what the playthrough types were made to mirror IGDB's tiers for (ADR [0025](docs/decisions/0025-playthroughs-and-reviews.md)). **Review text with spoiler tags ships too, but only the writing half**: a review is stored with a spoiler flag and a public/private choice its author actually made, and nothing reads it but them. **The profile half of the reading now ships too** (ADR [0027](docs/decisions/0027-usernames-and-public-profiles.md)): a public profile lists its owner's public reviews, with the spoiler flag honoured. **So does the game half** (ADR [0028](docs/decisions/0028-a-games-community-view.md)). The game page carries a member score out of 100 with its count beside IGDB's two, and the distribution of every member's score, both behind a floor of five scores. It also lists the reviews members have published. The scores count every member, because an aggregate names nobody; the reviews list only those public on a public profile. **Still open:** helpful-votes, which need a `ReviewVotes` table.
- **Release notifications** — email or in-app alerts when a wishlist game gets a date or launches. The upcoming timeline already computes this data.
- **Recommendations** — "because you finished X" using IGDB genre/theme similarity; a "what should I play next" backlog picker.
- **Import from Steam / PSN / Xbox / GOG** — the single biggest reason people abandon a new tracker is retyping 300 games. **Scoped down, and no longer an early bet** (ADR [0026](docs/decisions/0026-a-library-import-records-ownership-not-history.md)): Steam exposes playtime and a last-played timestamp and nothing else, which separates "never launched" from "played at some point" and cannot distinguish Finished from Dropped from On Hold — and that ambiguous bucket is most of a real library. So an import records *ownership*: unplayed games land in Backlog, played ones become status-less entries ([0019](docs/decisions/0019-entry-survives-leaving-every-list.md)), the Steam wishlist maps one-to-one, and **no `UserGameEvents` rows are written at all**, because `AppendEvent` stamps import time and a guessed transition would be permanent fabricated history. An `Origin` column on the entry makes that exemption from [0018](docs/decisions/0018-append-only-status-event-log.md) explicit rather than implied by a missing row. The IGDB↔Steam AppID mapping from N1 is reusable with its `where` clause inverted, but cheap plumbing was never the reason to build this — read 0026 before starting, and note it needs a Steam Web API key, the project's first.
- **Export** — CSV and a re-importable shape, plus column selection and scheduled or emailed exports. The **JSON download already ships and is free**: `GET /api/user/export` is data portability and cannot sit behind a subscription, so what is left to sell here is a nicer *format* over the same data, not access to it. See ADR [0024](docs/decisions/0024-the-ownership-contract.md) before gating anything export-shaped.
- **Empty and error states that teach** — the lists page already has good ones; extend the pattern to games and profile.
- ~~**Responsive navigation**~~ **DONE.** Below `md` the nav links move behind a menu button at the start of the bar, and below `sm` the logo stands without its wordmark, so the bar fits from 360px up. The three pages this entry once said overflowed a 390px phone on their own content no longer do: the home page's news grid and the lists page's tab row and table were fixed with the template-CSS cleanup, and the profile's monthly chart when `/user` moved onto the site's layout. Measured signed out on every route, `/news` included, at 390, 360 and 320px: none is wider than the screen.
- **Anonymous theme** — theme only persists server-side, so signed-out users are locked to dark and get a flash on load. Store it in `localStorage` and reconcile on login.
- **Skeleton loaders** instead of spinners, plus `srcset` and lazy loading for cover art.

### Tier 3 — Community and stickiness

- Follow other users, an activity feed, and a "compare lists with" view
- Custom user-made lists ("Best co-op games") that are shareable and likeable
- Tags on entries, and filtering by tag
- Yearly wrapped / recap page
- Achievements or badges for milestones
- Public API, and a "share card" image for social posts
- PWA with offline read of your own lists

### Price tracking & deals — IsThereAnyDeal integration

ITAD covers 50+ stores with price history, bundles and giveaways. Their API terms require that URLs be
passed through unmodified — the affiliate tags in them are ITAD's, and we keep none of that revenue.
That is an accepted trade: the feature is worth more to users than the commission would be to us, and it
costs nothing to run.

| ID | Item | Notes |
|---|---|---|
| P1 | Register an ITAD app, obtain an API key | Store in Secrets Manager (§5), never in `appsettings.json` |
| P2 | Map IGDB game → ITAD game via Steam AppID | Reuse the `external_games` mapping from N1; matching by AppID is far more reliable than by title |
| P3 | **"Where to buy" panel on the game page** — current best price, store, discount % | Pass ITAD URLs through verbatim, tags intact |
| P4 | **All-time low** alongside current price | "Historical low $12, currently $30" is the strongest buying signal ITAD offers |
| P5 | **Wishlist price-drop alerts** | The flagship feature. Background job diffs current prices against user thresholds |
| P6 | Per-user price threshold and region/currency preference | ITAD is region-aware; a EUR user should not see USD prices |
| P7 | **Deals rail / `/deals` page** filtered to the user's wishlist and backlog | Generic deal feeds are noise; deals on *your* games are not |
| P8 | **Bundle and giveaway alerts** | "A game in your backlog is free on Epic this week" is the most delightful notification the product can send |
| P9 | Background refresh into cache; never call ITAD on the request path | Same discipline as IGDB — respect their rate limits |
| P10 | Attribution: link back to IsThereAnyDeal, do not imply affiliation, never alter prices or strip tags | Required by their terms |
| P11 | Degrade cleanly for console-only titles | ITAD is PC-centric; a Switch exclusive will have no store coverage. Hide the panel, do not show an error |

---

## 3. Home page

The home page used to render the same thing for everyone: a full-viewport marketing hero, three
static feature cards, then the upcoming timeline. A signed-in returning user scrolled past two screens
of pitch to reach the one useful element. The hero is now compact and the feature cards are gone,
replaced by real trending covers and a live news rail (3.2, 3.4). **One route, two pages** — the
page now forks on auth state, so a returning user lands on their own data rather than the pitch
(ADR [0027](docs/decisions/0027-usernames-and-public-profiles.md)). One caveat, recorded there: the
page is shared-cached and the server render has no cookie, so the signed-in half only appears after
hydration. D12 is what fixes that.

### 3.1 Signed-in dashboard

| ID | Item | Notes |
|---|---|---|
| ~~H1~~ | ~~Fork `HomePage.tsx` on `user` — dashboard when signed in, landing when not~~ **DONE** | `SignedInHero` above the shared rails, which are the same for both branches rather than duplicated. Everything below hung off this |
| ~~H2~~ | ~~Drop or rewrite the "Rate" feature card~~ **DONE** | All three feature cards removed with the home page redesign |
| ~~H3~~ | ~~**Continue Playing rail** — horizontal scroll of the `playing` list with "mark finished"~~ **DONE** | Reads `ListsProvider`; no new API, as predicted. Sorted by *recently moved* rather than *recently added* — those differ for exactly the game the rail exists for. **"Log progress" was deliberately left out**: a seven-field form behind a cover is a worse version of the game page |
| ~~H4~~ | ~~**Your week** — releases from the user's Wishlist/Backlog surfaced *above* the general timeline~~ **DONE, as "Releasing soon"** | A rail in the signed-in hero, crossing the calendar's own response with the two providers — no new API, and nothing per-user in `/api/home` (3.5). It covers the calendar's whole 30-day window rather than a week, because a week of one person's lists is often empty; each game's date says how close it is. Hidden platforms apply as they do to the calendar, so a release only on a hidden platform is passed over for a later one the user can see. The calendar and the rail share one fetch |
| ~~H5~~ | ~~**Play next picker** — one random backlog game, with a reroll button~~ **DONE** | Reads `ListsProvider`, like H3. A fresh pick each visit, and a reroll never lands on the game already showing. **"Start playing"** goes through the provider, so it records the event, and the started game then leads the Continue Playing rail above it |
| ~~H6~~ | ~~**Stats strip** — finished this year, hours logged, current streak~~ **DONE** | All three from `/api/user/stats`, which ADR [0025](docs/decisions/0025-playthroughs-and-reviews.md) gave hours to. Silent on failure and on an empty account: it sits above a page that works fine without it |
| ~~H7~~ | ~~**Trending rail** via IGDB `popularity_primitives`~~ **DONE** | Uses `popularity_type` 5 ("24hr Peak Players", Steam-sourced), cached hourly. See ADR [0012](docs/decisions/0012-steam-news-without-a-database.md) for why that type and not the IGDB-native ones |
| H8 | **Events banner** via IGDB `events` | Showcases and conferences with start/end times and stream links. "Summer Game Fest starts in 2 days" — genuinely differentiated |
| H9 | **News for your games rail** | See 3.4 |

### 3.2 Signed-out landing — MOSTLY DONE

- ~~Keep the hero, but replace the three abstract icon cards with **live proof**: real trending covers and the real calendar.~~ Done. The hero is now compact with a spotlight game's artwork behind it, followed by a trending cover rail, a news rail and the calendar.
- **Still open:** a "sign up to track this" CTA on each rail.

### 3.3 Fix the calendar's accuracy — DONE

- ~~`GetUpcomingReleasesAsync` keys off `first_release_date`~~ Rebuilt on the IGDB `release_dates` endpoint, which is per-platform and per-region. Entries are now keyed on (game, date) and carry only the platforms releasing on that date.
- ~~Extend past the hardcoded 14 days~~ Window widened to 30 days. **Still open:** a month/grid view rather than the single scrolling column.
- ~~Bound the unbounded `while (true)` paging loop~~ Capped at 10 pages, with a warning logged when the ceiling is hit.

### 3.4 Steam news

Per-game news beats a generic industry feed, because it attaches to games the user actually tracks —
"Cyberpunk 2077 shipped patch 2.3" on a card sitting in their Playing list.

| ID | Item | Notes |
|---|---|---|
| ~~N1~~ | ~~Map IGDB game → Steam AppID via `external_games`~~ **DONE** | **Filter on `external_game_source = 1`, not `category = 1`.** IGDB removed `category`; the old filter matches zero rows silently rather than erroring. Cached in memory for 24h — *not* on a table, see ADR [0012](docs/decisions/0012-steam-news-without-a-database.md) |
| ~~N2~~ | ~~Fetch via Steam `ISteamNews/GetNewsForApp`~~ **DONE** | Public, no API key required |
| N3 | Background refresh job writing to cache | **Still open.** Currently a cache-on-miss, so the first request after expiry pays the Steam round trip. Belongs with the distributed cache in §5 — a per-instance background job would duplicate work across ECS tasks |
| ~~N4~~ | ~~Surface on the **game page** as a "Latest news / patch notes" panel~~ **DONE** | `GameNewsPanel`, fetched client-side so a third party never blocks the game page's server render |
| ~~N5~~ | ~~Surface as a **home page rail**~~ **DONE** | Server-rendered via `/api/home`. Capped at 2 items per game, or one game mid-tournament fills the rail |
| ~~N6~~ | ~~Dedicated **`/news` page** aggregating across everything the user tracks~~ **DONE** | `GET /api/user/news` over `GetLatestNewsAsync`, which already took any set of games — so no new plumbing, as predicted. **The order the games are handed over is the feature**, because the aggregate follows at most 12 Steam-backed games and keeps the first it is given: in progress (Playing, then On Hold), the wishlist, the backlog, then Finished and Dropped, most recently moved first within each, read from the status flags rather than keys. At most 50 of the user's games are resolved to AppIDs, 20 items shown, 3 per game. Under `/api/user` rather than `/api/news` and `no-store`, because the answer differs per account. Linked from the navbar and from the home page's news rail once signed in |
| ~~N7~~ | ~~Degrade gracefully for games with no Steam presence~~ **DONE** | Console exclusives return 200 with an empty list and the panel hides itself. Verified against Zelda: Tears of the Kingdom |

**Not available:** IGDB has no news endpoint. v3 had `pulse` / `pulse_groups` / `pulse_sources`; v4 removed
them along with other endpoints IGDB judged below their quality bar, and they have not returned.

Optional later: RSS aggregation from outlets (Eurogamer, RPS, Push Square, Nintendo Life) for a generic
industry feed. Link out with headline, thumbnail and source only — never reproduce article bodies. Do not
try to fuzzy-match RSS headlines to game titles; it produces false positives. Let Steam handle per-game.

### 3.5 Serve it as one endpoint — DONE

~~Every item above adds an IGDB or Steam call to the highest-traffic page. Compose and cache server-side as a
single `/api/home` response rather than five parallel client fetches.~~ Built: `/api/home` returns the
spotlight, the trending rail and the news rail in one payload, cached for 15 minutes (1 minute when
degraded). Measured cold 3.7s / warm 16ms.

Deliberately carries nothing user-specific so the whole response is cacheable once for every visitor. The
upcoming timeline stays a separate client fetch because it is filtered by the viewer's hidden platforms.
That split is what the distributed cache in §5 will need: `/api/home` is the shared entry, and per-user
content must stay out of it.

---

## 4. Monetization

### 4.1 The model

Ad-supported free tier, plus a paid tier that removes ads and unlocks depth. Roughly **$3/month or
$25–30/year**. No affiliate revenue — outbound store links go out with ITAD's tags intact (see §2).

Benchmark: Trakt, the closest analogue in the tracking space, runs **entirely** on VIP subscriptions and
recently moved from $30 to $60/year. A few hundred paying users is a more realistic business than a lot of
outbound clicks.

**The one rule:** the core tracking loop stays unlimited and free — unlimited games, all lists, wishlist,
calendar. Capping the core loop is what kills trackers. Sell depth, convenience and quiet, not access.

### 4.2 Free vs Paid

| | Free | Paid |
|---|---|---|
| Games tracked, all lists, wishlist | Unlimited | Unlimited |
| Upcoming calendar | ✅ | ✅ |
| Game pages, browse, search | ✅ | ✅ |
| **Ads** | Shown | **Removed** |
| Custom lists | Up to 3 | Unlimited |
| Profile stats | Basic counts | Full charts, score distribution, trends over time |
| Yearly wrapped / recap | — | ✅ |
| Price-drop alerts | 5 tracked games | Unlimited |
| Price history | Current + best price | Full history charts and all-time low |
| Bundle & giveaway alerts | — | ✅ |
| Import from Steam/PSN/Xbox | One-time | Unlimited re-sync |
| Export | **JSON, free** — portability is a right ([0024](docs/decisions/0024-the-ownership-contract.md)) | CSV, re-importable, column selection, scheduled |
| Release notifications | In-app | In-app + email |
| Private profile | — | ✅ |
| Early access to new features | — | ✅ |
| Supporter badge on profile | — | ✅ |

The strongest paid hooks are the ones with real recurring cost behind them — price alerts, bundle alerts
and import re-sync all run background jobs per user, so the pricing is honest rather than artificial.

### 4.3 Ads — placement discipline

| ID | Item |
|---|---|
| A1 | Ads render for signed-out and free users only — never for paid, including on cached responses |
| A2 | Cache key must include entitlement, or render ad slots client-side only, so a paid user never gets an edge-cached page with ads baked in |
| A3 | Reserve slot height to avoid layout shift; lazy-load below the fold. Ads are the fastest way to wreck LCP and CLS, which matters for the SEO that public profiles and game pages are meant to earn |
| A4 | Never inside the Continue Playing rail, never interstitial, never above the fold on a game page |
| A5 | When consent is refused, fall back to a house ad for the paid tier rather than a blank slot |
| A6 | Single provider to start — more providers means more scripts, more consent surface and worse performance |

### 4.4 Plumbing

| ID | Item |
|---|---|
| M1 | Stripe Billing — Checkout for signup, Customer Portal for self-service management |
| M2 | Webhook handler for subscription lifecycle; entitlement persisted on a `Subscriptions` table, not inferred from Stripe on each request |
| M3 | Gate features with an ASP.NET authorization policy (`[Authorize(Policy = "Pro")]`) so entitlement checks are declarative rather than scattered conditionals |
| M4 | Dunning and grace period on failed payment. **Never delete data on lapse** — downgrade to free and keep everything intact |
| M5 | Stripe Tax for EU VAT and US sales tax — mandatory for digital sales into the EU |
| M6 | "Manage subscription" section on `UserPage` deep-linking to the Customer Portal |
| M7 | Free-tier limits behind feature flags so they can be tuned without a deploy |
| M8 | Legal pages: privacy policy, terms, cookie/ads disclosure, plus required attribution for both IGDB and IsThereAnyDeal |
| M9 | Cookie consent banner (GDPR) covering ad and analytics cookies, wired to A5 |

### 4.5 Do not repeat Trakt's mistake

Trakt took sustained backlash for retroactively repricing legacy subscribers and tightening free-tier
limits after the fact. Set the free-tier limits in §4.2 **before** launch, and if pricing ever has to
change, grandfather existing subscribers rather than repricing them.

---

## 5. Platform features — what production readiness needs

### Data & state

> The schema this roadmap implies, cross-cut by table rather than by feature, with a sequencing
> order and the two ways a data model quietly goes wrong: [`docs/data-model-plan.md`](docs/data-model-plan.md).


- ~~**Move off SQLite to PostgreSQL.**~~ **Done locally; hosting still pending.** The app now runs on PostgreSQL, with `compose.yaml` providing the database for development, migrations regenerated and verified from an empty database, and migrations gated to Development so deployed instances cannot race. A file database on an ephemeral container filesystem loses every user on redeploy and cannot be shared between instances. **Remaining — provision: RDS for PostgreSQL, `db.t4g.micro`, Single-AZ, inside the VPC** — Aurora Serverless v2 costs roughly 4× as much at this load and its scale-to-zero does not apply to an always-on task holding a connection pool (ADR [0014](docs/decisions/0014-rds-postgresql-over-aurora.md)). The provider swap is contained to `Program.cs` plus a regenerated migration set. Local development moves to PostgreSQL in Docker at the same time, so local and production stop diverging.
- **Stop migrating on startup.** `db.Database.Migrate()` in `Program.cs` races when more than one task boots at once. Run migrations as a discrete pipeline step (a one-off ECS task, or a `dotnet ef bundle` executable) before the new revision takes traffic.
- **Persist Data Protection keys.** Identity cookies are encrypted with keys that currently live on the local filesystem, so every deploy or scale-out silently signs everyone out. Persist to S3 or DynamoDB with a KMS-backed key. This is the classic ASP.NET-on-AWS gotcha and it must be fixed before the first multi-task deploy.
- **Distributed cache.** `AddMemoryCache` means each instance fetches its own IGDB token and duplicates every query. Move to Redis (ElastiCache Serverless) behind `IDistributedCache`.
- ~~**Local game-metadata cache table.**~~ **DONE, less the job.** `CachedGames` persists the mapped `GameDto` per IGDB id, and the lists, wishlist, favourites and public profiles read it rather than IGDB. **Still open:** the background refresh — today a row is refreshed by whoever loads a page after it turns a day old, which the `RefreshedAt` index already supports ordering. Browse and search stay live by design: they are queries over the whole catalogue, not lookups of tracked ids (ADR [0035](docs/decisions/0035-a-local-copy-of-what-igdb-said.md)).

### Resilience & correctness

> The whole of this section landed together, and the reasoning is in two records: what the API
> refuses ([0033](docs/decisions/0033-what-the-api-refuses.md)) and how it fails
> ([0034](docs/decisions/0034-failing-in-one-shape.md)). What is left of it is listed at the end.

- ~~**Retry + circuit breaker on the IGDB client**~~ **DONE.** `Microsoft.Extensions.Http.Resilience`, on the named `Igdb` client: two quick retries, a breaker that stops asking for fifteen seconds once half a sample fails, and a ten-second per-attempt timeout in place of the client's hundred-second default.
- ~~**Respect IGDB rate limits**~~ **DONE.** Four a second in quarter-second segments, queueing rather than failing, outermost in the pipeline so the wait is not charged to an attempt's timeout. **Per process**, so a second instance doubles what IGDB sees — the shared limit belongs with the distributed cache above.
- **Request rate limiting** — *partly done, deliberately.* Ten attempts per address per five minutes on login and register, which are the only endpoints browsers call directly and nothing else does. **Not the whole API:** the front end renders on a server of its own, so a limit partitioned by address would put every visitor's server render in one bucket and throttle the site as a single client. The rest belongs at the edge, with the CDN and a WAF.
- ~~**Enable Identity lockout**~~ **DONE.** Five failures, fifteen minutes. A lockout answers exactly as a wrong password does — announcing it would make five deliberate failures a way to ask whether an address has an account here. The limiter above is the half that may speak, because it knows nothing about who is registered.
- ~~**CSRF protection**~~ **DONE**, as the header check rather than the token. Every write must carry `X-MVGL-Request`, which a cross-site form cannot add and cross-site script cannot get past a preflight this API does not answer. **Adding a permissive CORS policy would undo it** (0033). On the client every write goes through `apiFetch`.
- ~~**Forwarded headers middleware**~~ **DONE**, opt-in and fail-fast: enabling it without naming the proxy throws at startup rather than trusting whoever sends the header. `ForwardLimit` is configuration because the right value is a fact about the topology — one balancer is 1, a CDN in front of it is 2.
- ~~**HSTS and security headers**~~ **DONE, less one directive.** Two sets, because two processes serve different things: `default-src 'none'` for JSON, a document set applied in `entry.server.tsx` so that thrown Responses carry it too. HSTS is a year with subdomains, no preload. **Still open:** a policy naming `script-src`, which needs a per-request nonce for React Router's inline hydration script.
- ~~**Global exception handling with ProblemDetails**~~ **DONE.** One shape everywhere with a `traceId`, the exception itself in Development only, somebody else's outage as a 502 rather than a 500, and a reader who navigated away as a silent 499 rather than a 5xx alarm.
- ~~**`CancellationToken` through controllers → services → HttpClient.**~~ **DONE** in Phase 0.

### Observability

- Health endpoints: `/healthz` (liveness) and `/readyz` (DB + IGDB reachability) — required for an ALB target group and ECS health checks
- Structured logging with correlation IDs, shipped to CloudWatch Logs
- OpenTelemetry traces and metrics (ADOT collector → X-Ray / CloudWatch)
- Alarms on 5xx rate, p99 latency, ECS task restarts, RDS connections, IGDB failure rate
- A `/version` endpoint reporting the deployed git SHA

### Quality gates

- **Unit tests** for `ListService`, the `IgdbService` DTO mapping, and the Apicalypse query builder
- **Integration tests** with `WebApplicationFactory` + Testcontainers PostgreSQL, covering auth and list flows
- ~~**Frontend tests**~~ **Started.** Vitest with jsdom and Testing Library, 107 tests over the list views: the sort comparators, the table, the toolbar and platform filter, the per-game user panel, and `ListsProvider`'s optimistic updates and rollback. Runs in CI before the build. **Still open:** coverage for the rest of the client — the browse page, the game page, auth flows.
- **E2E smoke** — Playwright: sign up, add a game to a list, reload, still there
- **CI must run** `npm run lint`, `dotnet test`, `dotnet format --verify-no-changes`, and build on pushes to `master` — not only on PRs
- **Security scanning** — CodeQL, `dotnet list package --vulnerable`, `npm audit`, and a secret scanner (Dependabot is already active)
- Branch protection requiring green CI before merge

---

## 6. AWS deployment

### Recommended architecture

```
Route 53 → CloudFront ─┬─ /assets/*  → S3 (hashed SPA bundles, long-lived cache)
                       └─ /*, /api/* → ALB → ECS Fargate service (ASP.NET Core container)
                                                   │
                                   ┌───────────────┼────────────────┐
                                   ▼               ▼                ▼
                        RDS for PostgreSQL     ElastiCache      Secrets Manager
                            PostgreSQL       Serverless Redis   (IGDB, OAuth, DB)
                                                   │
                                       S3/DynamoDB + KMS (Data Protection keys)
```

**Why this shape:** ECS Fargate handles the two-process split from ADR 0003 naturally, gives zero-downtime rolling or blue/green deploys, and scales horizontally once the state issues in §5 are fixed. RDS for PostgreSQL is predictable and cheap at this load; Aurora is a later step, reachable by restoring an RDS snapshot (ADR [0014](docs/decisions/0014-rds-postgresql-over-aurora.md)).

**Cheaper starting point:** ~~AWS App Runner + RDS PostgreSQL~~ — **withdrawn, App Runner is in maintenance mode.** The cost lever instead is topology: run the Fargate tasks in public subnets with public IPs and skip the NAT Gateway, which is otherwise the largest line on the bill at ~$32/month per AZ. The database stays private. See ADR [0015](docs/decisions/0015-fargate-confirmed-and-nat-less-networking.md).

**Baseline at that shape:** roughly **$40/month** idle — RDS 12, storage 2, ALB 17, one Fargate task 9, hosted zone 0.50, NAT 0. New AWS accounts get **$100 in credits plus up to $100 more** for five onboarding tasks, on a Free plan lasting **six months or until the credits run out** — the old 12-month free tier no longer applies to new accounts. That is about five months of runway at ~$40; the Aurora-plus-NAT shape would have consumed it in about two.

**Not recommended here:** Lambda + API Gateway. Cookie auth, Data Protection key management, and the IGDB token cache all fight the model, and cold starts hurt an interactive SPA backend.

### Deployment features to build

- **Multi-stage Dockerfile** — `node:22` builds the SPA, `dotnet/sdk:10` publishes the API, `dotnet/aspnet:10` runs it. Non-root user, no SDK in the final layer.
- **Infrastructure as code** — AWS CDK (in C#, so the repo stays one language) covering VPC, ECS, ALB, RDS, ElastiCache, CloudFront, IAM, and alarms. Nothing created by hand in the console.
- **GitHub Actions OIDC** — the deploy role is assumed via OIDC. No long-lived AWS keys in repository secrets.
- **Environments** — `dev` and `prod` accounts (or at minimum separate stacks), with prod gated behind a GitHub environment approval.
- **Pipeline shape on merge to `master`:** test → build image → push to ECR tagged with the git SHA → run the migration task → deploy the new ECS revision → wait for target-group health → smoke-test → auto-rollback on alarm.
- **Immutable, SHA-tagged images.** Never deploy `:latest`.
- **Migration safety** — expand/contract only, so an old and a new revision can run against the same schema during a rollout.
- **Configuration via environment** — everything environment-specific currently in `appsettings.json` comes from SSM Parameter Store or Secrets Manager, injected as ECS task secrets. Rotate the IGDB credentials sitting in the working tree now.
- **Cost controls** — a budget alarm **first** (it is also one of the five credit-earning onboarding tasks), Fargate Spot for dev, stopping the RDS instance when idle (up to 7 days before it auto-starts), and CloudWatch log retention limits.

### Domain, email and SEO

The project owns **myvideogamelist.net**, which pins down several items that would otherwise be open questions.

| ID | Item | Notes |
|---|---|---|
| D0 | **Manual, before anything: MFA on the root account, then stop using it; create an admin via IAM Identity Center; set a budget alarm; install Docker Desktop and the AWS CLI; `cdk bootstrap`** | Docker alone unblocks the whole PostgreSQL migration — none of the AWS items block it |
| D1 | Route 53 hosted zone for `myvideogamelist.net`, managed in CDK | Apex + `www`, with `www` redirecting to apex (or the reverse — pick one and be consistent) |
| D2 | ACM certificate **in `us-east-1`** | CloudFront only accepts certificates from `us-east-1` regardless of where the rest of the stack lives. Easy to get wrong once and then be stuck |
| D3 | `dev.myvideogamelist.net` for the dev environment, with ~~`noindex`~~ and basic auth | Never let a staging environment get indexed alongside production. **The `noindex` half is done, and in the application rather than the CDN**: a deployment is indexable only with `SITE_URL` set *and* `SITE_INDEXABLE=true`, and any other sends `X-Robots-Tag: noindex, nofollow` on every response — deliberately *without* a `Disallow`, because a crawler refused by robots.txt never sees a `noindex` (ADR [0036](docs/decisions/0036-what-a-crawler-is-told.md)). **Still open:** basic auth, which belongs to the CDN |
| D4 | **SES for transactional email** on a verified domain, with SPF, DKIM and DMARC records | Password reset, email confirmation, price alerts and release notifications all depend on this |
| D5 | **Request SES production access early** | New SES accounts are sandboxed and can only send to verified addresses. The review takes time — do not discover this the week you launch email confirmation |
| D6 | Configure the OAuth redirect URIs for Google and Facebook against the real domain | Currently blocked on the half-wired social login from §1 |
| D7 | Set the Identity cookie domain explicitly | Matters once `www` and apex both resolve, and for any future subdomain |
| ~~D8~~ | ~~`robots.txt`, `sitemap.xml` (game pages + public profiles), canonical URLs~~ **DONE** | All three are served by the front-end server, since the API serves `/api/*` only. The sitemap is an index over files built from **our own tables** — every `CachedGames` row that is not a tombstone, and every public profile with something on it — so it makes no IGDB call and lists the pages that have something of ours on them rather than IGDB's whole catalogue. Canonical URLs are built from the data, never the request: `/games/0012` says it is `/games/12`, and `/u/ALICE` says it is `/u/alice`. The per-user pages and `/api/` are kept out by `noindex`, not `Disallow` (ADR [0036](docs/decisions/0036-what-a-crawler-is-told.md)). **Still open:** registering the site with a search console, which is a DNS record and belongs with D1 |
| D9 | Open Graph and Twitter Card tags on game pages, profiles and shared lists | **Done for every page that exists**, through one `pageMeta` so no page states half the set. It also fixed two things that were wrong: the game page's `og:type` was `video.game`, which is not a type, and it asked for the large card with a portrait cover — it now shares key art where IGDB has any (0036). **Still open:** a default share image, so the home page, the catalogue and profiles unfurl without one — it needs a designed raster image; and shared lists, which do not exist yet. Also powers the Tier 3 "share card" feature |
| ~~D10~~ | ~~Server-side rendering or prerendering for game pages~~ **DONE** | Framework-mode SSR (ADR [0002](docs/decisions/0002-server-side-rendering.md)). `/`, `/games` and `/games/:id` all server-render real content; `/lists` and `/user` stay client-side by design |
| D11 | Email deliverability monitoring — bounce and complaint handling via SNS | SES will throttle or suspend on high bounce rates |
| D12 | **CloudFront cache behaviours matching the per-route `Cache-Control`** | The origin now states a policy per route (ADR [0013](docs/decisions/0013-http-caching-policy.md)). Three things the CDN config must get right: **include `search`, `sort`, `platform`, `genre`, `year` and `minScore` in the cache key for `/games` (ADR [0032](docs/decisions/0032-each-browse-order-carries-its-own-floor.md)) and `page` in the cache key for `/u/*`**, and give `/lists` and `/user` a behaviour that forwards the auth cookie and caches nothing |
| D13 | Write the behaviours against React Router **v8** `.data` URL formats | Trailing-slash routes request `/path/_.data` and the root is `/_.data`, not `/_root.data` (ADR [0011](docs/decisions/0011-react-router-8-upgrade.md)) |
| D14 | **CloudFront invalidation when a profile is withdrawn** — switched back to private, renamed, or deleted, or a review on it made private, edited or deleted | `CACHE_PROFILE` is five minutes fresh plus an hour of `stale-while-revalidate`, so the edge keeps serving a withdrawn page for five minutes and can hand one stale copy per edge to whoever asks first for up to an hour after that (ADR [0027](docs/decisions/0027-usernames-and-public-profiles.md)). The fourth event is there because the page renders review bodies: withdrawn or edited text sits in the cached HTML and its `.data` URL for that same window. Invalidate `/u/{name}` and its `.data` URL (D13) from the API on all four events — the old name as well, on a rename — **and `/sitemaps/profiles-*.xml` on the first three, which change what that file lists**: it names every public profile, and is held for the same window so that it cannot outlast the page it lists (ADR [0036](docs/decisions/0036-what-a-crawler-is-told.md)). Needs the distribution id in configuration and `cloudfront:CreateInvalidation` on the task role. Consent withdrawn should take effect when it is withdrawn, not when a TTL runs out. **Game pages are deliberately not on the list:** they never carry review text, because member reviews are fetched after hydration from endpoints that send `no-store` (ADR [0028](docs/decisions/0028-a-games-community-view.md)). Keep it that way, or this row grows to every game page an author has reviewed |

---

## 7. Suggested sequencing

> **Next up, after the game's community view landed ([0028](docs/decisions/0028-a-games-community-view.md)).**
> That closed the cluster [0027](docs/decisions/0027-usernames-and-public-profiles.md) opened.
> [0016](docs/decisions/0016-scores-carry-their-sample-size.md)'s score histogram and the game-page
> review list were the same missing thing viewed twice — everybody's rows for one game — and both now
> read through one new index on the entry, which the community completion times had been doing without.
> What is left of the community signal is helpful-votes, which need a `ReviewVotes` table.
>
> **One question 0028 leaves open on purpose.** The two community endpoints report small samples
> faithfully, as 0016 asks, so a game scored by one member exposes that score, unattributed, to
> anyone who reads the JSON. The display floor hides it on the page but is not a privacy boundary.
> Community completion times have always worked the same way. A server-side floor on both endpoints
> would make it one, and would be a deliberate exception to 0016 rather than a fix.
>
> **The finished APIs that were waiting for a screen now have one.** `/user` downloads the export
> and deletes the account behind a password dialog; the signed-in home page has H5's play-next picker
> and H4's releasing-soon rail; and N6's `/news` page reads a thin `/api/user/news` over
> `GetLatestNewsAsync`. None of them needed a migration. One follow-up they surfaced: the aggregate
> over-fetches `count × 3` items from every feed even when a per-game cap means it keeps three, which
> `/news` makes the most expensive caller of — asking for `maxPerGame × 3` would be enough.
>
> **Three smaller things 0027 left behind still stand.** The `friends` visibility value needs a
> follow graph and is one additive migration in each of two columns — and it would be the first thing
> to make the community reviews vary by reader. A returning user still sees the landing hero for one
> request, because the home page is shared-cached and the server render has no cookie — D12 is what
> fixes that, not the home page. And a profile switched back to private, renamed or deleted stays at
> the edge until its TTL runs out, because nothing invalidates it — D14 closes that, and until it
> ships the window is the one 0027 records.

**Phase 0 — Clean the foundation — DONE**
IGDB credentials moved to user secrets (rotation still outstanding, and only you can do it); WeatherForecast template and the dead `Developers`/`Publishers` controllers deleted; seed data dropped via migration; `CancellationToken` plumbed through every controller and service; `/healthz` and `/readyz` added; the unbounded IGDB paging loop bounded; the calendar rebuilt on `release_dates` (3.3); 33 server unit tests added; CI extended with lint, typecheck, tests and CodeQL on both PRs and pushes.

**D10 — SSR — DONE (pulled forward from Phase 5)**
Migrated the client to React Router framework mode with SSR (now on v8, see [ADR 0011](docs/decisions/0011-react-router-8-upgrade.md)). Game pages now server-render real content plus `title`, `description` and Open Graph tags; 404s return a genuine 404 status. This unblocks D8 and D9, which were previously pointless. Remaining: only the game route has a loader — `GamesPage`, `ListsPage` and `UserPage` still fetch client-side, which is fine for the authenticated pages but should change for anything meant to be indexed.

**Phase 1 — Make it deployable (1–2 weeks)**
SSR makes this a **two-process** deployment; the container and CDK work in §6 must account for both, plus the layer that routes between them. See [ADR 0003](docs/decisions/0003-two-process-deployment.md) and [ADR 0007](docs/decisions/0007-aws-target-architecture.md).

PostgreSQL swap (done locally); ~~forwarded headers, HSTS, CSRF, lockout~~ (done — [0033](docs/decisions/0033-what-the-api-refuses.md), [0034](docs/decisions/0034-failing-in-one-shape.md)); Data Protection keys to S3; migrations out of startup; distributed cache; Dockerfile; CDK stack; GitHub Actions OIDC deploy to a dev environment.

What the hardening pass left for the deployment itself: turning `ForwardedHeaders` on and naming the balancer's subnet, forwarding `X-MVGL-Request` through CloudFront on any behaviour that carries a write, and revisiting `ForwardLimit` once the CDN is in front of the balancer. The SEO pass ([0036](docs/decisions/0036-what-a-crawler-is-told.md)) adds two variables on the front-end server: `SITE_URL` in every environment, and `SITE_INDEXABLE=true` in production **only** — anything else is served `noindex`, so forgetting it costs production its indexing rather than costing dev its privacy.

**Phase 2 — Make it a real tracker (2–4 weeks)**
Per-entry scores, dates, hours and notes; full list taxonomy plus Wishlist; profile stats; ~~usernames and public profiles~~ (done — ADR [0027](docs/decisions/0027-usernames-and-public-profiles.md)); email confirmation and password reset; local game-metadata cache table. (It is no longer a prerequisite for the Steam AppID mapping in N1, which shipped against an in-memory cache instead — see ADR [0012](docs/decisions/0012-steam-news-without-a-database.md).)

**Phase 3 — Make the home page earn its place (1–2 weeks)**
H1, H3, H5 and H6 are in — the page forks on auth, Continue Playing and the play-next picker read `ListsProvider` and the stats strip reads `/api/user/stats`, none of which needed a new endpoint ([0027](docs/decisions/0027-usernames-and-public-profiles.md)). H4 is in as well, as a "Releasing soon" rail crossed on the client — deliberately *not* folded into `/api/home`, which is cached once for every visitor and must carry nothing about any one of them (3.5). Left: H8 events banner (H7's trending rail is already in), which *is* shared and belongs in that composite.

**Phase 4 — Make it cool (ongoing)**
Browse filters and sorting; game-page media; ITAD price tracking (P1–P11); Steam news (N1–N7); Steam import (scoped to ownership by [0026](docs/decisions/0026-a-library-import-records-ownership-not-history.md)); export; recommendations; release notifications; ~~the game-page half of reading reviews~~ (done — [0028](docs/decisions/0028-a-games-community-view.md)); ~~mobile navigation~~ (done) and responsive polish; then the Tier 3 social layer.

**Phase 5 — Monetise (after there is an audience)**
The paid tier only makes sense once Phases 2–4 have shipped the features that sit behind it — price alerts (P5, P8), advanced stats, import re-sync and the paid export *format* are the actual product being sold — the JSON export itself already ships free and stays that way ([0024](docs/decisions/0024-the-ownership-contract.md)). Land the legal pages and consent banner (M8, M9) early since they are required regardless. Then Stripe Billing and entitlement gating (M1–M7), and ads (A1–A6) last — they are the least valuable revenue per unit of user goodwill, so introduce them only once the paid tier gives people a way out.
