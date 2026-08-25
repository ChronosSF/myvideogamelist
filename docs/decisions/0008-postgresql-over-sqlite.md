# 0008. PostgreSQL replaces SQLite before deployment

**Status:** Implemented locally — the application now runs on PostgreSQL, with a container for
development. The *hosted* half is still pending: the service is settled by
[0014](0014-rds-postgresql-over-aurora.md) as RDS for PostgreSQL, but nothing is provisioned yet.

## Context

The app uses SQLite with a file database (`myvideogamelist.db`). That is fine for local
development and is deliberately kept for now, while the app is being built out locally.

It cannot survive deployment. A file database on an ephemeral container filesystem loses
every user on redeploy, and cannot be shared between the multiple tasks that 0007 assumes.

## Decision

Move to **PostgreSQL** before the first real deployment.

~~Targeting Aurora Serverless v2, which scales to near-zero cost at low traffic.~~ That premise
did not survive checking: Aurora's scale-to-zero pauses on *database connections*, which an
always-on task with a connection pool would keep open, and its 0.5 ACU floor costs roughly 4×
a `db.t4g.micro`. The "simpler alternative" mentioned here — plain RDS for PostgreSQL — is now
the decision. See [0014](0014-rds-postgresql-over-aurora.md).

SQLite stays for local development in the meantime.

## Consequences

- The provider swap is contained to `Program.cs`, but the **migration set must be
  regenerated** — the existing migrations carry SQLite-specific column types.
- ~~Verifying the regenerated migrations needs a running PostgreSQL, which needs Docker.~~
  Done. Docker is installed and `compose.yaml` provides the database; the migration set was
  regenerated and verified against a real server, including from an empty database.
- ~~Installing Docker also unblocks Testcontainers-based integration tests.~~ Still unblocked,
  still unwritten — the test suite remains on EF Core InMemory.
- ~~Local development may end up on a different engine from production.~~ Closed: local runs
  PostgreSQL in Docker, so there is no engine divergence.
