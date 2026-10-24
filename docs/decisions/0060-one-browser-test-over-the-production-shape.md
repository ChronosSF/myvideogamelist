# 0060. One browser test over the production shape: two processes, a stand-in for what routes between them, and IGDB answered over HTTP

**Status:** Implemented. Built for #105. Closes what [0003](0003-two-process-deployment.md) left open
as "no way to run the built app end to end locally until something plays CloudFront's role", for a
test rather than for a developer: `npm start` still has no proxy. Departs from
[0057](0057-the-api-is-tested-over-a-real-postgresql.md) in one place, which §4 says and defends: a
local run keeps a database of its own on the developer's PostgreSQL server. The images it lists as
not covered are built in CI, and the SSR one started, by [0061](0061-ci-gates-every-pull-request.md),
whose secret scan allows the local credentials in the four files named here.

## Context

The front end and the API are two processes, and neither routes to the other (0003). Deployed, the
balancer does, behind the distribution: its listener sends `/api/*` to the API and everything else
to the SSR server, with `/healthz` and `/readyz` also to the API (`infra/src/Infra/AppStack.cs`). The
distribution has one origin, the balancer, and decides only what is cached and forwarded (`Edge.cs`).
Take the routing away and the site half-works, which 0003 calls worse than failing outright. The
pages render, because their loaders reach the API directly through `API_BASE_URL`. Every request the
browser makes to `/api` then fails on the SSR server, a read with a 404 and a write with a 405: the
session check, the sign-in, every list.

Two checks already go through the real edge, both after a deploy. Deploy dev's smoke test asks for
`/readyz` and `/` through the distribution, and `scripts/dev-check.mjs` asks for a game's member data
through it and checks that the write guard survives it. Nothing ran a browser against the production
build of the front end, and nothing checked before a merge that the pages send their requests where
something can route them. The unit suites test each side alone, and 0057's integration suite boots the
API in-process and talks to it directly. So the issue asked for one browser test in CI: "sign up, add
a game to a list, reload, it is still there".

Four facts shaped the answer:

- **CI has no IGDB credentials and must not need them.** A developer's user secrets hold the real
  ones, and Development loads them.
- **Adding a game needs IGDB.** The game page is a live query for that game's details. The list then
  renders through the game cache ([0035](0035-a-local-copy-of-what-igdb-said.md)), which asks IGDB
  for any game it has not stored.
- **Every write needs `X-MVGL-Request`** ([0033](0033-what-the-api-refuses.md)), which only `apiFetch`
  adds. A write made by the real client in a real browser proves that as well.
- **The dev server cannot show the failure.** `npm run dev` is Vite's dev server, which renders
  pages *and* proxies `/api` itself. It is the one arrangement in which 0003's failure cannot happen,
  and it serves modules unbundled, not the build that ships.

## Decision

### 1. The servers under test are the two processes, run on their own

- **The front end** is built with `react-router build` and served by `react-router-serve
  ./build/server/index.js`, the command the SSR image runs, with `NODE_ENV`, `PORT` and `API_BASE_URL`
  set as the image and its task definition set them. Two differences. `HOST` is `127.0.0.1`: the task
  leaves it unset so that the balancer can reach the server, which on a developer's machine would put
  it on the network. And `SITE_URL` is unset, so no page names a canonical URL and every response says
  `noindex` ([0036](0036-what-a-crawler-is-told.md)).
- **The API** runs under `dotnet run --no-launch-profile`, a process of its own, given what is
  particular to the run through environment variables rather than a launch profile. It runs as
  Development, which nothing deployed does; §4 says why.
- **Playwright's `webServer` starts both**, waits until each answers, and stops both afterwards. It
  refuses to start a run when something already answers on either port, so a server somebody else is
  running is never put under test.

### 2. A stand-in for what routes between them

A reverse proxy of a few dozen lines on `node:http`, in front of both, routes as the balancer does:
`/api/*` to the API, everything else to the SSR server. The balancer's rule for `/healthz` and
`/readyz` is left out, since no page asks for either. Outside `/api/*` the distribution allows only GET
and HEAD, and so does the stand-in. The browser opens the stand-in, as a reader opens the site.

It passes every end-to-end header on, `Host` and cookies included, as the distribution does on the way
to the API, and returns each `Set-Cookie` as it came. It does the same on the way to the SSR server,
where the distribution's cached behaviour forwards `Host` and the cache key's query strings and
nothing else. Of a request's headers, the render reads only the user agent, to decide whether to
stream or to wait for the whole page for a crawler (`entry.server.tsx`), so nothing here depends on
the difference; the consequences list it as not covered.

It has nothing else of the two: no cache, no basic auth, no origin-verify header, no TLS. None of
those is what 0003's failure is about. It serves plain HTTP on `localhost`, where Chromium still
accepts the API's `Secure` cookie, because it treats `localhost` as a secure origin. The test shows
it: the session survives the reload.

**Verified both ways.** With the stand-in's routing taken out, so that everything went to the SSR
server:

- the game page still rendered, with a 200;
- the browser's requests for the session, the member scores, the reviews, the completion times and
  the news were each a 404 from the SSR server, and the registration a 405;
- the test failed at its "sign up" step, with "Registration failed" on the screen and its trace kept.

With `/api` sent to a closed port instead, it failed at the same step.

What this catches is the application's half: a page that sends a request somewhere nothing routes, or
a cookie or a header that does not survive a proxy. The stand-in's routing is copied by hand from the
infrastructure, so whether the deployed edge still routes is not this test's to say; that stays with
`dev-check.mjs` after a deploy.

Rejected:

- **Playwright's request routing** (`page.route`) in place of a proxy. It would rewrite the browser's
  requests from inside the browser, so what was tested would be Playwright's interception rather than
  what the browser meets deployed: a server in front that it reaches over a socket. That server costs
  no more.
- **The dev server**, for the reason above.
- **nginx or another proxy as a dependency.** One more thing to install on every machine and in CI,
  for two lines of routing.

### 3. IGDB answered over HTTP, through two settings

The API's IGDB client now reads where to send its requests: `Igdb:BaseUrl` for the queries and
`Igdb:TokenUrl` for Twitch's token. Empty means IGDB's own address and Twitch's, which is what every
deployment uses. This is the only change to production code, and nothing in the code knows it is
being tested.

The browser smoke test points both at a stand-in for IGDB, on the same machine. The stand-in answers
as follows:

- **Twitch's token endpoint** issues a token, for its own client id and secret only.
- **Every query** must carry that token.
- **A lookup by id** of any of its games gets them. It knows every id from 2,000,000,000 up, each with
  the same title, far past any real IGDB id and still an `int` to the API. The game page's lookup is
  one, and so is the game cache's.
- **Every other query** gets an empty list: a Steam id, completion times, a release date. That is what
  IGDB says about a game it knows little about. So no Steam id is found, and the API never asks Steam
  for news.

**Each run looks at a game no run before it has.** Its id comes from the clock, and repeats only after
more than a day, by when the API's copy of that game would be refreshed anyway. So the game cache asks
the stand-in for it on every run, locally as in CI, and nothing an earlier run left in that cache can
answer for this one. A fixed game would have let every local run within a day of the first one skip
the cache's lookup, and would have kept an old title on the lists page for a day after the stand-in's
changed.

The games have no cover, artwork or video, so the browser is never sent to IGDB's image host or to
YouTube.

The API is given the stand-in's credentials as environment variables, which take precedence over user
secrets. Development still loads a developer's real IGDB credentials, but they are never used and
never sent anywhere.

So this runs the real `IgdbService` end to end: its queries, its token handling, the mapping from
IGDB's JSON, and [0034](0034-failing-in-one-shape.md)'s pipeline. A mapping that loses the title fails
here. A field list cannot: the stand-in sends the same three fields whatever a query asks for.

Rejected:

- **0057's seam: an in-process host with `IIgdbService` replaced.** `WebApplicationFactory` in 10.0
  can listen on a real port (`UseKestrel`), so a small driver could boot the API that way, with no
  production change at all. But it is not the API's own process. Services are replaced, hosted
  services removed and the environment is `Testing`. It would also be a C# project to build and keep
  in step, and its IGDB double would sit above the HTTP client, so none of the client code above
  would run. The stand-in at the HTTP boundary exercises all of it for the price of two settings.
- **An HTTPS proxy in front of IGDB's real addresses**, which would need no setting. It would have
  to present a certificate for IGDB's name.

### 4. One database, which the API migrates itself

**The API runs as Development.** Everything deployed runs as Production, dev included
([0044](0044-what-the-deployment-walkthrough-settled.md)), because the application's one environment
switch, `IsDevelopment()`, turns on things nothing deployed may have. This test turns it on for one of
them: the API migrates its own database as it starts, which deployed is a separate migration task. The
others it also turns on, none of them on the path under test:

- **User secrets.** IGDB's are overridden above. Anything else a developer keeps there loads too, an
  admin's id or a social login's keys, and nothing the test does reads them. A runner has none.
- **The developer's default key ring**, which [0043](0043-where-the-key-ring-lives.md) already calls
  harmless and shared by every checkout.
- **Exception text in error bodies**, and the OpenAPI document.

It listens on plain HTTP, as the balancer forwards to it, and Development also leaves out HSTS and the
HTTPS redirect. Production would not redirect here either: with no HTTPS port the redirect finds
nowhere to go and carries on, as 0044 found.

Rejected: **Production, with `DataProtection:AllowEphemeralKeys` and the migrations applied first**,
by `dotnet ef database update` or by the migration bundle the API image carries. That is the
deployed environment, and the image's bundle stage already runs that way. But it puts a tool, or a
bundle built for the run, on every machine and in CI, and a step before the API can start. It makes
this test a third user of `AllowEphemeralKeys`, a flag 0043 meant for a developer's machine and 0057
had to amend 0043 to use. And nothing this test asserts depends on what `IsDevelopment()` switches. If
the API's behaviour under Production ever needs a browser in front of it, this is the change to make.

**Where the database is:**

- **Locally,** it is `mvgl_e2e` on the compose container. EF creates it on the first run (verified
  against an empty server: it was created and all 21 migrations were applied). `E2E_CONNECTION_STRING`
  points the run anywhere else.
- **In CI,** it is a service container with `compose.yaml`'s image and credentials. The image creates
  the database, so the API only migrates it, and the default connection string is the same in both
  places.
- **It is never reset.** Each run registers an account of its own, `e2e_` followed by the time and four
  random hex digits, and looks at a game of its own, so no run reads a row another left.

**The departure from 0057.** 0057 kept every automated test off `mvgl-postgres`, the compose
container, because a developer's own data lives there. A local run of this test writes to that
server: it creates `mvgl_e2e` there, as the server's superuser, and adds an account to it on every
run. That is accepted, for three reasons:

- it is a database of its own, and `myvideogamelist` is never touched;
- it happens only when a developer runs the test, never in CI, where the server is the service
  container;
- dropping it costs nothing, since the next run creates it again.

The alternative, a server started and removed by the run, would need the run to manage a container
the API has to find before it starts, which Playwright's order of setup does not allow without more
machinery than the test itself.

Not Testcontainers, as 0057 uses. The API is a separate process that needs its connection string as it
starts, and a service container is GitHub's own mechanism, with a health check and no Node dependency.

### 5. The test

One test, the issue's, in `myvideogamelist.client/e2e/` beside the visual suite and on the same pinned
Playwright:

1. Open the game page of this run's game.
2. Sign up through the dialog.
3. Press **Playing** and wait for the API to answer the write, which must be a 204. The button moves
   before the answer comes, because the update is optimistic, so reloading before it would race the
   write.
4. Reload. The button is still pressed.
5. Open the lists page. The game is listed.

Every step crosses the routing:

- the session check;
- the registration;
- the write, with its header from `apiFetch`;
- the lists, through the game cache, which asks the stand-in for this run's game when the reload
  first asks for it.

Three settings keep it deterministic:

- **The browser may reach the stand-in and nothing else.** Any other origin is aborted, so a third
  party a page may one day load cannot make it slow or flaky. Nothing does today.
- **No retries.** A retry would hide a failure that happens only sometimes.
- **The trace is kept on failure.**

`npm run e2e` builds the front end and then runs the test. Measured on a developer machine: 3 to 9 s
for the test itself, and 11 to 16 s for the whole run once the API is built, both servers' starts
included. A run against an empty database took 28 s.

### 6. CI runs it as a job of its own

`e2e` ("Browser smoke test") in `ci.yml`, beside the integration job, on `ubuntu-latest`. Its steps:

1. Start the service container.
2. Install the Chromium headless shell and the system libraries it needs, which is all a headless run
   launches.
3. Build the API in a step of its own, so that a compile error is not reported as a server that never
   started. The test then runs that build as it is, without building again.
4. Run `npm run e2e`.
5. On failure, upload `e2e/test-results` (the trace and a screenshot) for fourteen days, under a name
   that carries the attempt, so that a re-run of a failure uploads a trace of its own.

A fifteen-minute timeout bounds a hang.

Deploy dev runs only after a green CI run, so this job is part of that gate: a red run holds back that
commit's dev images until it is re-run. It can fail in more places than the other jobs — a package
install, an image pull, a browser — and it has no retries, so the first thing to do with a failed test
is to download its trace, before re-running anything.

The service container's image is pulled from Docker Hub without signing in, as 0057's are. 0057's
remedy for a refused pull, a login before the tests, cannot reach it: a service container is pulled
before any step runs. It would take `credentials:` on the service itself.

What it costs, measured on its first run (#311, a throwaway draft of this branch against `master`):
66 s of runner time. The service container took 9 s to start, the browser and its libraries 15 s to
install, and the API 12 s to build. The test step took 10 s, for the front end's build, both servers'
starts, the migrations of an empty database and the test itself. The rest was setting up. Standard
runners cost nothing on a public repository, and the C# CodeQL job took 2:48 on the same run and stays
the slowest, so CI as a whole takes no longer than it did.

## Consequences

- **`npm run e2e` needs PostgreSQL up, a Chromium for the pinned Playwright, and four ports free.**
  The browser is installed once with `npx playwright install chromium`. The ports are 5180 to 5183:
  clear of the 5039 and 58546 that `dotnet run` and `npm run dev` take and of the 5139 and 58646 a
  worktree previews on, and below 32768, out of the range Windows and Linux hand out for outgoing
  connections and in which Windows reserves blocks at boot. The run builds the front end every time,
  and `dotnet run` builds the API when its sources have changed (in CI the job has already built it).
  A developer's own `dotnet run` from the same checkout holds the build output, so stop it first if
  the API needs a rebuild.
- **A page the test visits that asks IGDB something new gets an empty answer.** If the page needs
  more, the stand-in in `e2e/stand-ins.ts` grows to answer it. The stand-in is not a model of IGDB.
- **A green run's log shows errors and a warning that are not failures.**
  - After the reload, two requests miss the cache for this run's game at once. The code handles that
    on purpose, but EF has already logged the failed insert, twice, as errors. That is #304, and it
    was there before this test; since every run's game is new, most runs show it.
  - On an empty database, which is every CI run, EF also logs an error while it finds that there is no
    history table yet, before it migrates. 0057 keeps that out of its suite by migrating through a
    context of its own, which an API run as its own process cannot do.
  - On Linux, Data Protection warns that the key it makes is stored unencrypted. On a runner thrown
    away after the job, that is nothing.
- **Not covered:**
  - TLS, and the edge's basic auth and cache behaviours, including what the cached ones withhold from
    the SSR server: a loader that came to read a cookie or a header would pass here and fail deployed.
  - Whether the deployed edge routes `/api/*` and forwards `X-MVGL-Request`, which 0033 requires of
    it. `dev-check.mjs` checks both after a deploy.
  - Forwarded headers.
  - The API's Production environment and the migration bundle the deploy runs.
  - The images themselves. The SSR image installs production dependencies only, so a runtime import
    of a devDependency would pass here and fail deployed.
  - Parameter Store, and the published Release build of the API.
- **`IgdbService` reads two more settings**, documented in `appsettings.json`. A deployment that sets
  neither behaves exactly as before.
- **`postgres:18-alpine` is now in three files**: `compose.yaml`, 0057's `PostgresServer`, and this
  job's service container. It is the tag 0057 notes can move, and each file says to change the three
  together.
- **The local container's credentials are committed in four files now**: `compose.yaml`,
  `appsettings.Development.json`, this test's config and its CI job. They reach nothing beyond a
  developer's machine or a runner, and secret scanning (#106) has to allow all four.
- **Playwright is pinned** (`@playwright/test` 1.63.0), for the visual suite as before. A bump means
  installing that version's browser once on a developer's machine. CI installs it on every run.
