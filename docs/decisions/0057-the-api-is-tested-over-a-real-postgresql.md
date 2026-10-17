# 0057. The API is tested over a real PostgreSQL: one container a run, a database a class, and IGDB out of reach

**Status:** Implemented. The export-snapshot test is written and skipped until #263 lands.

Built for #104. Closes what [0024](0024-the-ownership-contract.md) and
[0038](0038-where-scheduled-work-lives.md) each left to "a relational provider", and what #95 could
only show by hand.

## Context

The unit suite runs on EF Core's in-memory provider. That makes it fast and dependency-free, and wrong
in exactly the places where the database is the design:

- **It cascades only to rows its context is tracking.** So 0024 declines to delete an account in a
  test at all, on the grounds that a green test proving nothing about the constraint it names is worse
  than none, and asserts the model instead.
- **It cannot execute `ExecuteDeleteAsync`.** The retention sweep's deletion — the lock query, the
  batches, the cascade to the rows — was verified once, by hand (0038 §4). Its first version failed
  into the log for want of a column alias that only PostgreSQL could object to.
- **It has no isolation**, so whether the export reads one snapshot (#95) could be seen only through a
  recipe run by hand against the container.
- A `SET NULL` on an optional pointer, a composite foreign key and a check constraint mean nothing to it.

Four facts shaped the answer. IGDB cannot be reached from CI, which has no credentials, and a
developer's credentials live in user secrets, which Development loads. A developer's own data lives in
`mvgl-postgres`, which nothing automated may touch. Outside Development a key ring persisted nowhere
stops the application at startup unless configuration says the loss is meant
([0043](0043-where-the-key-ring-lives.md)), and the migrations apply themselves only in Development.
And every write needs `X-MVGL-Request` ([0033](0033-what-the-api-refuses.md)).

## Decision

### 1. A project of its own, beside the unit one

`MyVideoGameList.Server.IntegrationTests`. Same xUnit, runner and test SDK versions as the unit
project, so Dependabot moves them together. The server's internals are visible to it, as they are to
the unit project, because the sweep is an internal class. It is not folded into the unit project: that
suite stays seconds long with no Docker, and its CI job and its command are unchanged.

It boots `Program.cs` with `WebApplicationFactory`. Every middleware, service and policy under test is
the application's own, in the application's order.

### 2. One container a run, a database a class

**One PostgreSQL container for the run.** Testcontainers starts it on first use, and a static shares
it with every class. The image is `compose.yaml`'s, `postgres:18-alpine`, so the tests see the engine
`dotnet run` does. Docker picks its host port, so it never meets `mvgl-postgres` on 5432. It is
disposed when the test process exits, and Testcontainers' reaper removes it if the process dies first:
with the test host killed mid-run, the container was gone eleven seconds later.

**A database for each test class.** Each class's fixture, `ApiFactory`, creates an empty database on
that container, applies the migrations, and boots its own host over it. Classes run in parallel, as
xUnit runs them by default, and cannot see each other's rows. Tests within a class run one at a time
and share its database. So each test registers its own accounts, under a username drawn from a
counter, and asserts on its own rows. Nothing is reset between tests.

Measured on a developer machine: starting the container takes about 4.7 s. Creating a database,
booting a host and migrating take about 3–3.5 s, done for every class at once. The tests themselves
take 3–4 s. A run is 13–17 s from `dotnet test --no-build` to its summary.

Rejected:

- **A container per class.** 4.7 s each, for isolation a database already gives.
- **One database, reset between tests**, the Respawn shape. It makes every test in the suite run one
  after another, and a reset that has to spare the seeded lookup tables is one more list to keep in
  step with the model.
- **A template database, migrated once and cloned for each class.** It would save each later class its
  2.5 s of migration, but those run in parallel today and the wall clock would barely move. It is the
  lever to pull once the number of classes makes migrating show up in a run.

### 3. The environment is `Testing`, which behaves as deployed

Not Development, which would load the developer's user secrets, IGDB's credentials among them. It
would also migrate at startup and put stack traces into error bodies, and no deployment does either.
So:

- **The fixture migrates**, as a step of its own before the first request and through the
  application's own context, which is what the deployment's migration task does.
- **`DataProtection:AllowEphemeralKeys` is set**, which gets past 0043's startup check. The ring is
  then held in memory (`UseEphemeralDataProtectionProvider`), so no test writes into the developer's
  own ring in their profile. Nothing needs Parameter Store.
- **HSTS and the HTTPS redirect are on, as deployed**, and the test browser talks to
  `https://localhost`. It would have to anyway: the sign-in cookie is `Secure`, and a cookie jar sends
  a `Secure` cookie only over HTTPS.
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
The tests assert both. A game a list needs is written into `CachedGames` through
`IGameCacheService.StoreAsync`, the application's own writer, so its payload has the shape the reader
expects.

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
  the server's assembly, so one added later is removed too. No sweep deletes rows under a test that did
  not ask for one. The sweep's own tests start one themselves with `StartAsync`, as the host does.
- **The client address is set.** The test server gives a request none — `RemoteIpAddress` is null —
  so every browser would share the rate limiter's single bucket for requests without an address.
  Measured: the eleventh failed login, from eleven different browsers, was a 429. A startup filter gives each test browser an address of its
  own, as a connection would. The limiter itself is untouched.
- **Nothing else.** The write guard stays on. The test browser sends `X-MVGL-Request` on writes, as
  `apiFetch` does, and one test sends a write without it and is refused. So the rest of the suite cannot
  be passing because the guard is off.

### 6. What it proves first

- **Auth.** Registering signs the browser in, as a private account that is no admin. Logging out ends
  the session. Logging in works by email and by username. A wrong password answers exactly as an
  unknown account does.
- **The lists.** A game added and moved is listed where it ended, with every transition in the
  export's log in order. A repeated move records nothing. Taking a game out of every list records the
  departure and keeps the score. A list asks IGDB nothing, and serves a stale row while IGDB is down.
- **The cascades (0024).** Deleting an account empties every table with a `UserId`, ten of ours and
  four of Identity's, and leaves another account's rows and the cached games alone. Every required
  child goes with its parent under one `DELETE` with nothing loaded. Deleting an entry takes its
  playthroughs and review and keeps the log. Deleting the playthrough a review describes unlinks the
  review and keeps it.
- **The sweep (0038).** Both windows, the cascade to the rows, and a sixty-job backlog cleared in one
  pass of three batches.
- **The export's snapshot (#95)**, by the recipe on #104. It fails against master's exporter, passes
  against #263's, and fails again with #263's transaction left at `READ COMMITTED`. It is skipped until
  #263 is merged.

Each of the rest was run against the bug it guards. Dropping the wishlist's foreign key to the account
fails the account test, naming the table. Dropping the import rows' key to their job fails the parent
test. Making the review's pointer cascade fails the unlink test. Removing the lock query's alias, the
bug 0038 records, fails the sweep tests at once with `column s.Value does not exist`. Stopping the
sweep after one batch fails them on the jobs left.

### 7. CI runs it as a job of its own

`integration` ("Server integration") in `ci.yml`, on `ubuntu-latest`, which has Docker. The reaper is
left on. The unit job is untouched, so a failure here is never mistaken for one there. A fifteen-minute
timeout stops a container that never becomes ready from holding the runner for the six-hour default.

## Consequences

- **`dotnet test` on this project needs Docker running**, and so does `dotnet test` over the whole
  solution, which now includes it. The unit project's own command does not.
- **A new table with a `UserId` fails `OwnershipCascadeTests` until `RecordEverythingAsync` gives the
  account a row in it.** That is deliberate: a table nobody seeded would otherwise "pass" on zero rows
  that were never there. The failure names the table. A new required foreign key between user-owned
  tables is found the same way and needs its child seeded.
- **A new member of `IIgdbService` needs nothing here**, and neither does a new hosted service, which
  the factory removes.
- **A new setting that `Program.cs` reads while registering** has to be set through `UseSetting` in
  the factory, not through a configuration source.
- **The export-snapshot test is skipped** because master does not read one snapshot yet. Whichever of
  #263 and this record's pull request is merged second deletes the `Skip`.
- **Not covered:** the migration bundle the deploy runs, Parameter Store, forwarded headers behind a
  real proxy, and the server-rendered front end. The last is #105, in the browser.
