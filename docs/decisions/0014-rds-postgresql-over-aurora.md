# 0014. Managed PostgreSQL on RDS, not Aurora Serverless v2

**Status:** Accepted — supersedes the engine choice in [0007](0007-aws-target-architecture.md)
and confirms the direction of [0008](0008-postgresql-over-sqlite.md)

## Context

[0008](0008-postgresql-over-sqlite.md) established that SQLite cannot survive deployment and
that PostgreSQL replaces it. [0007](0007-aws-target-architecture.md) named **Aurora Serverless
v2** as the specific service. That choice was made on the reasonable-sounding premise that
Aurora "scales to near-zero cost at low traffic".

Revisiting it against current pricing before building anything, the premise does not hold for
this application.

Two further facts changed the picture:

- **The AWS free tier is not the one most documentation describes.** On 15 July 2025 AWS
  replaced the 12-month model for new accounts with credits: **$100 at signup plus up to $100
  more** for five onboarding tasks, and a Free plan that ends at **six months or when the
  credits run out**, whichever comes first. There is no 750-hour, 12-month RDS allowance for a
  new account. Every cost decision is therefore really "how long do the credits last".
- The project is pre-launch. Load will be low and steady, not spiky.

## Decision

Use **Amazon RDS for PostgreSQL** on a **`db.t4g.micro`, Single-AZ** instance, inside the VPC
with no public endpoint.

Aurora Serverless v2 is deferred, not abandoned. It becomes the right answer when load is
genuinely variable and the elasticity is worth paying for.

### Why not Aurora

| Option | Compute at idle, Single-AZ |
|---|---|
| **RDS `db.t4g.micro`** | **~$11.68/month** |
| Aurora Serverless v2 at its 0.5 ACU floor | ~$43–45/month |
| Aurora Serverless v2 scaled to 0 ACU | $0 compute, storage still billed |

Roughly **4× the cost** for elasticity this workload does not use.

**The scale-to-zero row is a trap here.** Aurora Serverless v2 pauses based on *database
connections*: it sleeps after inactivity and resumes when a connection is requested. The
architecture in 0007 is an always-on ECS task holding an Npgsql connection pool, which would
keep the cluster awake — paying the 0.5 ACU floor while appearing to cost nothing. The ~15
second resume also conflicts with `/readyz`, which checks database reachability, so a task
could fail health checks while the database wakes. Verify against AWS documentation before
relying on either behaviour.

### Why not Neon or another hosted Postgres

Neon's free tier was considered seriously: real PostgreSQL, generous limits against a database
that is currently **192 KB**, scale-to-zero, and per-branch databases for testing migrations.

Rejected because it puts the database outside the VPC. Every query would leave AWS over the
public internet, incurring egress charges and leaving a publicly reachable database endpoint,
in exchange for saving roughly $12/month. Keeping the database private is worth more than that.
Its free tier also carries no SLA, so it could not have survived launch regardless.

## Consequences

- **Nothing is foreclosed.** Aurora can be created from an RDS PostgreSQL snapshot, so moving
  up later is a restore rather than a rewrite. Both are PostgreSQL, so the application code is
  identical either way.
- The migration set must still be regenerated, exactly as 0008 said — the existing migrations
  carry `type: "INTEGER"`, `type: "TEXT"` and `Sqlite:Autoincrement`.
- The application change is genuinely small, confirmed by inspection: the provider package,
  one `UseNpgsql` line, and the connection string. There is **no raw SQL anywhere** (pure
  LINQ) and **no `DateTime` property on any entity**, which avoids the most common Npgsql
  migration trap, where a non-UTC `DateTime` throws against a `timestamp with time zone`
  column. That trap arrives with the per-entry dates in ROADMAP Tier 1, not before.
- The connection string now contains a password, so it falls under [0005](0005-secrets-handling.md):
  user secrets locally, environment variables when deployed. It must never reach
  `appsettings.json`.
- **Local development moves to PostgreSQL in Docker.** Leaving local on SQLite while production
  runs PostgreSQL produces bugs that only appear in production. Docker also unblocks the
  Testcontainers integration tests 0008 already wanted.
- An RDS instance can be **stopped for up to 7 days** before auto-starting, which is a usable
  lever for parking the database during development.
