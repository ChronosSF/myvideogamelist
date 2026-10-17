# 0060. One browser test over the production shape: two processes, a stand-in for the distribution, and IGDB answered over HTTP

**Status:** Implemented. Built for #105. Closes what [0003](0003-two-process-deployment.md) left open
as "no way to run the built app end to end locally until something plays CloudFront's role", for a
test rather than for a developer: `npm start` still has no proxy.

## Context

The front end and the API are two processes, and neither routes to the other (0003). Deployed, the
distribution does: `/api/*` to the API, everything else to the SSR server (`infra/src/Infra/Edge.cs`,
and the balancer's rules in `AppStack.cs`). Take that routing away and the site half-works, which
0003 calls worse than failing outright. The pages render, because their loaders reach the API
directly through `API_BASE_URL`. Every request the browser makes to `/api` then 404s on the SSR server:
the session check, the sign-in, every list.

Nothing tested for that. The unit suites test each side alone, and [0057](0057-the-api-is-tested-over-a-real-postgresql.md)'s
integration suite boots the API in-process and talks to it directly. Only a browser in front of both,
going through whatever routes between them, sees the failure. So the issue asked for one browser test,
"sign up, add a game to a list, reload, it is still there", in CI.

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

### 1. The servers under test run as they are deployed

- **The front end** is built with `react-router build` and served by `react-router-serve
  ./build/server/index.js`, the same command the SSR image runs, with `NODE_ENV`, `PORT` and
  `API_BASE_URL` set as the image and its task definition set them. One difference: `HOST` is
  `127.0.0.1`. The task leaves it unset so that the balancer can reach the server, which on a
  developer's machine would put it on the network.
- **The API** runs under `dotnet run --no-launch-profile`, a process of its own, configured by
  environment variables and nothing else.
- **Playwright's `webServer` starts both**, waits until each answers, and stops both afterwards.
  `reuseExistingServer` is off, so a port somebody else already holds fails the run rather than
  putting their server under test.

### 2. A stand-in for the distribution, with its two behaviours and nothing else

A reverse proxy of a few dozen lines on `node:http` sends `/api/*` to the API and everything else to
the SSR server. It passes every end-to-end header on, `Host` and cookies included, as the
distribution's `/api/*` behaviour forwards every viewer header, and returns each `Set-Cookie` as it
came. The browser opens the stand-in, as a reader opens the site.

It has nothing else of the distribution: no cache, no basic auth, no origin-verify header, no TLS.
None of those is what 0003's failure is about. It serves plain HTTP on `localhost`, where Chromium
accepts the API's `Secure` cookie: a browser treats `localhost` as a secure origin.

**Verified both ways.** With the stand-in's first behaviour taken out, so that everything went to the
SSR server:

- the game page still rendered, with a 200;
- the browser's requests for the session, the member scores, the reviews and the news were each a
  404 from the SSR server, and the registration a 405;
- the test failed at its "sign up" step, with "Registration failed" on the screen and its trace kept.

With `/api` sent to a closed port instead, it failed at the same step.

Rejected:

- **Playwright's request routing** (`page.route`) in place of a proxy. It intercepts inside the
  browser and re-sends each request itself, so which cookies went where would be Playwright's to
  decide. A real proxy is what the browser meets when deployed, and it costs no more.
- **The dev server**, for the reason above.
- **nginx or another proxy as a dependency.** One more thing to install on every machine and in CI,
  for two lines of routing.

### 3. IGDB answered over HTTP, through two settings

The API's IGDB client now reads where to send its requests: `Igdb:BaseUrl` for the queries and
`Igdb:TokenUrl` for Twitch's token. Empty means IGDB's own address and Twitch's, which is what every
deployment uses. This is the only change to production code, and nothing in the code knows it is
being tested.

The smoke test points both at a stand-in for IGDB, on the same machine. It answers as follows:

- **Twitch's token endpoint** issues a token, for its own client id and secret only.
- **Every query** must carry that token.
- **A lookup of its one game by id** gets that game. The game page's query is one, and so is the game
  cache's.
- **Every other query** gets an empty list: a Steam id, completion times, a release date. That is what
  IGDB says about a game it knows little about. So no Steam id is found, and the API never asks Steam
  for news.

The game has no cover, artwork or video, so the browser is never sent to IGDB's image host or to
YouTube. Its id is 2,000,000,105, far past any real IGDB id, so it cannot collide with a real game
cached in a copy of a developer's database.

The API is given the stand-in's credentials as environment variables, which take precedence over user
secrets. Development still loads a developer's real IGDB credentials, but they are never used and
never sent anywhere.

So this runs the real `IgdbService` end to end: its query builder, its token handling, the mapping
from IGDB's JSON, and [0034](0034-failing-in-one-shape.md)'s pipeline. A field list or a mapping that
blanks the game page fails here.

Rejected:

- **0057's seam: an in-process host with `IIgdbService` replaced.** `WebApplicationFactory` in 10.0
  can listen on a real port (`UseKestrel`), so a small driver could boot the API that way, with no
  production change at all. But it is not the deployed process. Services are replaced, hosted
  services removed and the environment is `Testing`. It would also be a C# project to build and keep
  in step, and its IGDB double would sit above the HTTP client, so none of the client code above
  would run. The stand-in at the HTTP boundary exercises all of it for the price of two settings.
- **An HTTPS proxy in front of IGDB's real addresses**, which would need no setting. It would have
  to present a certificate for IGDB's name.

### 4. One database, which the API migrates itself

- **The API runs as Development** for the one thing Development does that a deployment's migration
  task does instead: it migrates its own database as it starts. Development also leaves out the HTTPS
  redirect, so the API answers plain HTTP, as the balancer forwards it.
- **Locally,** the database is `mvgl_e2e` on the compose container. EF creates it on the first run
  (verified against an empty server: it was created and all 21 migrations were applied).
  `E2E_CONNECTION_STRING` points the run elsewhere.
- **In CI,** it is a service container with `compose.yaml`'s image and credentials. The image creates
  the database, so the API only migrates it, and the default connection string is the same in both
  places.
- **It is never reset.** Each run registers an account of its own, `e2e_` followed by the time and four
  random characters, and reads nothing it did not write.

Not Testcontainers, as 0057 uses. The API is a separate process that needs its connection string as
it starts, and a service container is GitHub's own mechanism, with a health check and no Node
dependency.

Development has other effects too, none on the path under test:

- it loads user secrets, overridden for IGDB above;
- it uses the developer's default key ring, which [0043](0043-where-the-key-ring-lives.md) already
  calls harmless and shared by every checkout;
- it puts exception text in error bodies;
- it maps the OpenAPI document.

### 5. The test

One test, the issue's, in `myvideogamelist.client/e2e/` beside the visual suite and on the same pinned
Playwright:

1. Open the stand-in's game page.
2. Sign up through the dialog.
3. Press **Playing** and wait for the API to answer the write. The button moves before the answer
   comes, because the update is optimistic, so reloading before it would race the write.
4. Reload. The button is still pressed.
5. Open the lists page. The game is listed.

Every step crosses the routing:

- the session check;
- the registration;
- the write, with its header from `apiFetch`;
- the lists, through the game cache, which asks the stand-in for a game it has not stored.

Three settings keep it deterministic:

- **The browser may reach the stand-in and nothing else.** Any other origin is aborted, so a third
  party a page may one day load cannot make it slow or flaky. Nothing does today.
- **No retries.** A retry would hide a failure that happens only sometimes.
- **The trace is kept on failure.**

`npm run e2e` builds the front end and then runs the test. Measured on a developer machine: 3 to 6 s
for the test itself, and about 16 s for the whole run, both servers' starts included. Against an empty
database it took 28 s, because of the migrations.

### 6. CI runs it as a job of its own

`e2e` ("End-to-end smoke test") in `ci.yml`, after the integration job, on `ubuntu-latest`. Its steps:

1. Start the service container.
2. Install the Chromium headless shell and the system libraries it needs, which is all a headless run
   launches.
3. Build the API in a step of its own, so that a compile error is not reported as a server that never
   started.
4. Run `npm run e2e`.
5. On failure, upload `e2e/test-results` (the trace and a screenshot) for fourteen days.

A fifteen-minute timeout bounds a hang. Deploy dev waits on this job as on every other.

## Consequences

- **`npm run e2e` needs PostgreSQL up and its four ports free.** The ports are 5120, 58620, 58621 and
  58622, clear of the 5039 and 58546 that `dotnet run` and `npm run dev` take. The run builds the
  front end every time, and `dotnet run` builds the API when its sources have changed. A developer's
  own `dotnet run` from the same checkout holds the build output, so stop it first if the API needs a
  rebuild.
- **A page the test visits that asks IGDB something new gets an empty answer.** If the page needs
  more, the stand-in in `e2e/stand-ins.ts` grows to answer it. The stand-in is not a model of IGDB.
- **A green run's log can show a `fail:` line for `PK_CachedGames`.** After the reload, two requests
  miss the cache for the same game at once. The code handles that on purpose, but EF has already
  logged it as an error. That is #304, and it was there before this test.
- **Not covered:** TLS; the edge's basic auth and cache behaviours; whether CloudFront forwards
  `X-MVGL-Request`, which 0033 requires of it; forwarded headers; the deployment's migration bundle;
  Parameter Store; the published Release build of the API.
- **`IgdbService` reads two more settings**, documented in `appsettings.json`. A deployment that sets
  neither behaves exactly as before.
- **`postgres:18-alpine` is now in three files**: `compose.yaml`, 0057's `PostgresServer`, and this
  job's service container. It is the tag 0057 notes can move, and each file says to change the three
  together.
- **Playwright is pinned** (`@playwright/test` 1.63.0), for the visual suite as before. A bump means
  installing that version's browser once on a developer's machine. CI installs it on every run.
