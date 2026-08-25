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
| `npm run build` | Production build |
| `dotnet test MyVideoGameList.Server.Tests/MyVideoGameList.Server.Tests.csproj` | Server unit tests |
| `dotnet ef migrations add <Name>` | From `MyVideoGameList.Server/` |
| `dotnet ef database update` | Applies migrations by hand; only needed outside Development |
| `docker compose up -d --wait` | Local PostgreSQL. `--wait` blocks until it accepts connections |
| `docker compose down` | Stops it, keeping data. **`down -v` destroys the data volume** |

Health endpoints: `/healthz` (liveness, no dependency checks) and `/readyz` (database and
IGDB reachability). A degraded IGDB returns 200, not 503 — browsing breaks but stored lists
still work, so the instance should stay in rotation.

## Layout

```
MyVideoGameList.Server/         ASP.NET Core 10 API
  Controllers/  Services/  Models/  DTOs/  Data/  HealthChecks/
MyVideoGameList.Server.Tests/   xUnit tests
myvideogamelist.client/
  src/root.tsx                  HTML document, providers, global ErrorBoundary
  src/routes.ts                 Route table
  src/pages/                    Route modules (default export + optional loader/meta)
  src/lib/                      apiUrl(), useStoredNumberSet()
docs/decisions/                 Architecture decision records
docs/data-model-plan.md         Schema the roadmap implies, by table, with sequencing
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

- **IGDB is the source of truth for game data.** There are no local game/genre/platform
  tables; they were removed. `UserGameList.GameId` holds an IGDB id and has no foreign key.
  A local metadata cache is planned but must be keyed on IGDB ids.

- **IGDB's `external_games.category` no longer exists.** Use `external_game_source` (Steam is
  `1`). Filtering on the removed field returns zero rows *silently* rather than erroring, so the
  symptom is an empty feature with a clean log. Suspect this whenever an IGDB filter returns
  nothing — check the field still exists before debugging your own code.

- **Steam news and the trending rail hold no database state**, deliberately, so the pending
  PostgreSQL move stays as cheap as it is today. See `docs/decisions/0012-*`. Keep derived,
  regenerable, TTL'd data in `IMemoryCache`; do not add a table for it.

- **A score without its review count is not shippable.** IGDB's `aggregated_rating` is an
  unweighted mean with no minimum, so a game with one perfect review scores 100. Every score in
  `GameDto` travels with its count, the browse query requires
  `aggregated_rating_count >= 8`, and the client suppresses badges below
  `MIN_CRITIC_REVIEWS`. Search is deliberately *not* filtered this way. See
  `docs/decisions/0016-*`.

- **Two game field lists, and putting a field in the wrong one fails quietly.**
  `GameListFieldList` feeds every query; `GameDetailFieldList` is concatenated onto it only by
  `GetGameByIdAsync`, which is why `GameDto.Details` is null everywhere else. A field a *listing*
  needs that lands in the detail list is null in every grid and populated on exactly one page.
  See `docs/decisions/0017-*`.

- **Every route must declare a `Cache-Control` via its `headers` export**, because CloudFront
  applies its own default TTL when the origin sends none. The root default is `private,
  no-store` so forgetting fails closed. Policies live together in `@/lib/cache`; see
  `docs/decisions/0013-*`.

- **A degraded or error response must never be cacheable.** Caching a failure outlives the
  failure. Note two traps: a thrown `Response`'s headers are replaced by the boundary route's
  (the root reads `errorHeaders` to honour them), and a loader that degrades to a 200 has to
  attach `no-store` itself via `data()`.

- **`fetch` rejects when the API is unreachable** — it does not return `!response.ok`. A loader
  that only checks `response.ok` turns a dead upstream into an unhandled 500. Wrap it and throw
  a deliberate 502.

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
