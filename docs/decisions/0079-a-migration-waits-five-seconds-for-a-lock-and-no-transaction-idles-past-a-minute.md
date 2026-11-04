# 0079. A migration waits five seconds for a lock, and no transaction of the API's idles past a minute

**Status:** Implemented — #261.
**Amends:** [0044](0044-what-the-deployment-walkthrough-settled.md), whose migration task now carries a
`lock_timeout` the API's sessions do not. Sized against [0052](0052-a-background-refresh-ahead-of-the-reader.md)
§4, the one transaction designed to sit idle.

## Context

The migration task runs while the previous revision is still serving (0044). A DDL statement that
needs `ACCESS EXCLUSIVE` on a table waits for every transaction already open on it, and while it waits
it holds its place in the table's lock queue, so every later read of the table waits behind it. One
long reader therefore stalls every page that reads that table, and the release with it.

Nothing set `lock_timeout`, so what bounded the wait was an accident: Npgsql's command timeout, thirty
seconds by default, which the migration bundle inherits. Seen against PostgreSQL: a migration blocked
by an open transaction waited 30.5 seconds and then failed on a `TimeoutException`. The readers that
had queued behind it waited as long.

The API's own transactions are what a migration meets. Three are explicit, and #95 made one of them
longer:

- **The export** reads its thirteen tables in one `REPEATABLE READ` transaction, holding `ACCESS SHARE`
  on each until it commits: tens of milliseconds, about a second at the size caps. It commits before
  the document is serialized, so a slow client never holds it open.
- **The cache refresh** holds its advisory lock and an `ACCESS SHARE` on `CachedGames` across the IGDB
  request, by design (0052 §4): about a second at fifty ids, never more than fifteen.
- **The retention sweep** deletes a batch and commits it, its statements back to back.

The rest are EF's own, around a `SaveChangesAsync`. #261 also asked whether the API's sessions want
`idle_in_transaction_session_timeout`, so that a transaction left open cannot hold its locks for good.

## Decision

### 1. The migration task waits at most five seconds for any lock

Its connection string is the API's with `Options='-c lock_timeout=5000ms'`, built by
`SessionLimits.ForMigration`. Past the limit PostgreSQL cancels the statement with `55P03`, the bundle
exits non-zero, and the release fails before anything is deployed, as any failed migration does (0044).
A re-run, once the long transaction has ended, is the whole of the fix.

**Five seconds** is about five times the API's longest ordinary holders: the export at its caps, and
the refresh's batch. So an ordinary release does not trip it. It trips on what it is for: a
transaction open far longer than any of ours means to be, which already holds every reader of the
table, and five seconds is the most those readers wait. A migration of `CachedGames` that meets the
refresh during an IGDB slowdown can fail and is re-run; that is the trade. The game page's one-second
deadline on its figures (0069) is shorter than any useful limit, and a render that misses them is
already `no-store` and complete without them.

**The limit is the migration task's alone.** The API's sessions keep PostgreSQL's default of waiting
for as long as it takes: what they wait on is each other's row locks, briefly, and a request that
failed instead would turn a few milliseconds behind a migration's DDL into an error page. So the
setting is on the task's connection string, not in the RDS parameter group and not on the role. It is
not in each migration either, as a `SET` that every new migration would have to remember.

**The command timeout stays.** Thirty seconds now bounds how long a migration statement may *run*,
holding its lock with the table's readers queued, and a migration that needs longer should be written
to need less: in batches, or `CONCURRENTLY`. When one cannot be, it raises the timeout on the task's
string on purpose, in its own pull request.

**`SessionLimits.cs` is compiled into both projects.** The CDK app links the file from the API's
source, so the integration suite proves the string the deployment sends rather than a copy that can
drift. The half that needs Npgsql, `SessionLimits.Api.cs`, is the API's alone, and the shared half
may use nothing but the base class library.

### 2. Every session of the API's ends if it sits idle in a transaction for a minute

`Program.cs` passes the connection string through `SessionLimits.ForApi`, which adds
`-c idle_in_transaction_session_timeout=60000ms` to its `Options`. Idle means between statements: the
application holds the transaction open and is doing something else. A statement that runs is bounded
by the command timeout instead. Past the limit PostgreSQL ends the session, and the transaction and its
locks with it. The code that held it meets the error on its next statement, as it would a dropped
connection.

**Why at all, when every transaction is bounded in code today.** The bound in code is a promise each
transaction makes; this is the check on the next one that does not. An await with no limit, added
inside a transaction, would otherwise hold its locks for as long as the process lives. With section 1
a long holder no longer stalls the site, but it still fails every release that touches its tables, and
any row it has written stays locked against every other writer, who waits without limit. A
transaction of ours idle for a minute is one that nothing is coming back to finish.

**A minute** is four times the refresh's fifteen seconds, the one idle stretch designed in, and
`SessionLimitsTests` fails if the refresh's limit grows past half of it. It is also about how long
somebody takes to read a failed release and run it again, so the re-run finds the lock free.

**In the code, not the deployment.** It holds in local development and in the integration suite as
well as deployed, so a transaction left idle past it fails where it was written. It is merged into
whatever `Options` the string already has, because the migration bundle builds its context through
`Program.cs` too, from section 1's string. The task's sessions therefore carry both limits. A
migration's statements run back to back, so the idle limit costs it nothing.

Rejected:

- **`transaction_timeout`** (PostgreSQL 17 and later), which bounds the whole transaction. Its running
  statements are already bounded by the command timeout. The gap nothing bounded was the idle one.
- **The RDS parameter group**, which would also cover a `psql` session left open. The `Data` stack is
  deployed by hand, and neither a developer's database nor the integration suite's would have it.

## Consequences

- **A failed release that says `55P03` or "canceling statement due to lock timeout" is re-run.** If it
  fails again, something holds a transaction open on the table it names: `pg_stat_activity` says
  which session, and the idle limit ends it within a minute if it is idle. Migrations commit one at a
  time, so the ones before the blocked one stay applied and the re-run starts at it. Seen against
  PostgreSQL: a run with `AddEntryTags` and `AddUserGameEntryScoredAt` pending, blocked at the second,
  left the first applied.
- **A second migration task started while one runs can now fail on the migration lock.** Npgsql's
  migrator takes `LOCK TABLE "__EFMigrationsHistory" IN ACCESS EXCLUSIVE MODE`, and `lock_timeout`
  bounds that wait like any other. Nothing starts two: Deploy dev's concurrency group, and `resume`'s
  check for a running one. Failing is the better of the two outcomes anyway.
- **A deadlock between a migration and an export**, which #261 noted, is broken by PostgreSQL's
  detector after `deadlock_timeout`, a second by default, before either limit here. It may cancel
  either: the export answers 500 and is asked again, or the release fails and is re-run.
- **Npgsql counts a lock timeout as transient.** The execution strategy, which never retries today,
  hands it on wrapped as a transient failure. On the day somebody adds `EnableRetryOnFailure`, the
  migrator will retry a lock timeout, and each retry queues the table's readers for another five
  seconds. A retrying strategy for the API should leave the migration task's out, or accept that.
- **A breakpoint held inside a transaction for more than a minute ends that session**, locally too.
- **A transaction that means to sit idle for longer** — another request to a third party inside one,
  as the refresh makes — is a change to this record first, and it should not be.
- **Proved by `MigrationLockTests`** in the integration suite, through the deployed string: an open
  transaction on `UserGameEntries` holds back `AddUserGameEntryScoredAt`. The migration fails with
  `55P03` after the limit, not at the command timeout. A reader that queued behind it is answered
  while the transaction is still open. The re-run succeeds once it has ended. With the limit taken
  off, the same test waits thirty seconds and fails. The same class reads both limits back from the
  migration's session, and the idle limit alone from the host's.
