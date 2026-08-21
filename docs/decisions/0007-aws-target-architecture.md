# 0007. ECS Fargate, Aurora Serverless v2, CloudFront

**Status:** Accepted — not yet built

## Context

The app needs a deployment target that supports zero-downtime updates and can scale
horizontally, without restructuring the code. SSR makes it two processes (0003), so the
target must route between them.

## Decision

```
Route 53 → CloudFront ─┬─ /api/*  → ALB → ECS Fargate (ASP.NET API)
                       └─ /*      → ALB → ECS Fargate (Node SSR server)
                                              │
                          Aurora Serverless v2 (PostgreSQL, see 0008)
                          ElastiCache Serverless (Redis)
                          Secrets Manager
                          S3/DynamoDB + KMS (Data Protection keys)
```

CloudFront behaviours are what implement the routing decision in 0003.

Infrastructure as code with **AWS CDK in C#**, so the repository stays one language.
Deployment through GitHub Actions using **OIDC** — no long-lived AWS keys in repository
secrets. Images are SHA-tagged and immutable; never `:latest`.

## Alternatives rejected

- **AWS App Runner + RDS** — materially less to operate and a reasonable starting point.
  Rejected for the target architecture because it gives less control over networking,
  scheduled tasks and blue/green deploys, but it remains a sensible first step if ECS proves
  heavy early on.
- **Lambda + API Gateway** — cookie authentication, Data Protection key management and the
  IGDB token cache all fight the execution model, and cold starts hurt an interactive SPA
  backend.

## Consequences

- Two task definitions and two target groups, not one.
- **Data Protection keys must be persisted** to S3 or DynamoDB with a KMS key before the
  first multi-task deploy. They currently live on the local filesystem, which means every
  deploy or scale-out silently signs every user out. This is the classic ASP.NET-on-AWS
  failure and it is easy to miss until it bites in production.
- **Migrations must move out of startup.** `db.Database.Migrate()` in `Program.cs` races
  when more than one task boots. Run them as a discrete pipeline step before the new
  revision takes traffic, and keep them expand/contract so old and new revisions can run
  against the same schema during a rollout.
- `AddMemoryCache` must become a distributed cache, or each instance fetches its own IGDB
  token and duplicates every query.
- `UseForwardedHeaders` is required behind an ALB, or HTTPS redirection and scheme detection
  misbehave.
- ACM certificates for CloudFront must live in **`us-east-1`** regardless of where the rest
  of the stack runs.
