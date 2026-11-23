# 0106. Production's database is Multi-AZ, and a failover is a minute or two of errors that nothing retries

**Status:** Implemented — [#416](https://github.com/ChronosSF/myvideogamelist/issues/416); nothing of it is
deployed, and what a failover does is proved only by one, which §7 says how to cause before launch. Undoes
for production the trade [0015](0015-fargate-confirmed-and-nat-less-networking.md) accepted, "Single-AZ
everywhere", and keeps it for dev. Adds a fourth member of `Site` to the three
[0103](0103-production-is-the-same-stacks-behind-an-approval.md) §2 lists. Production's private subnets
are [#415](https://github.com/ChronosSF/myvideogamelist/issues/415), beside this.

## Context

0015 put the database in one availability zone and called it "a deliberate availability trade", to be
revisited "before the service is one anyone depends on". Production is about to be that. 0103 made
production from dev's stacks and left this to #416.

Production's `Data` stack is deployed by hand, once, and holds the database behind deletion protection. Its
owner wants it made in its final shape rather than changed after people's lists are in it.

What a Multi-AZ DB instance is, in AWS's words
([Multi-AZ DB instance deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html),
[Failing over a Multi-AZ DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html),
read 2026-11-23):

- **"A synchronous standby replica in a different Availability Zone"**, which "can't serve read traffic".
- **A failover changes the instance's DNS record** to point at the standby, and "you need to re-establish
  any existing connections". "Failover times are typically 60–120 seconds."
- **It fails over by itself** when the primary's host is unhealthy or unreachable, its storage fails, it is
  "busy and unresponsive", its operating system is patched offline, or it is modified; and when somebody
  reboots it "with failover".
- **Writes cost a little more:** it "can have increased write and commit latency compared to a Single-AZ
  deployment", because the replication is synchronous.

## Decision

### 1. One member of `Site`, production's alone

`Site.MultiAzDatabase` is true for production and false for every other environment, and `DataStack` reads
it where it said `MultiAz = false`. That is the whole change to the stacks. Dev's seven synthesised
templates are byte for byte what they were; production's differ in `Mvgl-prod-Data` alone, by
`"MultiAZ": true` and CDK's own metadata string.

**Dev keeps one zone.** The standby would nearly double what its database is billed (§6), to keep a test
site up through a zone's failure. Its testers' data does not depend on it: that is the backups'.

**CI holds both.** `scripts/site.mjs` restates the member, and `scripts/check-site.mjs`, which the
Infrastructure job runs after each synthesis, compares it with the `DBInstance`'s `MultiAZ` in each `Data`
template, read with no default. Run against production's synthesis before this change, it fails. Either
environment's changes only where both files are changed.

### 2. The data subnets' two zones are enough for a standby

The VPC spans two zones, and the `data` subnets are one in each: `eu-central-1a` and `eu-central-1b` in
production's synthesis, from the zones `cdk.context.json` caches for its account. RDS places the standby in
the subnet group's other zone. Its documentation
([Working with a DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html))
says that a subnet group must span at least two, and "for Multi-AZ deployments, defining a subnet for two or
more Availability Zones in an AWS Region allows Amazon RDS to create a new standby in another Availability
Zone should the need arise". Since every group must span two, Multi-AZ asks nothing more of the VPC than
the Single-AZ instance did.

**What two zones do not give** is a new standby while a whole zone is down: the instance runs on the
survivor alone until the lost zone is back. The same page's best practice is a subnet in every zone of the
Region. Not taken: the VPC's zones are #415's to change, every subnet group grows with them, and a zone of
tasks behind NAT is a gateway more.

### 3. What a failover does to the running system

None of this has been seen; it is read from the code and from Npgsql 10.0.3's source, the version the API
resolves. §7 is how it is seen.

- **The database.** RDS changes the instance's DNS record to point at the standby, so the name in the
  connection string is the one to follow. AWS's event for the end of a failover says "DNS propagation may
  take a few minutes". A commit the API was answered for was on the
  standby, which is what synchronous means. A commit in flight when the primary went has an outcome nobody
  is told.
- **The API's pool.** Npgsql does not probe an idle pooled connection before handing it out (`Keepalive` is
  off by default), so the first statement on one fails. A connection that breaks on a transient error, or on
  the server's `57P01` shutdown, **empties the whole pool** (`NpgsqlConnector.Break` calls
  `DataSource.Clear()`): idle connections are closed at once and the rest as they are returned. Every new
  connection resolves the host again (`Dns.GetHostAddressesAsync` on each physical open), so the API follows
  the record as soon as its resolver does, with no restart. The session limits of 0079 travel in the
  connection string's startup options, so a new connection carries them.
- **A primary that vanished rather than shut down**, as in a lost host or zone, never closes its
  connections. A statement on one waits for the command timeout, 30 seconds, then two more for the
  cancellation timeout, before the connection is broken and the pool emptied. A new connection to an
  address that does not answer gives up after the connect timeout, 15 seconds. Those are Npgsql's
  defaults, and nothing here changes them.
- **The requests.** Every request that needs the database fails while it lasts, as a 500 with its
  `traceId`: an `NpgsqlException` is none of the upstream failures that make a 502, and the database is
  ours. Nothing retries (§4). A write in flight is undone on the page by its optimistic rollback, and if
  its commit had landed, the next load shows it. A list move made again is harmless: a move to the status a
  game already holds records nothing (0018).
- **The SSR server** reaches the database only through the API. A loader whose call failed throws its
  upstream failure, and the page is an error page that no cache keeps (0070). Pages already at the edge
  are served from there, as in any outage of the API.
- **Health.** `/readyz` fails while the database cannot be reached. The balancer checks `/healthz`, which
  checks nothing, so the API's task stays in rotation and ECS does not replace it, which is right: a new
  task would meet the same database. A `Deploy prod` whose smoke test lands in the window fails.
- **The background services.** The retention sweep and the cache refresh fail the tick in flight, log it at
  Error, and run again on their next tick, an hour and a minute away. Their advisory locks are
  transaction-scoped, so they ended with the sessions on the old primary, and nothing is left to release. A
  refresh whose commit was in flight is rewritten on a later tick either way. It is not held back an hour,
  which is for an IGDB answer that cannot be read or a write PostgreSQL refuses, and a broken connection is
  neither. The Steam refresh and the edge invalidator's queue do not use the database.
- **The migration task.** A failover during a migration breaks its connection and the bundle exits
  non-zero, so the release fails before `App` is deployed, as any failed migration does. Migrations commit
  one at a time (0079), so the re-run starts at the one that was interrupted. One started during the window
  fails to connect. Either way the cure is 0079's: run the release again. Its `lock_timeout` is unchanged.
- **The Data Protection keys and email** are not in the database, and nothing changes for them.

So a failover should be AWS's minute or two, plus however long the task's resolver keeps the old record,
plus up to half a minute more for a request caught on a dead connection. That is an estimate, not a
measurement.

### 4. Nothing retries, for now

EF can retry a failed operation (`EnableRetryOnFailure`). `CLAUDE.md` warns that a retrying strategy refuses
a transaction the code begins itself; the five that exist already run inside `CreateExecutionStrategy()`,
so that trap would not fire. What it would still cost:

- **A doubled event.** EF's documentation
  ([Connection resiliency](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency))
  says a connection dropped during a commit leaves its outcome unknown, that the strategy retries "as if
  the transaction was rolled back", and that this "could lead to data corruption ... when inserting a new
  row with auto-generated key values". `UserGameEvents` has store-generated ids and is append-only, so a
  move whose commit landed and was retried would put an event in somebody's history twice, for good (0018).
- **The migration task would retry a lock timeout**, and each retry holds the table's readers another five
  seconds (0079). It would need options of its own.
- **The wait.** EF's defaults are six retries, waiting about 0, 1, 3, 7, 15 and 30 seconds between them
  (`ExecutionStrategy`, 10.0.14): close to a minute on one request, during which its reader looks at a page
  that has not answered, without the promise that the failover is over by then.

So a failover is an error page for a minute or two, which a reload after it answers. That is what an IGDB
outage already is for browsing. Worth revisiting if failovers turn out to be common, which the alarm of §5
would tell.

### 5. Nothing says a failover happened

None of the five alarms of [0080](0080-an-alarm-watches-what-a-reader-sees-and-mails-an-address-nobody-commits.md)
names one. `unhealthy-target` and the task-stopped rule stay quiet, because `/healthz` passes and no task
stops. `db-connections` counts too many connections, and a failover leaves too few. `5xx-rate` needs five
errors and 5% in two of three five-minute windows, which a minute or two of errors on a quiet site may not
reach.

RDS publishes the event: `RDS-EVENT-0013`, "Multi-AZ instance failover started", and `RDS-EVENT-0049`,
"Multi-AZ instance failover completed", which AWS calls "the authoritative indicator that the failover is
done" ([RDS event categories](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_Events.Messages.html)).
An email for them is a rule and its message beside the task-stopped one, which no pull request can test.
It is not here: it is a line on [#406](https://github.com/ChronosSF/myvideogamelist/issues/406). Until then
the RDS console's events list them, and so does `aws rds describe-events`.

### 6. What it costs

From AWS's price list for RDS in `eu-central-1`, the bulk file published 2026-11-20
(<https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/eu-central-1/index.csv>), on
demand, PostgreSQL, the instance class and storage `DataStack` names, over 730 hours:

| | One zone | Multi-AZ | A month more |
|---|---|---|---|
| `db.t4g.micro`, an hour | $0.019 | $0.037 | $13.14 |
| gp3, a GB-month, 20 GB | $0.137 | $0.274 | $2.74 |
| **The database, a month** | **$16.61** | **$32.49** | **$15.88** |

So production always on is about $16 a month more than dev's row in `dev-env.mjs`, which is ≈ $80, before
whatever #415's NAT adds. `dev-env.mjs status --env prod` says so beside the row.

Rejected:

- **A Multi-AZ DB cluster**, with two standbys that answer reads. Its gp3 storage alone is $0.411 a
  GB-month in the same file, and nothing here sends a read to a replica.
- **Multi-AZ for dev**, for the reason in §1.

### 7. Proving it, before the door opens

Nothing in a pull request can show any of §3. Production's first deploy is a rehearsal nobody else is in
(0103 §5), and that is when to cause one failover on purpose and watch it:

1. `aws rds describe-db-instances` says `MultiAZ` is true and names a `SecondaryAvailabilityZone`.
2. `aws rds reboot-db-instance --force-failover` on `mvgl-prod-db`, which refuses an instance that is not
   Multi-AZ, so it proves that too.
3. Meanwhile `/readyz` through the door: 503, and then 200 again, without the API's task being replaced.
4. `aws rds describe-events` lists `RDS-EVENT-0013` and `RDS-EVENT-0049`; the time between them, and
   between the first error in `/mvgl/prod/api` and the first `/readyz` that passes again, is the number
   §3 estimates.
5. `node scripts/dev-check.mjs --env prod` passes after it.

`infra/README.md` has the commands.

## Consequences

- **Production's `Data` stack makes the database Multi-AZ on its first deploy.** Dev's stacks are
  unchanged.
- **An operating-system patch on production becomes a failover.** AWS lists one in the maintenance window
  among the causes, and a modification of the instance, such as the change of class
  [#101](https://github.com/ChronosSF/myvideogamelist/issues/101) may make. Each is §3's minute or two.
- **Every write waits a little longer for its commit.** Unmeasured, and small beside a request's trip to
  the Region.
- **Left, and where:** an email when it fails over (#406); retries (§4, here, until there is a reason);
  how long a failover takes (§7, at the first deploy); a standby while a whole zone is down (§2, not
  planned).
