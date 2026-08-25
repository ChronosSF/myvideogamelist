# Architecture decision records

Short records of decisions that shaped this codebase, and the reasoning behind them.

`ROADMAP.md` is the plan and gets rewritten as phases land. These records are the *why*,
and they outlive the plan. Read the relevant one before changing anything it covers.

## Writing one

Copy the shape of an existing record: **Context** (what forced a choice), **Decision**
(what we picked), **Consequences** (what it costs and what it rules out). Keep it short.

Add one when you make a call that future work would otherwise have to reverse-engineer,
especially when you rejected a plausible alternative. Records are append-only: to change a
decision, write a new record and mark the old one superseded.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-igdb-as-source-of-truth.md) | IGDB is the source of truth for game data | Implemented |
| [0002](0002-server-side-rendering.md) | Server-side rendering via React Router framework mode | Implemented |
| [0003](0003-two-process-deployment.md) | Two processes; the SSR server does not proxy `/api` | Implemented |
| [0004](0004-release-dates-for-calendar.md) | The upcoming calendar is built on `release_dates` | Implemented |
| [0005](0005-secrets-handling.md) | Secrets come from user secrets and environment variables | Implemented |
| [0006](0006-codeql-buildless.md) | CodeQL runs buildless (`build-mode: none`) | Implemented |
| [0007](0007-aws-target-architecture.md) | ECS Fargate, Aurora Serverless v2, CloudFront | Partly superseded by 0014, 0015 |
| [0008](0008-postgresql-over-sqlite.md) | PostgreSQL replaces SQLite before deployment | Implemented locally; hosting pending |
| [0009](0009-itad-without-affiliate-revenue.md) | Integrate IsThereAnyDeal and forgo the affiliate revenue | Accepted |
| [0010](0010-monetization-model.md) | Ad-supported free tier plus a paid subscription | Accepted |
| [0011](0011-react-router-8-upgrade.md) | Upgrade to React Router 8 | Implemented |
| [0012](0012-steam-news-without-a-database.md) | Steam news is cached in memory, not stored in the database | Implemented |
| [0013](0013-http-caching-policy.md) | Every route declares its own `Cache-Control` | Implemented |
| [0014](0014-rds-postgresql-over-aurora.md) | Managed PostgreSQL on RDS, not Aurora Serverless v2 | Accepted |
| [0015](0015-fargate-confirmed-and-nat-less-networking.md) | ECS Fargate confirmed, with NAT-less networking | Accepted |
| [0016](0016-scores-carry-their-sample-size.md) | A score is never shown without its sample size | Implemented |
| [0017](0017-detail-data-off-the-listing.md) | Detail-only game data stays out of the listing payload | Implemented |
| [0018](0018-append-only-status-event-log.md) | Status changes are recorded in an append-only event log | Implemented |

**Status** — *Accepted*: decided, not yet built. *Implemented*: decided and in the code.
*Superseded*: replaced by a later record.
