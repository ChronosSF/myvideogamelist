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
| `npm run lint` | ESLint, then `scripts/check-colours.mjs`: every colour is a token |
| `npm run typecheck` | `react-router typegen && tsc -b` — use this, never bare `tsc` |
| `npm run test` | Vitest, jsdom + Testing Library. `npm run test:watch` to iterate |
| `npm run visual` | Before-and-after screenshots of the pages, compared pixel by pixel, for a change meant to look the same. Needs two dev servers and a local test account, whose email and password it reads from the shell or from `visual/.env` (ignored by git); `visual/playwright.config.ts` says how. Not run by CI |
| `npm run build` | Production build |
| `dotnet test MyVideoGameList.Server.Tests/MyVideoGameList.Server.Tests.csproj` | Server unit tests |
| `dotnet test MyVideoGameList.Server.IntegrationTests/MyVideoGameList.Server.IntegrationTests.csproj` | The API over a real PostgreSQL, for what InMemory cannot do: auth and the lists end to end, the cascades, the retention sweep, the cache refresh's lock and commit, and the export's snapshot. Needs Docker running; starts and removes a container of its own, never `mvgl-postgres`. About fifteen seconds once built. See ADR 0057 |
| `dotnet ef migrations add <Name>` | From `MyVideoGameList.Server/` |
| `dotnet ef database update` | Applies migrations by hand; only needed outside Development |
| `docker compose up -d --wait` | Local PostgreSQL. `--wait` blocks until it accepts connections |
| `docker compose down` | Stops it, keeping data. **`down -v` destroys the data volume** |
| `node scripts/seed-demo-history.mjs --email <account>` | Months of demo tracking history, so the profile stats have something to show. Prints SQL — pipe it to psql. `--email` is mandatory and **replaces that account's lists**, so use a `@test.local` one |
| `node scripts/dev-env.mjs status\|park\|resume` | The AWS dev environment, through the signed-in `mvgl-dev` profile: `park` destroys the App stack (the distribution with it), stops the database and gates the pipeline off; `resume` is the reverse at the newest pushed tag, proving the site answers through the door. Every deploy is `--exclusively`, so the Data stack is never touched by accident. See ADR 0044, 0046 |
| `node scripts/dev-check.mjs` | The dev environment's acceptance test, through the distribution. Run it after any stack change and after every resume; with `MVGL_DEV_BASIC_AUTH` set to the basic-auth pair it checks everything, without it only the door |

Health endpoints: `/healthz` (liveness, no dependency checks) and `/readyz` (database and
IGDB reachability). A degraded IGDB returns 200, not 503 — browsing breaks but stored lists
still work, so the instance should stay in rotation. Which commit is running: `/api/version` on the
API and `/version` on the SSR server, each `{ sha, builtAt }`, `unknown` locally (ADR 0059).

## Layout

```
MyVideoGameList.Server/         ASP.NET Core 10 API
  Controllers/  Services/  Models/  DTOs/  Data/  HealthChecks/
  Security/                     Rate limits, forwarded headers, security headers, the write guard, the admin policy
  Errors/                       What each kind of failure leaves as
  Observability/                The trace id, the request log, the JSON console, /api/version
MyVideoGameList.Server.Tests/   xUnit tests
MyVideoGameList.Server.IntegrationTests/  The API over PostgreSQL in a container, for what InMemory cannot do
myvideogamelist.client/
  src/root.tsx                  HTML document, providers, global ErrorBoundary
  src/entry.server.tsx          Owned, not generated. Where every document response gets its headers
  src/routes.ts                 Route table. `/u/:userName` is the one public per-person page
  src/pages/                    Route modules (default export + optional loader/meta)
  src/resources/                Resource routes: robots.txt, the sitemaps and /version. A loader, no component
  src/lib/                      apiUrl(), useHydrated(), pageMeta(); loaderFetch() in trace.server.ts
docs/decisions/                 Architecture decision records
docs/data-model-plan.md         The tables not built yet, and the two constraints every table answers to
scripts/                        Dev-only tools. The seeding tools print SQL to stdout and never open
                                a database connection — piping to psql stays a deliberate act.
                                dev-env.mjs is the exception: it acts on AWS, through a signed-in
                                CLI profile, and prints every command before running it
ROADMAP.md                      Not the plan any more: where it lives (GitHub issues), and the old IDs' map
```

## Things that will bite you

- **Migrations auto-apply in Development only.** Everywhere else they are a deliberate
  deployment step, because several ECS tasks booting at once would race each other through the
  same migration. A deployed instance will start against an un-migrated database and fail on
  first query rather than silently migrating. Deployed, that step is the migration task the
  `Deploy dev` workflow runs before the application stack, from the bundle baked into the API
  image; a non-zero exit stops the release.

- **A merge to master builds and pushes dev's images, and deploys only when the environment is
  awake.** `DEV_DEPLOY_ENABLED` on the `dev` GitHub environment is the gate, set by
  `scripts/dev-env.mjs park` and `resume` and by nothing else: deploying the application stack
  recreates it if it was destroyed, so an unconditional deploy-on-merge would silently un-park the
  environment and start the balancer billing again. Every deploy of `Migrate` or `App`, in the
  workflow and in the script, is `--exclusively`, so that the long-lived `Data` stack is never
  redeployed as a dependency by something that only meant to deploy a release. The balancer admits
  CloudFront's prefix list and nothing else, and its listener answers only the distribution that
  sends the origin-verify header; the site is behind basic auth at the edge, with three public
  aggregate endpoints exempt. See `docs/decisions/0044-*`, `0046-*` and `infra/README.md`.

- **The PostgreSQL container volume mounts at `/var/lib/postgresql`, not `.../data`.**
  PostgreSQL 18 images changed this and refuse to start if they find data at the old path. The
  symptom is a container that restart-loops with an error about `pg_ctlcluster`.

- **Secrets never go in `appsettings.json`.** Local: `dotnet user-secrets set "Igdb:ClientId" "…"`.
  Deployed: `Igdb__ClientId` / `Igdb__ClientSecret` environment variables. User secrets load
  only in the Development environment — running as Production locally will fail IGDB calls.

- **The key ring is shared through Parameter Store, and a deployment that names no store does not
  start.** The Data Protection keys sign the Identity cookie and seal the review cursor, and a ring
  nobody persists is remade by every process — so a deploy signs everyone out, with a clean log.
  `AddDataProtectionKeys` therefore persists to the path in `DataProtection:ParameterPath`, falls
  back to the user-profile ring in Development only, and otherwise **fails at startup** unless
  `DataProtection:AllowEphemeralKeys` says the loss is meant, which it is only for running the
  production image on a developer machine or the integration suite's test host (ADR 0057). Two things the code cannot check: the task role needs
  `ssm:GetParametersByPath` and `ssm:PutParameter` on that path — not `ssm:DeleteParameter`,
  because nothing deletes keys — and a missing read fails the first sign-in, not the deploy: the
  framework's `DataProtectionHostedService` reads the ring at boot, but a failure there is only
  logged, at Error, and the first protect reads again. Keep `SetApplicationName("MyVideoGameList")` — the default discriminator is the content
  root path, and changing the image's working directory would orphan every cookie while the keys
  stayed readable. One path per environment, so dev and prod cannot read each other's cookies. The
  proof is a session surviving a redeploy, which no local test can give. See
  `docs/decisions/0043-*`.
- **Nobody is an admin until named, in Development too.** `/admin` and its endpoints sit behind one
  policy that reads account ids from `Admin:AccountIds`, so name your own:
  `dotnet user-secrets set "Admin:AccountIds:0" "<account id>"`. An id, never a username — a name
  can be given up and claimed by somebody else. A later admin page goes behind the same policy, on
  the controller's class, and edits reference data only, never a user's. See `docs/decisions/0042-*`.
  Its statistics count and never list: totals across every account, nothing that selects one. The
  `LastSeenAt` they read is written by `GET /api/auth/me`, once a UTC day, the one write behind a
  `GET`, so keep that endpoint uncached. See `docs/decisions/0051-*`.

- **IGDB is the source of truth for game data, but a library renders from `CachedGames`.** There
  are no local game/genre/platform tables; they were removed, and `UserGameEntry.GameId` holds an
  IGDB id with no foreign key. What exists instead is one `jsonb` row per IGDB id holding the mapped
  `GameDto`, rewritten in the background an hour before it is a day old (ADR 0052), and on read once
  it is, as the fallback; both go through `GameCacheService.Apply`, and both thresholds derive from
  `RefreshAfter`. **Anything rendering games somebody already tracks —
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
  response, which hid every ESRB badge. `websites.category` went the same way: its absence made
  every game's "Official Site" whichever link IGDB listed first — use `type`, a `website_types` id
  (official is `1`).

- **An IGDB release date is not always a day.** `release_dates.date_format` says how much of it is
  known — 0 the day, 1 the month, 2 the year, 3 to 6 a quarter, 7 nothing — and for anything but a
  day the stored `date` is a stand-in: the month's first day, the quarter's or the year's last. Read
  the period from `y`, `m` and `date_format`, and never select imprecise rows by `date` alone: a
  year-only 2027 is stored as 31 December and falls outside every window that ends before then.
  `IgdbService.BuildConnectedReleasesQuery` is the worked example; see
  `specs/release-timeline-and-calendar.md` §4 and §8.1.

- **Steam news and the trending rail hold no database state**, deliberately, so the pending
  PostgreSQL move stays as cheap as it is today. See `docs/decisions/0012-*`. Keep derived,
  regenerable, TTL'd data in `IMemoryCache`; do not add a table for it.

- **The wishlist is not a sixth status, and it writes no events.** Its own table, service,
  controller, context and provider (`docs/decisions/0022-*`). The five statuses are exclusive by
  construction; wanting a game is not exclusive with playing it, so a game sits on the wishlist
  *and* in a list. `AddedAt` is its entire history — do not reach for `UserGameEvents`, and do not
  add a foreign key to `UserGameEntries`, because a wishlisted game usually has no entry at all.

- **Favourites are a second axis on the wishlist's code, so fix either one in the shared place.**
  `UserFavourites` has the wishlist's shape plus a hand-ordered position, and both write through
  `GameAxisStore` on the server and run on `useGameAxis` on the client — a race guard or a session
  stamp added to one provider by hand is exactly the drift ADR 0022 records. Each provider keeps its
  own context and pending set. A favourite is marked with a rosette, never a star, and is published on
  a public profile where the wishlist shows only its size. The showcase's hand order is on that shared
  code too — `moveInOrder` in `useGameAxis`, which the wishlist gives no `order` and so cannot use —
  and its steps are `moveInHandOrder` (`@/lib/handOrderMove`), which the backlog's move runs as well,
  so a step added there is added to both orders. A move's failure is `orderError`, never
  `mutationError`, which every game page's favourite toggle shows. The public profile shows the
  favourites in their order: the order crosses, the positions never do. The reader's own rosette is
  drawn on every card of their games and the site's, and on nothing of somebody else's profile,
  which is why `GameRefRail` takes `isFavourite` rather than reading the context. See
  `docs/decisions/0029-*` and `0064-*`.

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

- **A page loads images only from the hosts its policy names, and an avatar's host is in two
  lists.** The document policy's `img-src` is `IMAGE_SOURCES` in `@/lib/securityHeaders`: this
  origin, IGDB's CDN and the avatar hosts. **An image from any other host does not load**, in
  development too, so a feature that shows one from somewhere new adds the host there on purpose.
  An avatar host goes in both `AvatarUrlPolicy.Hosts`, which says what may be saved, and
  `AVATAR_HOSTS` in `@/lib/avatar`, which `IMAGE_SOURCES` is built from; `serverMirrors.test.ts`
  reads the server's file and fails when they differ. A host joins only once seen to serve an avatar
  over HTTPS with `Access-Control-Allow-Origin`, no cookie and no reporting headers — Discord's CDN
  and Twitch's are off for those — because the picture is loaded anonymously, with no referrer, by
  every reader's browser. The address is stored as given and never fetched by the server. A display
  name sits beside the handle and never replaces it, and a bio is plain text because it is rendered
  as a text node. See `docs/decisions/0056-*`.

- **A statistic about the user must not depend on IGDB being up.** `/api/user/stats` reads only
  our own tables, derives everything at read time, and is deliberately uncached — every figure
  changes the moment a game moves. The platform and genre breakdowns are the one part that needs
  game metadata, so they are counted on the client from the lists already loaded; an outage costs
  those two rows and nothing else. Hours now exist — on playthroughs — so "most played on" is
  answerable and says "played"; the older "most of your games are on" row is a different claim about
  library composition and keeps its wording. See `docs/decisions/0023-*` and `0025-*`.

- **A new user-owned table has to be registered in the export manifest and cascade from
  `AspNetUsers`.** `UserOwnedDataTests` walks the EF model and fails otherwise — in both
  directions, so a stale registration for a table you removed fails too. It also checks the other
  edge: a **required** foreign key to a user-owned *parent* must cascade as well, because a child
  that cannot exist without its parent must not be left orphaned or block the parent's deletion.
  That is what makes the import sweep's bare `DELETE FROM "ImportJobs"` safe. An optional pointer
  between siblings is outside the rule — a review's link to the playthrough it describes is
  `SetNull`, so deleting one run does not take the prose with it. The three deletion rules — with
  the account, with a parent, and the review's unlink — are also run against PostgreSQL by the
  integration suite's `OwnershipCascadeTests`, which fails until its `RecordEverythingAsync` gives
  an account a row in the new table (`docs/decisions/0057-*`). The manifest is
  `UserDataExporter.Manifest`, keyed by entity `Type`, and it is the *only* place to register:
  `ExportAsync` walks it. A new *column* on a registered table trips nothing, because each section is
  a hand-written projection — add it to that reader too, as `Ownership` and `Notes` were
  (`docs/decisions/0030-*`). Statuses export as their `Key`, never the seeded id. The export is free
  and stays free — portability is a right, and the paid "Export" in the monetisation table is a
  nicer *format* on top, so do not put an entitlement check on `/api/user/export`. It makes no IGDB
  call, for the same reason the stats do not. **It reads one snapshot**: every section runs in one
  `REPEATABLE READ` transaction, so a new section must read through the context it is handed — a
  service or scope with its own context reads outside the snapshot. InMemory has no isolation and
  cannot see it; the integration suite's `ExportSnapshotTests` shows it holding against PostgreSQL,
  over the import's two sections only. See `docs/decisions/0024-*` and `0057-*`.

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

- **A change of list clears the entry's hand-arranged position, and every writer of a status owes
  that.** `UserGameEntries.Position` is the backlog's "My order": a sparse number, null for a game never
  placed, and a place in the list the game is in *now* — so `ListService`'s moves and removals and the
  import's commit set it to null whenever `StatusId` changes, and the client's optimistic move does the
  same. A new path that writes a status and forgets puts a returning game at a stale number rather than
  among the unplaced, who queue by when they joined the list. The numbers are computed on the client
  (`planMove` in `@/lib/handOrder`) and stored as sent, checked for range by the DTO and by
  `CK_UserGameEntries_Position_Range`, and for the list; the control — drag, tap, or keyboard — is
  `useReorder`, which the favourites showcase reuses unchanged. `UserFavourites.Position` is the same
  number on the other axis, written through the same `HandOrderStore`; a favourite has no list to
  leave, so only its own removal loses its place. A new hand-ordered table needs its range check, and
  `HandOrderTests` fails until it has one and is named in that test's inventory; `ModelSnapshotTests`
  fails until a migration carries it. See `docs/decisions/0054-*` and `0064-*`.

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

- **A document runs only the scripts its own render wrote.** Its `script-src` names a nonce drawn
  once per render in `entry.server.tsx` and handed to `<ServerRouter>` and to the stream; an inline
  script without it never runs, and a page whose hydration scripts never run is dead. A new inline
  script of ours, such as the palette script #208 plans, goes in by its hash in `documentPolicy`, and
  a script from another host is refused until a record decides its hosts or `'strict-dynamic'`
  (Google's tag, #242, is the first). A shared cache keeps the nonce whole only because header and
  body are stored together, so **nothing at the edge may set, rewrite or remove
  `Content-Security-Policy` on a document** — a response headers policy replacing it names no nonce
  and every page dies — **and no document may carry an `ETag` or `Last-Modified`**, because a 304
  keeps the old body under the new header. A HEAD carries no policy, and a document a shared cache
  may store is sent whole rather than streamed, so that its nonce is never seen before its body is
  final. On a shared page that nonce is public, so **never add a sink that parses a string as markup
  in the browser** (`dangerouslySetInnerHTML` of anything but a constant, `innerHTML`, `srcdoc`, …):
  0053 §2 holds because there is none (#250). The root renders `<Links nonce="">` on purpose —
  without it every page reports a hydration mismatch in development. See `docs/decisions/0053-*`.

- **A third party's failure is a 502, our own throttle is a 503, ours is a 500, and a reader who
  left is a 499.** IGDB calls go through a resilience pipeline — retry outermost, then the breaker,
  then the four-a-second limiter, then a per-attempt timeout, with a total timeout over all of it.
  That order is load-bearing: with the limiter outside the retry it would pace *operations*, and
  three attempts would share one permit. Every error body is a `ProblemDetails` with a `traceId`,
  which means writing it through `IProblemDetailsService` and never by hand; the exception itself is
  included in Development only. That `traceId` is the request's W3C trace id, so it is the id the page
  that made the call names (see "One id names a request" below). `/readyz` still answers 200 while IGDB is down, deliberately. See
  `docs/decisions/0034-*`.

- **The rate limiter is narrow on purpose, and the lockout says nothing.** Ten attempts per address
  per five minutes on login and register only — the SSR server calls this API for every visitor, so
  a limit partitioned by address anywhere a loader reaches would throttle the whole site as one
  client. Identity locks an account after five failures but answers exactly as it answers a wrong
  password, because announcing a lockout tells an attacker the account exists. Forwarded headers
  are off until configured, and turning them on without naming the proxy **fails at startup** rather
  than trusting whoever sends the header. Behind CloudFront, **`ForwardLimit` stays 1**: the
  middleware checks each hop against the trust list, and the CDN's address is never in the
  balancer's subnets, so raising it to 2 quietly leaves the limiter partitioned by edge server. The
  balancer preserves the header instead, which is safe only while nothing but CloudFront can reach
  it. See `docs/decisions/0044-*`.

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
  writes a status, over an existing entry as well as a new one. The import never stamps
  `StatusChangedAt` or `ScoredAt`, for the same reason. **An imported playthrough's type is the source's completion level, translated
  by the source**: Grouvee's "Main Story" and "Main Story + Extras" are `normally`, "100% Completion"
  is `completionist`, and nothing imported is `rushed`. A typed run with a duration feeds the
  community medians, so only strings seen in a real export are mapped and anything else stays
  untyped, and a level alone never makes a run — every game Grouvee shelves gets an empty row reading
  "Main Story" (`docs/decisions/0050-*`). Anything later that assumes "every status has an event" —
  an activity feed, an audit, a backfill — has to consult `Origin`. **The activity statistics are
  the reader that no longer assumes it**, and they do not consult `Origin` either: for a game whose
  status changes say nothing
  of that kind they count its playthroughs' dates — finishes from `FinishedOn` unless it has a move
  to Finished, its first start from its earliest date unless it has a move to a started status — so
  a status change always takes precedence, per game and per kind, and every playthrough is read
  whatever its entry's origin — which would not find every imported run anyway, since the import
  sets it only where it writes a status. Drops, the median time to finish and the transition count
  stay events-only, `LogStartedAt` stays the first status change, and no event is ever synthesised
  to make an import count. See `docs/decisions/0026-*`, `0037-*` and `0047-*`.

- **The owner's history is a union of rows, and a score's moment is `ScoredAt`.**
  `/api/user/history` is one `UNION ALL` of the events, the entries' `ScoredAt`, and the
  playthroughs' start and finish dates, paged by an encrypted cursor over (moment, kind, id) and
  never by offset. It adds no event type and writes nothing of the user's. **Only `SetScoreAsync`
  stamps `ScoredAt`**: when the user's score changes, never on a same-score write, cleared with the
  score, never backfilled, never by an import. **Any other path that changes a score must clear
  it**, or the history dates a score at a time nobody gave it — the check constraint refuses only a
  moment with no score — and every write that changes a score goes through
  `EntryStore.WriteScoredAtWithScore`, because EF updates only the columns it saw change and a tab
  that scored the game meanwhile would keep its moment. A playthrough's day sorts at noon UTC and
  goes out as the day; an imported status and an undated score have no item, and the page is told
  how many of each from `Origin` and the null `ScoredAt`s. It lists a run's finish beside a move to
  Finished, where the chart counts one (ADR 0047's precedence is a counting rule), and it is not on
  the public profile. See `docs/decisions/0062-*`.

- **A closed import has no rows, and a review is only ever of a pending job.** A commit or a cancel
  deletes the job's `ImportRow`s in the same `SaveChangesAsync` that closes it (ADR 0037, ADR 0039),
  because by then everything a row held has become a `UserGameEntry` or a count on the job and
  nothing re-serves it. Two things follow that are easy to undo by accident: `CommitAsync` reads its
  rows **tracked**, since attaching no-tracking copies in order to delete them throws whenever the
  same scope already holds those rows; and `GetReviewAsync` scopes to `State == pending`, or
  `/import/{closedJobId}` renders an empty but fully actionable review over an import that is
  already over. What retention then keeps is a receipt — the job row, its file name and its four
  counts. **The per-row failure report is not stored anywhere**: it is built inside the commit's own
  response, so §C5's promise is kept by that response and by nothing else. The client is told when
  a job dies through `ImportJobDto.ExpiresAt` and **never holds a copy of the retention windows** —
  two `TimeSpan`s restated in TypeScript would drift, and where it would show is a screen telling
  somebody their part-finished review is safe for longer than it is. A job already gone answers
  404, which the review screen renders as the end of that import rather than as a retryable error.

- **Scheduled work is a `BackgroundService`, and there are three.** `ImportRetentionService`
  sweeps expired import jobs hourly, and is the shape the others copy (ADR 0038);
  `GameCacheRefreshService` rewrites `CachedGames` rows from IGDB an hour before a reader would find
  them a day old, and `SteamNewsRefreshService` fetches the Steam feeds people are reading before
  they expire (ADR 0052). The CloudFront invalidator is a fourth hosted service, but works a queue
  rather than a clock (ADR 0058). Three things about them are easy to get wrong: a hosted service is a
  **singleton**, so it takes `IServiceScopeFactory` and makes a scope per tick rather than injecting
  the scoped `DbContext`; an exception escaping `ExecuteAsync` **stops the whole host**, so the loop
  catches per tick — `ScheduledWork.AddScheduledWork` registers every scheduled service and is the
  **only** place allowed to configure `HostOptions`, which is what lets a test assert that behaviour
  out of the application's own registration instead of out of a bare `new HostOptions()` that says
  nothing about us; and each runs **once per ECS task**, so the two on the database serialise on
  `pg_try_advisory_xact_lock` — the transaction-scoped variant, because a session lock survives on
  a pooled connection after it is returned. That transaction runs inside
  `db.Database.CreateExecutionStrategy()`, which never retries today and stops either job throwing
  `InvalidOperationException` on the day somebody adds `EnableRetryOnFailure` to `UseNpgsql`:
  **EF refuses a user-initiated transaction under a retrying strategy**, and the job would fail
  into the log on every tick for ever without anything else breaking. A tick that cannot take the
  lock **counts what is waiting** rather than just returning: the try-lock is false when *any*
  session holds the key, so for the sweep, work still expired after six skipped ticks running means
  the holder is not a sweep, and that logs a warning. The refresh cannot use that rule — rows fall
  due all day, so work is nearly always waiting — and warns instead, hourly, while any row is
  **twenty-five hours old**, which no row reaches while the refresh keeps up. A batch whose answer
  cannot be read, or whose write PostgreSQL refuses, is held back an hour rather than retried at the
  head of the queue for ever. It holds its lock
  **across the IGDB request**, so no two tasks pay for the same rows, bounded at fifteen seconds
  because the transaction also holds back any migration of the table; once IGDB has answered it
  **saves and commits on `CancellationToken.None`**: the stopping token bounds the work, not the
  write (#96); the integration suite's `GameCacheRefreshJobTests` runs the lock, that commit and a
  refused write against PostgreSQL. Unlike the sweep it writes tracked rows, so **each attempt clears the change
  tracker** — under a retrying strategy a commit that failed after its save would otherwise leave
  the retry rows already marked saved, and stamp the stale payload fresh. Its pace, one request of
  fifty ids a minute, is the `GameCacheRefresh` section, checked at startup. **The Steam refresh
  takes no lock, deliberately**: what it warms is its own process's memory, so a lock would leave
  every other task's feeds cold, and it refreshes only the feeds read since they were fetched, so
  what it adds is at most one request per feed after its last read. A stalled sweep or refresh is
  deliberately **not** a `/readyz` failure — the instance still serves.
  Retention is two windows, not §S9's one, and **which one applies is decided by
  `CompletedAt`, never by `State`** — `MaxPendingJobs` counts from the same column so the cap and
  the sweep mean the same jobs, and `CK_ImportJobs_Completion` keeps the two columns agreeing.
  Seven days from `CompletedAt` for a closed job, fourteen from `UpdatedAt` for an unfinished one, because a job
  nobody finished reviewing has no completion and would otherwise hold a `MaxPendingJobs` slot for
  ever. **`UpdatedAt` is the last saved decision, never the upload** — every write to a job stamps
  it, so the pending window is silence rather than a deadline, and a review worked through over
  several weekends is not deleted underneath its owner. **`ExecuteDeleteAsync` needs a relational provider**, so the predicate is an `Expression`
  the tests run against InMemory and the deletion itself is not unit-tested — the integration
  suite's `ImportRetentionSweepTests` runs it, batches and lock included, against PostgreSQL
  (`docs/decisions/0057-*`). It deletes **twenty-five jobs per statement and commits each
  batch**, because one unbounded `DELETE` over a backlog exceeds Npgsql's thirty-second default,
  rolls back, deletes nothing, and is retried identically every hour for ever. Each batch
  **commits on `CancellationToken.None`**: the stopping token bounds the work, never the write
  that keeps its result, or a shutdown landing between a batch's `DELETE` and its commit would
  roll back a batch already done, leaving the next sweep to repeat it (ADR 0038 §4). And because it
  deletes rows no request asked it to, **every `ImportService` write stamps the job and treats an
  `UPDATE` that matches no row as "swept"** — the 404 each endpoint already had, rather than the 500
  an unclaimed `DbUpdateConcurrencyException` becomes. Anything else that deletes out from under a
  request owes the same.

- **A new import preset is an `IImportSource`, not a parser.** The seam is file → canonical rows,
  one level up from the column map `specs/csv-list-import.md` proposed, because Grouvee's export is
  a nested document that no column map can describe. Everything after that seam — the review, the
  matching, the conflict check, the commit, the failure report — is shared and must stay
  source-agnostic. A row carrying the source's own IGDB id needs no matching at all, which is why
  **the upload still makes no network call**: matching is a separate endpoint, for the rows a
  source could not name, and keeping it there is what stops an IGDB outage turning "store my file"
  into "nothing matched" (ADR 0037).

- **The matcher would rather not answer, and most of what makes that true is not obvious.**
  `ImportMatching` decides which IGDB game a title names, and every rule in it exists because a
  wrong automatic match is pre-checked on the review screen and writes a game its owner never
  played into a library nobody audits, while a missed one costs a click (ADR 0040). Six things are
  easy to undo by accident. **There are two keys and only one of them may answer**: `Normalise`
  decides a match, `WithoutEdition` may only *offer* a candidate — move edition-stripping into the
  first and "Dark Souls" stops being an offer to somebody importing "Dark Souls Remastered" and
  becomes a silent answer. **IGDB holds a row per release, not per game**, so §M2's "exact title,
  single candidate" fires for almost nothing real — seven rows are titled exactly "Final Fantasy
  VII" — and what separates the canonical row from its re-release stubs is `RatingCount`, read as
  *how many people track this row* and never as a score. **Truncating a candidate list
  manufactures confidence rather than costing a match**: the dominance rule can only weigh what it
  is shown, so `CandidatePool` is a whole page of twenty and the decision is made over everything
  that cleared the floor, with §M3's cut to five applied afterwards. **The search term is the
  user's own spelling** (`Tidy`), not the normalised key — IGDB's search is not fuzzy, folds
  numerals itself, and ranks the real Ocarina of Time lower when the article is stripped, so
  rewriting the term is guessing at somebody else's tokeniser. **`unlooked` and `unmatched` are
  different states and both are needed** — nobody has asked, against somebody asked and IGDB had
  nothing — because collapsing them makes every pass re-ask the questions the last one failed; a row
  with no id is born `unlooked`, and a pass selects on it. And **an IGDB failure is a 502, never
  "nothing matched"** — one is a sentence somebody acts on by trying later, the other by giving up.
  The roman-numeral fold stops at thirty because the cap *is* the guard: `MIX` is a canonical 1009.

- **A matching pass answers with the rows it examined, never the review.** `POST
  /api/import/jobs/{id}/match` resolves a bounded batch and the client repeats it, so returning the
  whole job each time is quadratic where it hurts most: the five-thousand-row id-less export this
  exists for is ~250 passes, and rebuilding the review on each is about a gigabyte of JSON to import
  one file. The client merges what came back and **stops when a pass hands back no row it moved** —
  an exact fact rather than a count diffed between snapshots, and the thing standing between a bug
  and a browser tab hammering IGDB for ever. Every `ImportService` write goes through
  `SaveTouchingAsync`, which is where the retention stamp and the swept-mid-request 404 live
  together; a new write that stamps by hand gets one of the two wrong.

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

- **Every colour is a token from `src/theme.css`, and `npm run lint` refuses any other.** Style
  anything new with them:
  - as classes, such as `bg-surface`, `text-fg-muted`, `border-line` and `bg-primary-600`;
  - as `var(--color-surface)` in a stylesheet;
  - with an opacity on the token for a translucent colour: `bg-page/95`, or
    `color-mix(in srgb, var(--color-page) 95%, transparent)`.

  Never write a hex, an `rgb()`, a named colour or a Tailwind palette class such as `text-slate-400`,
  and not `var(--color-slate-400)` either. When no token fits, add one to `theme.css`, named for its
  job, not its look. The one exception is translucent black and white, for shadows and scrims.

  There is one theme, dark, and no `light:` variant (ADR 0048). A change meant to look the same is
  checked with `npm run visual`. See `docs/decisions/0049-*`.

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
  failure. Note four traps: a thrown `Response`'s headers are replaced by the boundary route's
  (the root reads `errorHeaders` to honour them); a page that fails *while rendering* is re-rendered
  as its error boundary over the headers React Router computed for the page — a game page's hour
  at the edge included — so `entry.server.tsx` sets `private, no-store` on any 5xx itself; a loader
  that degrades to a 200 has to attach `no-store` itself via `data()`; and an *API* that degrades to
  a 200 has to say so in its payload, because neither the loader nor a CDN can tell that 200 from a
  healthy one. `/api/home` does, with
  `degraded`, and the loader reads it failing closed — only an explicit `false` is shared-cached.

- **`fetch` rejects when the API is unreachable** — it does not return `!response.ok`. A loader
  that only checks `response.ok` turns a dead upstream into an unhandled 500. Wrap it and throw
  a deliberate 502. The same trap catches an optimistic mutation: with no `catch`, the change
  stays on screen as though it saved, and the rejection escapes unhandled.

- **`useUserStats` takes the account id, and that parameter is the guard.** It is mounted on the
  home page, which outlives a sign-out, so it follows the whole of the shape ADR 0022 settled on for
  the list providers: the account lives in reducer state beside the data, the transition is applied
  during render, and every completion is stamped with the account it was started for and dropped on
  a mismatch. The `AbortController` is not the guard — the abort runs in the effect cleanup, after
  the commit. Passing a constant, a boolean, or dropping the parameter puts one account's data under
  another's name. Apply the same shape to any new account-scoped hook.

- **Loaders run on the server**, where a relative URL has no origin. A loader calls the API with
  `loaderFetch(context, path)` from `@/lib/trace.server`, which resolves the path as `apiUrl()` does
  and sends the render's trace.

- **One id names a request from the page to the API's log, and a log line never carries a query
  string, a header or a form.** The root's middleware draws a W3C trace for every request React Router
  routes and answers with it in `X-Trace-Id`; `loaderFetch` sends it as `traceparent`, and the API
  continues it, so its log lines carry it as `TraceId` and its `ProblemDetails` as `traceId`. The lint
  refuses an import of `apiUrl` outside `@/lib/api` and `loaderFetch`, because the API would log a call
  made any other way under a trace of its own. A loader whose call failed throws
  `upstreamFailure(context, message)`, which is what puts the id on the error page, and a call that
  never reached the API is logged by `loaderFetch`, the one failure the API has no line for. Outside Development the API logs one JSON object per line, every scope included,
  and one line per request with its status; never lower `Microsoft.AspNetCore` below `Warning`, whose
  own request lines print the query, and a search can be an email address. `TraceIds.UseW3COnly()` in
  `Program.cs` is what stops a later-version `traceparent` writing its own text into every line. See
  `docs/decisions/0059-*`.

- **Never touch `window`, `document` or `localStorage` during render or in a `useState`
  initializer** — it breaks SSR. Read browser-only state through `useSyncExternalStore` with a
  fixed server snapshot, as `@/lib/useHydrated` does.

- **Route types** (`./+types/*`) are generated by `react-router typegen` into
  `.react-router/`. Bare `tsc` fails; run `npm run typecheck`.

- **New projects need no gitignore work** — build-output patterns are project-agnostic
  (`[Bb]in/`, `[Oo]bj/`). They were hardcoded per project once and leaked 112 DLLs.

## Conventions

Path-scoped conventions live in `.claude/rules/`: `backend.md` for C# and `frontend.md`
for the client. They load automatically when you work on matching files.

## Open work

The plan is the repository's GitHub issues, not a file. `gh issue list --label feature` is the
product work, `--label platform` the deployment, operations and quality work, and
`--label question` a decision still open with no feature attached; a `needs: …` label names the
gate an issue waits behind, and the pinned **What's next** issue holds the order. Before starting
on something, `gh issue view <n>`: the issue says what is already decided, with links to the
records and specs, and what is still open. A follow-up noticed mid-task goes into an issue — a
new one, or a checklist line on the feature's — never into a plan file. `ROADMAP.md` is the map
from the old plan's identifiers (`D12`, `N3`, `P5`, …), which code comments and records still
cite, to where each item lives now. See `docs/decisions/0041-*`.

## Decisions

`docs/decisions/` records architectural decisions and the reasoning behind them. Read the
relevant record before changing anything it covers, and add one when you make a call that
future work would otherwise have to reverse-engineer. The ADRs are why the code is the way it
is; the issues are what is still to do.
