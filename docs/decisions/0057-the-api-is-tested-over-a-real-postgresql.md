# 0057. The API is tested over a real PostgreSQL: one container a run, a database a class, and IGDB out of reach

**Status:** Implemented. The export-snapshot test went in skipped, waiting for #263.
**Amends:** [0043](0043-where-the-key-ring-lives.md), which gave `AllowEphemeralKeys` one purpose;
the integration suite's test host is a second.

Built for #104. Closes what [0024](0024-the-ownership-contract.md) left to "an integration test
against a real database" and [0038](0038-where-scheduled-work-lives.md) to "a relational provider",
and what #95 could only show by hand.

## Context

The unit suite runs on EF Core's in-memory provider. That makes it fast and dependency-free, and wrong
in exactly the places where the database is the design:

- **It cascades only to rows its context is tracking.** So 0024 declines to delete an account in a
  test at all, on the grounds that a green test proving nothing about the constraint it names is worse
  than none, and asserts the model instead.
- **It cannot execute `ExecuteDeleteAsync`.** The retention sweep's deletion — the lock query, the
  batches, the cascade to the rows — was only ever verified by hand (0038 §3 and §4). Its first version
  failed into the log for want of a column alias that only PostgreSQL could object to.
- **It has no isolation**, so whether the export reads one snapshot (#95) could be seen only through a
  recipe run by hand against the container.
- A `SET NULL` on an optional pointer, a composite foreign key and a check constraint mean nothing to it.

Four facts shaped the answer. IGDB cannot be reached from CI, which has no credentials, and a
developer's credentials live in user secrets, which Development loads. A developer's own data lives in
`mvgl-postgres`, which nothing automated may touch. Outside Development a key ring persisted nowhere
stops the application at startup unless configuration says the loss is meant (0043), and the
migrations apply themselves only in Development. And every write needs `X-MVGL-Request`
([0033](0033-what-the-api-refuses.md)).

## Decision

### 1. A project of its own, beside the unit one

`MyVideoGameList.Server.IntegrationTests`. Same xUnit, runner and test SDK versions as the unit
project, and a Dependabot group, `test`, moves them in both at once. The server's internals are visible
to it, as they are to the unit project, because the sweep is an internal class. It is not folded into
the unit project: that suite stays seconds long with no Docker, and its CI job and its command are
unchanged.

It boots `Program.cs` with `WebApplicationFactory`. Every middleware, service and policy under test is
the application's own, in the application's order.

### 2. One container a run, a database a class

**One PostgreSQL container for the run.** Testcontainers starts it on first use, and a static shares
it with every class. The image is `compose.yaml`'s, `postgres:18-alpine`, so the tests see the engine
`dotnet run` does, and each file says to change the two together. Docker picks its host port, so it
never meets `mvgl-postgres` on 5432. Testcontainers' reaper removes it when the test process ends,
however it ends: with the test host killed mid-run, the container was gone eleven seconds later. It is
also disposed at a normal exit, which keeps a machine tidy where the reaper is switched off. Its start
is bounded at five minutes, so a container that never becomes ready fails the run with a reason rather
than waiting out Testcontainers' own timeout; the bound was seen to work at a second and a half.

**A database for each test class.** Each class's fixture, `ApiFactory`, creates an empty database on
that container, applies the migrations to it, and only then boots its own host over it. Classes run in
parallel, as xUnit runs them by default, and cannot see each other's rows. Tests within a class run one
at a time and share its database. So each test registers its own accounts, under a username drawn from
a counter, and asserts on its own rows. Nothing is reset between tests.

Measured on a developer machine: starting the container takes about 4.7 s. Migrating a new database
takes 2.3–3 s and booting a host about half a second, done for every class at once. A run takes
11–17 s from `dotnet test --no-build` to its summary. A reviewer's five runs, one of them on a single CPU with
every class in series, all passed, the slowest in 21 s.

Rejected:

- **A container per class.** 4.7 s each, for isolation a database already gives.
- **One database, reset between tests**, the Respawn shape. It makes every test in the suite run one
  after another, and a reset that has to spare the seeded lookup tables is one more list to keep in
  step with the model.
- **A template database, migrated once and cloned for each class.** It would save each later class
  its migration, but those run in parallel today and the wall clock would barely move. It is the lever
  to pull once the number of classes makes migrating show up in a run.

### 3. The environment is `Testing`, which behaves as deployed

Not Development, which would load the developer's user secrets, IGDB's credentials among them. It
would also migrate at startup and put stack traces into error bodies, and no deployment does either.
So:

- **The fixture migrates** before the host starts, as a step of its own, which is what the
  deployment's migration task does. It does so through a context of its own, not the host's, which also
  keeps out of a passing run's log the error EF writes while finding that a new database has no
  history table.
- **`DataProtection:AllowEphemeralKeys` is set**, which gets past 0043's startup check, and is the
  amendment above. On its own it would leave the ring where the default puts it, a developer's own
  profile — and the framework's `DataProtectionHostedService` loads the ring as the host starts,
  writing a key there if none is current. So the factory also replaces where the keys are kept with a
  repository in memory (`KeyManagementOptions.XmlRepository`). The provider, the application name and
  the key manager stay the application's own. Verified: the host's first key is in that repository by
  the time the host has started, before any request. Nothing needs Parameter Store.
- **The HTTPS redirect is on, as deployed** (HSTS is too, though it never sends its header to
  `localhost`), and the test browser talks to `https://localhost`. It would have to anyway: the sign-in
  cookie is `Secure`, and a cookie jar sends a `Secure` cookie only over HTTPS.
- **Settings `Program.cs` reads while registering its services go in through `UseSetting`.** A
  configuration source added in the factory arrives after they have been read. Verified: given that
  way, `AllowEphemeralKeys` is not seen, and the host fails 0043's startup check.

### 4. IGDB answers like an outage, and records that it was asked

`IIgdbService` is replaced by a proxy, `UnreachableIgdb`. It records every call and returns a task
faulted with `HttpRequestException`, which is what a dropped connection produces. That is the honest
double. Where a call is live, `UpstreamFailureHandler` makes it the 502 an outage makes. Where
`GameCacheService` has a stored copy, it serves that. A test that reaches IGDB by accident gets an
outage's answer, never a plausible game.

The calls are recorded because "nothing asked IGDB" is a claim the records make: a list renders from
`CachedGames` ([0035](0035-a-local-copy-of-what-igdb-said.md)), and the export makes no call (0024).
The tests assert both. A game a list needs is cached with `ApiFactory.CacheGamesAsync`, which writes
through `IGameCacheService.StoreAsync`, the application's own writer, so its payload has the shape the
reader expects.

A proxy rather than a class implementing the interface by hand. A method added to `IIgdbService` is
then unreachable here the day it is added, and this project needs no edit for a call none of its tests
make.

Rejected:

- **An NSubstitute substitute**, as the unit tests use. An unconfigured call answers with a default
  rather than failing. That reads as "IGDB had nothing to say", not as an outage, and a page would then
  render less for a reason nobody chose.
- **The real `IgdbService` over a failing HTTP handler**, which would exercise
  [0034](0034-failing-in-one-shape.md)'s pipeline too. Every call would pay the retries' backoff, and
  the service needs credentials before it sends anything.

### 5. What else is replaced, and what is not

- **Our own hosted services are removed** from the test host: every `IHostedService` registered from
  the server's assembly, by type, by instance or by a factory written there. So one added later is
  removed too, and the fixture fails, naming it, if one is running all the same. No sweep deletes rows
  under a test that did not ask for one. The sweep's own tests start one themselves with `StartAsync`,
  as the host does.
- **The client address is set.** The test server gives a request none — `RemoteIpAddress` is null —
  so every browser would share the rate limiter's single bucket for requests without an address.
  Measured: the eleventh failed login, from eleven different browsers, was a 429. A startup filter gives
  each test browser an address of its own, as a connection would. The limiter itself is untouched.
- **Nothing else.** The write guard stays on. The test browser sends `X-MVGL-Request` on writes, as
  `apiFetch` does, and one test sends a write without it and is refused. So the rest of the suite cannot
  be passing because the guard is off.

### 6. What it proves first

- **Auth and the lists**, end to end: registering, signing in by email and by username, signing out, a
  wrong password answered as an unknown account is; a game added, moved and taken out, read back from
  the lists and from the export's log. A list of fresh rows asks IGDB nothing; a row a year stale is
  asked about once, meets the outage, and is served as stored.
- **The cascades (0024).** Deleting an account empties every table with a `UserId`, ten of ours and
  four of Identity's, leaves another account's rows and the cached games alone, and signs the browser
  out. Every required child goes with its parent under one `DELETE` with nothing loaded, over an
  inventory of the three such edges kept as `UserOwnedDataTests` keeps its tables. Deleting an entry
  takes its playthroughs and review and keeps the log. Deleting the playthrough a review describes
  unlinks the review and keeps it.
- **The sweep (0038).** Both windows, with a job either side of each; the cascade to the rows; sixty
  jobs deleted as three statements of at most twenty-five, each committed before the next; and a pass
  that finds the lock held by another session deleting nothing.
- **The export's snapshot (#95)**, by the recipe on #104. It fails against master's exporter, passes
  against #263's, and fails again with #263's transaction left at `READ COMMITTED`. It went in skipped,
  because master does not read one snapshot yet, and builds its host inside the test, so that while
  skipped it costs a run nothing.

These were run against the bugs they guard, and each failed its test: the wishlist's foreign key to
the account dropped (naming the table); the import rows' key to their job dropped; the review's pointer
made to cascade; the lock query's alias removed, the bug 0038 records, which fails at once with
`column s.Value does not exist`; the batch size dropped from the delete, or the loop stopped after one
batch; the lock's answer ignored; the pending window shortened to seven days; and the account's
deletion no longer signing the browser out.

### 7. CI runs it as a job of its own

`integration` ("Server integration") in `ci.yml`, on `ubuntu-latest`, which has Docker. The reaper is
left on. The unit job is untouched, so a failure here is never mistaken for one there. A
fifteen-minute timeout and `--blame-hang-timeout` at five bound a hang the start limit does not cover:
a pull that stalls, a test that deadlocks.

Deploy dev runs only when a CI run succeeds, so this job is now part of that gate: a red run here holds
back that commit's dev images until it is re-run. Each run pulls `postgres:18-alpine` and the reaper's
image from Docker Hub without signing in, and Docker Hub limits anonymous pulls. If those pulls are
ever refused, the answer is a Docker login before the tests, with a read-only token in the
repository's secrets and Dependabot's.

## Consequences

- **`dotnet test` on this project needs Docker running**, and so does `dotnet test` over the whole
  solution, which now includes it. The unit project's own command does not.
- **A new table with a `UserId` fails `OwnershipCascadeTests` until `RecordEverythingAsync` gives the
  account a row in it.** That is deliberate: a table nobody seeded would otherwise "pass" on zero rows
  that were never there. The failure names the table. A new required foreign key between user-owned
  tables fails the inventory, and then needs its child seeded the same way.
- **A new member of `IIgdbService` needs nothing here**, and neither does a new hosted service, which
  the factory removes and checks it has removed.
- **A new setting that `Program.cs` reads while registering** has to be set through `UseSetting` in
  the factory, not through a configuration source.
- **`postgres:18-alpine` is a tag that moves**, here as in `compose.yaml`, so the engine's patch level
  can change under an unchanged commit. Pinning it is a decision for both files at once.
- **Not covered:** the migration bundle the deploy runs; Parameter Store; forwarded headers behind a
  real proxy; the upload's request size limit, which the test server cannot enforce and says so in the
  log; the sweep's warning after six blocked ticks and its execution strategy; and the server-rendered
  front end, which is #105, in the browser.
