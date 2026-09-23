# MyVideoGameList

A video game tracker. ASP.NET Core 10 REST API plus a React 19 front end that is
server-rendered with React Router 8 in framework mode.

## Running locally

**A database container, then two processes in two terminals.** ASP.NET serves the API only —
it does not serve the front end.

```bash
# Once, and whenever it is not already running — local PostgreSQL
docker compose up -d --wait

# Terminal 1 — the API (applies migrations on startup, in Development only)
cd MyVideoGameList.Server && dotnet run

# Terminal 2 — the SSR front end (this is the URL you open)
cd myvideogamelist.client && npm run dev
```

The database runs in Docker so local matches production; the app itself is deliberately not
containerised, because that would cost hot reload on both sides. Credentials for the local
container are committed in `compose.yaml` and `appsettings.Development.json` on purpose, so a
fresh checkout runs with no setup — they reach nothing beyond this machine.

Open `https://localhost:58546`.

**Never use `npm start` for local work.** It serves the production build, which has no
`/api` proxy: pages render, but every client-side request 404s. See
`docs/decisions/0003-two-process-deployment.md`.

## Commands

| Command | Notes |
|---|---|
| `npm run dev` | Dev server: SSR plus the `/api` proxy to ASP.NET |
| `npm run lint` | ESLint |
| `npm run typecheck` | `react-router typegen && tsc -b` — use this, never bare `tsc` |
| `npm run test` | Vitest, jsdom + Testing Library. `npm run test:watch` to iterate |
| `npm run build` | Production build |
| `dotnet test MyVideoGameList.Server.Tests/MyVideoGameList.Server.Tests.csproj` | Server unit tests |
| `dotnet ef migrations add <Name>` | From `MyVideoGameList.Server/` |
| `dotnet ef database update` | Applies migrations by hand; only needed outside Development |
| `docker compose up -d --wait` | Local PostgreSQL. `--wait` blocks until it accepts connections |
| `docker compose down` | Stops it, keeping data. **`down -v` destroys the data volume** |
| `node scripts/seed-demo-history.mjs --email <account>` | Months of demo tracking history, so the profile stats have something to show. Prints SQL — pipe it to psql. `--email` is mandatory and **replaces that account's lists**, so use a `@test.local` one |

Health endpoints: `/healthz` (liveness, no dependency checks) and `/readyz` (database and
IGDB reachability). A degraded IGDB returns 200, not 503 — browsing breaks but stored lists
still work, so the instance should stay in rotation.

## Layout

```
MyVideoGameList.Server/         ASP.NET Core 10 API
  Controllers/  Services/  Models/  DTOs/  Data/  HealthChecks/
  Security/                     Rate limits, forwarded headers, security headers, the write guard
  Errors/                       What each kind of failure leaves as
MyVideoGameList.Server.Tests/   xUnit tests
myvideogamelist.client/
  src/root.tsx                  HTML document, providers, global ErrorBoundary
  src/entry.server.tsx          Owned, not generated. Where every document response gets its headers
  src/routes.ts                 Route table. `/u/:userName` is the one public per-person page
  src/pages/                    Route modules (default export + optional loader/meta)
  src/resources/                Resource routes: robots.txt and the sitemaps. A loader, no component
  src/lib/                      apiUrl(), useStoredNumberSet(), pageMeta()
docs/decisions/                 Architecture decision records
docs/data-model-plan.md         Schema the roadmap implies, by table, with sequencing
scripts/                        Dev-only tools. These print SQL to stdout and never open a
                                database connection — piping to psql stays a deliberate act
ROADMAP.md                      Forward-looking plan
```

## Things that will bite you

- **Migrations auto-apply in Development only.** Everywhere else they are a deliberate
  deployment step, because several ECS tasks booting at once would race each other through the
  same migration. A deployed instance will start against an un-migrated database and fail on
  first query rather than silently migrating.

- **The PostgreSQL container volume mounts at `/var/lib/postgresql`, not `.../data`.**
  PostgreSQL 18 images changed this and refuse to start if they find data at the old path. The
  symptom is a container that restart-loops with an error about `pg_ctlcluster`.

- **Secrets never go in `appsettings.json`.** Local: `dotnet user-secrets set "Igdb:ClientId" "…"`.
  Deployed: `Igdb__ClientId` / `Igdb__ClientSecret` environment variables. User secrets load
  only in the Development environment — running as Production locally will fail IGDB calls.

- **IGDB is the source of truth for game data, but a library renders from `CachedGames`.** There
  are no local game/genre/platform tables; they were removed, and `UserGameEntry.GameId` holds an
  IGDB id with no foreign key. What exists instead is one `jsonb` row per IGDB id holding the mapped
  `GameDto`, refreshed on read after a day. **Anything rendering games somebody already tracks —
  lists, wishlist, favourites, public profiles — goes through `IGameCacheService`, never
  `IIgdbService`**, because that is what makes those pages survive an IGDB outage; browse, search
  and the game page's detail query stay live, since no local copy can answer a query over the whole
  catalogue. A row with a null payload is a tombstone meaning "IGDB has no such game", so a
  withdrawn game on somebody's list is not asked about on every page load. The table is not
  user-owned: no cascade, no export manifest entry. See `docs/decisions/0035-*`.

- **IGDB's `external_games.category` no longer exists.** Use `external_game_source` (Steam is
  `1`). Filtering on the removed field returns zero rows *silently* rather than erroring, so the
  symptom is an empty feature with a clean log. Suspect this whenever an IGDB filter returns
  nothing — check the field still exists before debugging your own code.
  `age_ratings.category` and `age_ratings.rating` went the same way — use `organization` (ESRB is
  `1`) and `rating_category`. *Requesting* a removed field is just as quiet: it is left out of the
  response, which hid every ESRB badge.

- **Steam news and the trending rail hold no database state**, deliberately, so the pending
  PostgreSQL move stays as cheap as it is today. See `docs/decisions/0012-*`. Keep derived,
  regenerable, TTL'd data in `IMemoryCache`; do not add a table for it.

- **The wishlist is not a sixth status, and it writes no events.** Its own table, service,
  controller, context and provider (`docs/decisions/0022-*`). The five statuses are exclusive by
  construction; wanting a game is not exclusive with playing it, so a game sits on the wishlist
  *and* in a list. `AddedAt` is its entire history — do not reach for `UserGameEvents`, and do not
  add a foreign key to `UserGameEntries`, because a wishlisted game usually has no entry at all.

- **Favourites are a second axis on the wishlist's code, so fix either one in the shared place.**
  `UserFavourites` has the wishlist's shape, and both write through `GameAxisStore` on the server and
  run on `useGameAxis` on the client — a race guard or a session stamp added to one provider by hand
  is exactly the drift ADR 0022 records. Each provider keeps its own context and pending set. A
  favourite is marked with a rosette, never a star, and is published on a public profile where the
  wishlist shows only its size. See `docs/decisions/0029-*`.

- **`UserName` is the public handle, not the email — and login had to be fixed for it.**
  `SignInManager.PasswordSignInAsync(string, …)` resolves its first argument as a *username*, which
  worked only while registration set both columns to the address. `AuthController` now looks the
  account up by email and then by name and signs in the resolved user; reverting that reports itself
  to every user as "your password is wrong". The shape rules live in `UserNamePolicy`, and
  `Program.cs` configures Identity's own validator from the same constant — never state the alphabet
  twice. Uniqueness is Identity's index over `NormalizedUserName`, and **never check availability
  before writing**: Identity's own validator already reads before it writes and reports the ordinary
  case as `DuplicateUserName`, but the EF store does not translate the index violation two
  simultaneous claimants produce — it surfaces as a `DbUpdateException`. `UserNameClaimService`
  wraps both writes and turns that into the same `DuplicateUserName`, so go through it; never call
  `CreateAsync` or `SetUserNameAsync` for a username directly. After a real rename, refresh the
  sign-in: `SetUserNameAsync` rotates the security stamp, and the validator signs the user out within
  thirty minutes otherwise. See `docs/decisions/0027-*`.

- **A profile is private by default, and the public document is hand-assembled.**
  `ProfileVisibility` defaults to `private` for new accounts as well as backfilled ones, on ADR
  0025's argument that a default is not consent. Two gates compose and the narrower wins: a public
  review on a private profile is visible to nobody. `PublicProfileService` reuses `StatsService`
  rather than re-deriving anything, but copies fields into `PublicProfileDto` **one at a time** —
  returning `UserStatsDto` would publish every figure ever added to the private profile, by nobody's
  decision. A private profile and an unclaimed name are the same 404, so the endpoint cannot be used
  to ask whether a name has an account.

- **A statistic about the user must not depend on IGDB being up.** `/api/user/stats` reads only
  our own tables, derives everything at read time, and is deliberately uncached — every figure
  changes the moment a game moves. The platform and genre breakdowns are the one part that needs
  game metadata, so they are counted on the client from the lists already loaded; an outage costs
  those two rows and nothing else. Hours now exist — on playthroughs — so "most played on" is
  answerable and says "played"; the older "most of your games are on" row is a different claim about
  library composition and keeps its wording. See `docs/decisions/0023-*` and `0025-*`.

- **A new user-owned table has to be registered in the export manifest and cascade from
  `AspNetUsers`.** `UserOwnedDataTests` walks the EF model and fails otherwise — in both
  directions, so a stale registration for a table you removed fails too. The manifest is
  `UserDataExporter.Manifest`, keyed by entity `Type`, and it is the *only* place to register:
  `ExportAsync` walks it. A new *column* on a registered table trips nothing, because each section is
  a hand-written projection — add it to that reader too, as `Ownership` and `Notes` were
  (`docs/decisions/0030-*`). Statuses export as their `Key`, never the seeded id. The export is free
  and stays free — portability is a right, and the paid "Export" in the monetisation table is a
  nicer *format* on top, so do not put an entitlement check on `/api/user/export`. It makes no IGDB
  call, for the same reason the stats do not. See `docs/decisions/0024-*`.

- **A child table of the entry carries its own `UserId`, because the ownership guard keys on it.**
  `UserOwnedDataTests` selects user-owned entities by the *presence of a `UserId` property* and then
  demands a cascading foreign key tied to that column. A playthrough or a review keyed only through
  `UserGameEntries` would carry no such column, so it would escape both the cascade check and the
  export manifest without failing anything — a silent hole in somebody's data. So both carry
  `UserId` and reach their entry by a composite foreign key on `(UserGameEntryId, UserId)`, which is
  what makes "the child's owner is the entry's owner" a database constraint rather than a promise a
  service has to keep. See `docs/decisions/0025-*`.

- **No MVGL average is shown without its count, and the floor lives in the client.** The community
  completion times are medians, never means — self-reported playtime has a long idle-hours tail —
  and every bucket travels with `samples`. `MIN_PLAYTHROUGH_SAMPLES` in `@/lib/score` suppresses a
  tier under the floor, showing a dash and the count rather than a number, exactly as
  `MIN_CRITIC_REVIEWS` does for IGDB's critic score. Only playthroughs with *both* a type and a
  duration are counted: the others would inflate a sample size behind a figure they did not help
  produce. See `docs/decisions/0016-*` and `0025-*`.

- **A game's member reviews are fetched after hydration, never in the route loader.** The game page
  is edge-cached for an hour and servable stale for a day, so review text rendered into it would
  outlive its author withdrawing it by up to a day — and D14 invalidates profiles, not every game page
  an author has reviewed. `/api/games/{id}/reviews` and `/community-scores` therefore send `no-store`
  and keep no server cache either. The two cross different gates: the scores count every member, since
  an aggregate names nobody; the reviews list only those public on a public profile. The reviews page
  by an encrypted cursor over `CreatedAt` then the review id, **never by offset** — rows move while
  somebody reads, and an offset then skips a review for good — and never on a key that can change,
  such as the author's name. `GameUserPanel` calls the hook's `reload` after the reader's own
  score or review changes, or the section beside it shows the write as though it had failed. See
  `docs/decisions/0028-*`.

- **A list's label reads `nameFor` from the lists context, never `LIST_NAMES`** — except on a public
  profile, which keeps the defaults because a rename is its owner's alone. `LIST_NAMES` is the
  defaults. A rename writes `UserListSettings` and nothing else, the five effective names must differ
  without case, and the names form edits only when `namesStatus` is `ready`: a failed read looks like
  "nothing renamed", and saving from it would reset every list. See `docs/decisions/0031-*`.

- **Every write carries `X-MVGL-Request`, and `apiFetch` is what puts it there.** Cookie
  authentication means a browser attaches the session to a cross-site request as readily as to one
  of ours, so the API refuses any `POST`, `PUT`, `PATCH` or `DELETE` without that header — in local
  development exactly as when deployed. On the client, use `apiFetch` from `@/lib/api` for every
  write; a bare `fetch` is a 403 that looks like a bug. Calling a write endpoint from curl or
  Scalar means adding the header by hand. **Never add a permissive CORS policy**: an
  `Access-Control-Allow-Headers` that admits this header from an arbitrary origin undoes the whole
  guard. See `docs/decisions/0033-*`.

- **Two processes serve two sets of security headers, and the document set lives in
  `entry.server.tsx`.** The API's policy is `default-src 'none'` because JSON loads nothing; a page
  under that policy would be blank, so the document set is separate and is applied in
  `entry.server.tsx` — the only place every document response passes through, since a thrown
  `Response` bypasses a route's `headers` export. That file is otherwise `react-router reveal`'s
  output and must be re-diffed against it on a React Router major. On the API side the headers
  attach with `OnStarting` rather than on the way in, because `UseExceptionHandler` clears the
  response — headers included — before writing a 500 or a 502.

- **A third party's failure is a 502, our own throttle is a 503, ours is a 500, and a reader who
  left is a 499.** IGDB calls go through a resilience pipeline — retry outermost, then the breaker,
  then the four-a-second limiter, then a per-attempt timeout, with a total timeout over all of it.
  That order is load-bearing: with the limiter outside the retry it would pace *operations*, and
  three attempts would share one permit. Every error body is a `ProblemDetails` with a `traceId`,
  which means writing it through `IProblemDetailsService` and never by hand; the exception itself is
  included in Development only. `/readyz` still answers 200 while IGDB is down, deliberately. See
  `docs/decisions/0034-*`.

- **The rate limiter is narrow on purpose, and the lockout says nothing.** Ten attempts per address
  per five minutes on login and register only — the SSR server calls this API for every visitor, so
  a limit partitioned by address anywhere a loader reaches would throttle the whole site as one
  client. Identity locks an account after five failures but answers exactly as it answers a wrong
  password, because announcing a lockout tells an attacker the account exists. Forwarded headers
  are off until configured, and turning them on without naming the proxy **fails at startup** rather
  than trusting whoever sends the header.

- **Never change a game's status without recording an event.** `UserGameEvents` is append-only
  and is the only record that a transition happened — `UserGameLists` holds current state and is
  overwritten on every move. A direct `UPDATE` to `StatusId` leaves a permanent hole in a history
  no migration can reconstruct. Go through `ListService`, and note that a move to the status a
  game already holds must record nothing. See `docs/decisions/0018-*`.

- **The import is the one exemption from that rule, and `Origin` is what makes it checkable.**
  `ImportService` writes statuses without events, because a tracker export records a shelf rather
  than a transition and an event would carry the import's own timestamp as permanent fabricated
  history. So `UserGameEntry.Origin` names the source — `manual` means every status that entry has
  held has an event behind it, anything else means it may not — and it is set whenever the import
  writes a status, over an existing entry as well as a new one. `StatusChangedAt` stays null for
  the same reason. **An imported playthrough carries no type**: a typed run with a duration feeds
  the community medians, and a tracker's completion field is a default rather than its owner's
  answer — Grouvee's reads "Main Story" on 596 of 608 rows including all 448 that carry no date and
  no hours. Anything later that assumes "every status has an event" — an activity feed, an audit, a
  backfill — has to consult `Origin`. See `docs/decisions/0026-*` and `0037-*`.

- **Scheduled work is a `BackgroundService`, and there is exactly one.** `ImportRetentionService`
  sweeps expired import jobs hourly, and is the shape the next one copies (ADR 0038). Three things
  about it are easy to get wrong: a hosted service is a **singleton**, so it takes
  `IServiceScopeFactory` and makes a scope per tick rather than injecting the scoped `DbContext`;
  an exception escaping `ExecuteAsync` **stops the whole host** — the default since .NET 6, pinned
  by a test — so the loop catches per tick; and it runs **once per ECS task**, so it serialises on
  `pg_try_advisory_xact_lock` — the transaction-scoped variant, because a session lock survives on
  a pooled connection after it is returned. Retention is two windows, not §S9's one: seven days
  from `CompletedAt` for a closed job, fourteen from `CreatedAt` for a pending one, because a job
  nobody finished reviewing has no completion and would otherwise hold a `MaxPendingJobs` slot for
  ever. **`ExecuteDeleteAsync` needs a relational provider**, so the predicate is an `Expression`
  the tests run against InMemory and the deletion itself is not unit-tested.

- **A new import preset is an `IImportSource`, not a parser.** The seam is file → canonical rows,
  one level up from the column map `specs/csv-list-import.md` proposed, because Grouvee's export is
  a nested document that no column map can describe. Everything after that seam — the review, the
  conflict check, the commit, the failure report — is shared and must stay source-agnostic. A row
  carrying the source's own IGDB id needs no matching at all, which is why the fuzzy matcher does
  not exist yet: build it with the first preset that has no ids, against a path that already works.

- **A score without its review count is not shippable.** IGDB's `aggregated_rating` is an
  unweighted mean with no minimum, so a game with one perfect review scores 100. Every score in
  `GameDto` travels with its count, the browse query requires
  `aggregated_rating_count >= 8`, and the client suppresses badges below
  `MIN_CRITIC_REVIEWS`. Search is deliberately *not* filtered this way. See
  `docs/decisions/0016-*`.

- **Each browse order carries its own floor, and a search carries none.** Top rated keeps 0016's eight
  critics; Popular needs ten ratings; Newest and A to Z need ten ratings *and* a critic, because
  without one they fill with shovelware. The filters apply to a search, but never an order: IGDB
  answers a `search` with a `sort` with a 406. Every browse parameter is in the URL through
  `@/lib/gameBrowse`, and all six belong in the CDN cache key. See `docs/decisions/0032-*`.

- **Stars mean the user's own score and nothing else.** One `ScoreInput` — five stars, half-star
  steps, which is exactly the 1–10 the database stores. Everything averaged from other people
  (critic score, IGDB player rating) is a number out of 100 in a `ScoreBadge`. Do not add a second
  score control, and do not put stars on an aggregate: that mix-up is what
  `docs/decisions/0021-*` exists to prevent.

- **Two game field lists, and putting a field in the wrong one fails quietly.**
  `GameListFieldList` feeds every query; `GameDetailFieldList` is concatenated onto it only by
  `GetGameByIdAsync`, which is why `GameDto.Details` is null everywhere else. A field a *listing*
  needs that lands in the detail list is null in every grid and populated on exactly one page.
  See `docs/decisions/0017-*`.

- **Every route must declare a `Cache-Control` via its `headers` export**, because CloudFront
  applies its own default TTL when the origin sends none. The root default is `private,
  no-store` so forgetting fails closed. Policies live together in `@/lib/cache`; see
  `docs/decisions/0013-*`.

- **To keep something out of a search index, say `noindex` — never `Disallow` it.** A crawler
  refused by robots.txt never requests the page, so it never sees the `noindex`, and the bare URL
  can still be listed. So `robots.txt` disallows nothing, on purpose: a deployment is indexable only
  with `SITE_URL` set *and* `SITE_INDEXABLE=true` on the front-end server, and any other sends
  `X-Robots-Tag: noindex, nofollow` on every response; the per-user pages carry their own `noindex`;
  and the API sends `X-Robots-Tag: noindex` so that `/api/` can stay crawlable — a crawler rendering
  a game page has to be able to fetch the member reviews the page fetches. An indexable route
  returns `pageMeta(...)` from `@/lib/seo` with a `path` **built from loader data, never from the
  request** (`/u/ALICE` renders, and has to say it is `/u/alice`), and carries `site` in its loader
  data because `meta` runs in the browser too. The sitemap reads `CachedGames` and public,
  non-empty profiles and makes no IGDB call; the empty-profile test lives in both
  `SitemapService.ListedProfiles` and `ProfilePage`'s `meta`, and they must agree. Resource routes
  bypass `entry.server.tsx`, so they go out through `resourceResponse`. See
  `docs/decisions/0036-*`.

- **A degraded or error response must never be cacheable.** Caching a failure outlives the
  failure. Note three traps: a thrown `Response`'s headers are replaced by the boundary route's
  (the root reads `errorHeaders` to honour them); a loader that degrades to a 200 has to attach
  `no-store` itself via `data()`; and an *API* that degrades to a 200 has to say so in its payload,
  because neither the loader nor a CDN can tell that 200 from a healthy one. `/api/home` does, with
  `degraded`, and the loader reads it failing closed — only an explicit `false` is shared-cached.

- **`fetch` rejects when the API is unreachable** — it does not return `!response.ok`. A loader
  that only checks `response.ok` turns a dead upstream into an unhandled 500. Wrap it and throw
  a deliberate 502. The same trap catches an optimistic mutation: with no `catch`, the change
  stays on screen as though it saved, and the rejection escapes unhandled.

- **`useUserStats` and `useHiddenPlatforms` take the account id, and that parameter is the guard.**
  Both are mounted on the home page, which outlives a sign-out, so each follows the whole of the
  shape ADR 0022 settled on for the list providers: the account lives in reducer state beside the
  data, the transition is applied during render, and every completion is stamped with the account it
  was started for and dropped on a mismatch. The `AbortController` is not the guard — the abort runs
  in the effect cleanup, after the commit. Passing a constant, a boolean, or dropping the parameter
  puts one account's data under another's name. Apply the same shape to any new account-scoped hook.

- **Loaders run on the server**, where a relative URL has no origin. Use `apiUrl()` from
  `@/lib/api` for any fetch that may run during SSR.

- **Never touch `window`, `document` or `localStorage` during render or in a `useState`
  initializer** — it breaks SSR. Follow `@/lib/useStoredNumberSet` for browser-only state.

- **Route types** (`./+types/*`) are generated by `react-router typegen` into
  `.react-router/`. Bare `tsc` fails; run `npm run typecheck`.

- **New projects need no gitignore work** — build-output patterns are project-agnostic
  (`[Bb]in/`, `[Oo]bj/`). They were hardcoded per project once and leaked 112 DLLs.

## Conventions

Path-scoped conventions live in `.claude/rules/`: `backend.md` for C# and `frontend.md`
for the client. They load automatically when you work on matching files.

## Decisions

`docs/decisions/` records architectural decisions and the reasoning behind them. Read the
relevant record before changing anything it covers, and add one when you make a call that
future work would otherwise have to reverse-engineer. `ROADMAP.md` is the plan; the ADRs
are why the code is the way it is.
