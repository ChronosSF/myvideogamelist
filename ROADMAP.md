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
| 2 | No local cache of game metadata: every list load fans out to IGDB (`GetGamesByIdsAsync`). If IGDB is down or rate-limits, users cannot see their own lists. | Open — Phase 2. Build it keyed on IGDB ids; do not resurrect the old catalog schema, whose `Platform` ids collided with IGDB's (local 6 = Switch, IGDB 6 = PC) |
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

- ~~**Full list taxonomy**~~ **DONE for the five statuses.** Backlog, Playing, On Hold, Finished and Dropped ship as a seeded `ListStatuses` lookup carrying semantic flags, replacing the hardcoded `ValidListTypes` set. Keys are `backlog` / `finished` rather than "Plan to Play" / "Completed", which is what made the expansion a no-migration change. **Still open:** the separate **Wishlist** axis a game can sit in alongside any status, and per-user renaming (`UserListSettings`). See ADR [0018](docs/decisions/0018-append-only-status-event-log.md).
- **Per-entry tracking data** — ~~user score (1–10)~~ **done**, independent of list membership (ADR [0019](docs/decisions/0019-entry-survives-leaving-every-list.md)). **Still open:** start date, finish date, hours played, platform played on, replay count, "own it / subscription / borrowed", personal notes — most of which belong to a playthrough rather than the entry, see `docs/data-model-plan.md`.
- **Completion states** — for Playing entries: percent complete, or "main story / main + extras / completionist".
- **Favourites** — star a game independent of list membership.
- ~~**Activity history**~~ **DONE for status changes.** `UserGameEvents` records every transition append-only, including first adds and removals, and is the one thing in the schema that could not have been backfilled later (ADR [0018](docs/decisions/0018-append-only-status-event-log.md)). **Still open:** scores and playthroughs, and the profile UI that reads the log.
- **User profile stats** — total games, total hours, mean score, score distribution, completion rate, games-per-month chart, most-played platform, most-played genre. Today `UserPage.tsx` shows only an email and a theme toggle.
- **Public profiles** — real usernames (`ApplicationUser` currently only has an email), a shareable `/u/{username}` route, and per-user privacy settings (public / friends / private).
- **Account lifecycle** — email confirmation, password reset, email change, and self-service account deletion with data export. `SignIn.RequireConfirmedAccount` is off and there is no email sender at all.
- **Social login finished** — Google and Facebook challenge/callback endpoints, account linking, and buttons in `LoginDialog`.

### Tier 2 — Discovery and daily-use polish

- **Real browse filters** — genre, platform, release year, score range, ESRB, and sort by rating / release date / name / popularity. Today the only options are a text search and a critic-score sort in `BuildQuery`, which now requires a minimum review count (ADR [0016](docs/decisions/0016-scores-carry-their-sample-size.md)) and so no longer reaches thinly reviewed games at all. IGDB's own popularity types 2 ("Want to Play") and 3 ("Playing") are platform-agnostic, unlike the Steam-sourced type 5 behind the trending rail, and are the better basis for a popularity sort.
- ~~**List views**~~ **Partly done.** Tiles and a condensed table view, switchable and remembered per account, with a sort order remembered per status list and a transient platform filter (ADR [0020](docs/decisions/0020-list-view-preferences-in-the-database.md)). Scores are settable inline in the table. **Still open:** multi-select bulk actions (move, remove, tag) and drag-to-reorder for a manual backlog priority.
- **Search everywhere** — a global search in the navbar with typeahead, not just on `/games`.
- **Game page depth** — *mostly done*: screenshot gallery, embedded trailer, similar games, franchise/series grouping, DLC and expansions, completion times, how-to-play modes and language support all ship (ADR [0017](docs/decisions/0017-detail-data-off-the-listing.md)). Still open: "where to play" store links.
- **Community signal** — site-wide average score, score histogram, review text with spoiler tags, helpful-votes on reviews.
- **Release notifications** — email or in-app alerts when a wishlist game gets a date or launches. The upcoming timeline already computes this data.
- **Recommendations** — "because you finished X" using IGDB genre/theme similarity; a "what should I play next" backlog picker.
- **Import from Steam / PSN / Xbox / GOG** — the single biggest reason people abandon a new tracker is retyping 300 games. Steam's public API makes this cheap and it deserves to be an early bet.
- **Export** — CSV and JSON download of everything a user has entered.
- **Empty and error states that teach** — the lists page already has good ones; extend the pattern to games and profile.
- **Responsive navigation** — `Navbar.tsx` tracks `menuOpen` but always renders the full link row; there is no mobile hamburger.
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
replaced by real trending covers and a live news rail (3.2, 3.4). **Still open: one route, two
pages** — fork on auth state, so a returning user lands on their own data rather than the pitch.

### 3.1 Signed-in dashboard

| ID | Item | Notes |
|---|---|---|
| H1 | Fork `HomePage.tsx` on `user` — dashboard when signed in, landing when not | Everything below hangs off this |
| ~~H2~~ | ~~Drop or rewrite the "Rate" feature card~~ **DONE** | All three feature cards removed with the home page redesign |
| H3 | **Continue Playing rail** — horizontal scroll of the `playing` list with inline "log progress" and "mark finished" | Data already in `ListsProvider`; no new API needed. Highest-value single item on the page |
| H4 | **Your week** — releases from the user's Wishlist/Backlog surfaced *above* the general timeline | "3 games you're waiting for drop this week" beats a firehose of every release |
| H5 | **Play next picker** — one random backlog game, with a reroll button | Cheap to build, disproportionately sticky |
| H6 | **Stats strip** — finished this year, hours logged, current streak | Blocked on Tier 1 per-entry tracking data |
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
| N6 | Dedicated **`/news` page** aggregating across everything the user tracks | **Still open.** `ISteamNewsService.GetLatestNewsAsync` already takes an arbitrary set of game ids, so this is a page and a route, not new plumbing |
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
| Export (CSV/JSON) | — | ✅ |
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
- **Local game-metadata cache table.** Persist IGDB game rows so lists and profiles render without a live third-party call, refreshed by a background job.

### Resilience & correctness

- **Retry + circuit breaker on the IGDB client** (`Microsoft.Extensions.Http.Resilience`). Right now `EnsureSuccessStatusCode` turns any IGDB hiccup into a 500 for the user.
- **Respect IGDB rate limits** (4 requests/second) with a client-side limiter. `GetUpcomingReleasesAsync` currently pages in an unbounded `while (true)` loop, 500 rows at a time.
- **Request rate limiting** on the API via the built-in rate limiter, especially on `/api/auth/*`.
- **Enable Identity lockout** — `PasswordSignInAsync` is called with `lockoutOnFailure: false`, so password guessing is unthrottled.
- **CSRF protection.** Cookie auth with no antiforgery token means `/api/lists`, `/api/user/theme` and friends are cross-site forgeable; `SameSite=Lax` is mitigation, not a fix. Add antiforgery tokens, or a header-based token check on state-changing calls.
- **Forwarded headers middleware.** Behind an ALB, `UseHttpsRedirection` and scheme detection misbehave without `UseForwardedHeaders`.
- **HSTS and security headers** — `UseHsts`, CSP, `X-Content-Type-Options`, `Referrer-Policy`. None are configured.
- **Global exception handling with ProblemDetails**, so the SPA gets consistent machine-readable errors instead of raw 500s.
- **`CancellationToken` through controllers → services → HttpClient.**

### Observability

- Health endpoints: `/healthz` (liveness) and `/readyz` (DB + IGDB reachability) — required for an ALB target group and ECS health checks
- Structured logging with correlation IDs, shipped to CloudWatch Logs
- OpenTelemetry traces and metrics (ADOT collector → X-Ray / CloudWatch)
- Alarms on 5xx rate, p99 latency, ECS task restarts, RDS connections, IGDB failure rate
- A `/version` endpoint reporting the deployed git SHA

### Quality gates

- **Unit tests** for `ListService`, the `IgdbService` DTO mapping, and the Apicalypse query builder
- **Integration tests** with `WebApplicationFactory` + Testcontainers PostgreSQL, covering auth and list flows
- **Frontend tests** — Vitest + Testing Library for the `ListsProvider` optimistic-update and rollback logic
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
| D3 | `dev.myvideogamelist.net` for the dev environment, with `noindex` and basic auth | Never let a staging environment get indexed alongside production |
| D4 | **SES for transactional email** on a verified domain, with SPF, DKIM and DMARC records | Password reset, email confirmation, price alerts and release notifications all depend on this |
| D5 | **Request SES production access early** | New SES accounts are sandboxed and can only send to verified addresses. The review takes time — do not discover this the week you launch email confirmation |
| D6 | Configure the OAuth redirect URIs for Google and Facebook against the real domain | Currently blocked on the half-wired social login from §1 |
| D7 | Set the Identity cookie domain explicitly | Matters once `www` and apex both resolve, and for any future subdomain |
| D8 | `robots.txt`, `sitemap.xml` (game pages + public profiles), canonical URLs | Public game pages and profiles are the organic acquisition channel — a real domain is what makes them worth indexing |
| D9 | Open Graph and Twitter Card tags on game pages, profiles and shared lists | Also powers the Tier 3 "share card" feature |
| ~~D10~~ | ~~Server-side rendering or prerendering for game pages~~ **DONE** | Framework-mode SSR (ADR [0002](docs/decisions/0002-server-side-rendering.md)). `/`, `/games` and `/games/:id` all server-render real content; `/lists` and `/user` stay client-side by design |
| D11 | Email deliverability monitoring — bounce and complaint handling via SNS | SES will throttle or suspend on high bounce rates |
| D12 | **CloudFront cache behaviours matching the per-route `Cache-Control`** | The origin now states a policy per route (ADR [0013](docs/decisions/0013-http-caching-policy.md)). Two things the CDN config must get right: **include `search` in the cache key for `/games`**, and give `/lists` and `/user` a behaviour that forwards the auth cookie and caches nothing |
| D13 | Write the behaviours against React Router **v8** `.data` URL formats | Trailing-slash routes request `/path/_.data` and the root is `/_.data`, not `/_root.data` (ADR [0011](docs/decisions/0011-react-router-8-upgrade.md)) |

---

## 7. Suggested sequencing

**Phase 0 — Clean the foundation — DONE**
IGDB credentials moved to user secrets (rotation still outstanding, and only you can do it); WeatherForecast template and the dead `Developers`/`Publishers` controllers deleted; seed data dropped via migration; `CancellationToken` plumbed through every controller and service; `/healthz` and `/readyz` added; the unbounded IGDB paging loop bounded; the calendar rebuilt on `release_dates` (3.3); 33 server unit tests added; CI extended with lint, typecheck, tests and CodeQL on both PRs and pushes.

**D10 — SSR — DONE (pulled forward from Phase 5)**
Migrated the client to React Router framework mode with SSR (now on v8, see [ADR 0011](docs/decisions/0011-react-router-8-upgrade.md)). Game pages now server-render real content plus `title`, `description` and Open Graph tags; 404s return a genuine 404 status. This unblocks D8 and D9, which were previously pointless. Remaining: only the game route has a loader — `GamesPage`, `ListsPage` and `UserPage` still fetch client-side, which is fine for the authenticated pages but should change for anything meant to be indexed.

**Phase 1 — Make it deployable (1–2 weeks)**
SSR makes this a **two-process** deployment; the container and CDK work in §6 must account for both, plus the layer that routes between them. See [ADR 0003](docs/decisions/0003-two-process-deployment.md) and [ADR 0007](docs/decisions/0007-aws-target-architecture.md).

PostgreSQL swap; Data Protection keys to S3; migrations out of startup; distributed cache; forwarded headers, HSTS, CSRF, lockout; Dockerfile; CDK stack; GitHub Actions OIDC deploy to a dev environment.

**Phase 2 — Make it a real tracker (2–4 weeks)**
Per-entry scores, dates, hours and notes; full list taxonomy plus Wishlist; profile stats; usernames and public profiles; email confirmation and password reset; local game-metadata cache table. (It is no longer a prerequisite for the Steam AppID mapping in N1, which shipped against an in-memory cache instead — see ADR [0012](docs/decisions/0012-steam-news-without-a-database.md).)

**Phase 3 — Make the home page earn its place (1–2 weeks)**
H1 and H3 first — fork on auth and ship Continue Playing, which needs no new API. Then H4 personalised calendar and H8 events banner (H7's trending rail is already in). Fold them into the `/api/home` composite (3.5) as you go.

**Phase 4 — Make it cool (ongoing)**
Browse filters and sorting; game-page media; ITAD price tracking (P1–P11); Steam news (N1–N7); Steam import; export; recommendations; release notifications; reviews; mobile navigation and responsive polish; then the Tier 3 social layer.

**Phase 5 — Monetise (after there is an audience)**
The paid tier only makes sense once Phases 2–4 have shipped the features that sit behind it — price alerts (P5, P8), advanced stats, import re-sync and export are the actual product being sold. Land the legal pages and consent banner (M8, M9) early since they are required regardless. Then Stripe Billing and entitlement gating (M1–M7), and ads (A1–A6) last — they are the least valuable revenue per unit of user goodwill, so introduce them only once the paid tier gives people a way out.
