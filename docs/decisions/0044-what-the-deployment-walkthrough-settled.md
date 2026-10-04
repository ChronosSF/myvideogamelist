# 0044. What the deployment walkthrough settled, and where it found the records wrong

**Status:** Accepted — decided, not yet built. Amends [0005](0005-secrets-handling.md),
[0007](0007-aws-target-architecture.md), [0013](0013-http-caching-policy.md),
[0014](0014-rds-postgresql-over-aurora.md), [0015](0015-fargate-confirmed-and-nat-less-networking.md),
[0033](0033-what-the-api-refuses.md) and [0036](0036-what-a-crawler-is-told.md), each of which
now points here. The key store is [0043](0043-where-the-key-ring-lives.md). The deferred list is
[#109](https://github.com/ChronosSF/myvideogamelist/issues/109).

## Context

Before anything was built on AWS, a step-by-step walkthrough for standing up `dev.myvideogamelist.net`
was written and checked against AWS's documentation and price lists (September 2026). It is the
owner's working document and is not in the repository: it is followed, ticked off and discarded.
What outlives it is this record, which carries the decisions it had to make — the records above
left eight open, numbered D-1 to D-8 there — and the twelve places where checking found something a
record did not know. Like [0041](0041-what-the-roadmap-decided-on-its-own.md), this is one record
rather than seven amendments, because the records are append-only and the decisions were made
together, against one bill.

## Decisions

### The account, the Region, and the credits

**One member account per environment** — `mvgl-dev` now, `mvgl-prod` when there is a production to
run — inside the Organization that already exists, and nothing of MVGL's in the management account
or in the other application's. The bill splits by account for free, `cdk destroy` cannot reach the
wrong application, and abandoning an experiment is closing an account. The same account with
separate stacks was the alternative: one bootstrap fewer, at the cost of all of that, and with
Identity Center already running a second account is a profile name and nothing else.

**The Region is Frankfurt, `eu-central-1`** (D-1). Cached pages come from the edge, but every
API call, every signed-in page and every cache miss goes to the Region, and the owner and the
expected early users are in Europe; an EU Region also keeps members' email addresses in the EU,
and the owner's other application already runs there. It costs about 13% more than `us-east-1`
for this stack — about $74 a month always on against $65 — which on the working pattern below
shrinks to a couple of dollars, because the idle floor is storage and zones. Two things live in
`us-east-1` regardless: the certificate CloudFront uses, and so a second CDK bootstrap and the
`EdgeCert` stack, and the Service Quotas entries for Organizations. Where IGDB's API is served
from was not checked, so no Region is claimed to be closer to it.

**`mvgl-prod` is created now, empty, and holds the domain** (D-2). The SES sandbox is per account
and per Region, so production access has to be requested from the account and Region production
will send from, and a request made in `mvgl-dev` is wasted. An empty account costs nothing. The
domain identity with Easy DKIM and a DMARC record go in first, because AWS says a verified domain
helps the review. **The production access request itself waits until something is live at the
domain.** The owner's other application only got through AWS's review after a "coming soon" page
was put at its URL, and a production environment for this one is not paid for yet; the sandbox,
which delivers to verified addresses, is enough to build and test every email feature in dev. The
request belongs with [#98](https://github.com/ChronosSF/myvideogamelist/issues/98). The rest of
email is [#100](https://github.com/ChronosSF/myvideogamelist/issues/100).

**The apex zone lives in Route 53, in `mvgl-prod`.** The registrar's nameservers had never been
given a zone to serve — they refused queries for the domain — so there was nothing to delegate
`dev.` out of. A hosted zone for `myvideogamelist.net` was created in the production account,
the registrar pointed at its four nameservers, and the DKIM and DMARC records placed there; the
`dev.` zone in `mvgl-dev` is delegated from it by NS records. The production CDK app will look
the zone up rather than create it. It is the first charge in that account, 50 cents a month.

**The credits 0014 and 0015 counted on are not the runway.** Both, and the old roadmap, treated
roughly $200 of new-account credits and a six-month Free plan as what pays for dev. By AWS's Free
Tier FAQ and terms, creating or joining an Organization moves an account to the paid plan,
expires its Free Tier credits at once, and closes the five earning activities — including the $20
for a budget that 0015 says to collect first. The organization already exists, so that has already
happened, and a new member account earns nothing of its own. The documentation does not square
with an organization that still shows a balance, and that could not be resolved from it: **the
Credits page in the management account is the record of what is held**, and the plan is made as
though it may stop. Whatever is there is one pot the other application draws on too, shared with
new member accounts only if credit sharing says so. Two budgets, one organization-wide and one for
`mvgl-dev` alone, both excluding credits and alerting on actual spend, are the first thing created
in hour one. They alert; they do not cap. When the credits run out nothing stops and the card is
charged.

### The cost, and what an idle environment pays for

**Always on is about $74 a month in Frankfurt, $65 in Virginia, not the $40 that 0015 quotes.** 0015's own lines still
hold — RDS 12, storage 2, the balancer 17, a task 9, a zone 0.50 — but it priced one Fargate task
where 0003's design has two, and it missed the public IPv4 charge of $0.005 per address-hour that
has applied since February 2024 to every public address in a VPC: one per task and one per
balancer node, four here, about $14.60. Prices from the AWS Price List files of September 2026;
the numbers are to be amended once seen on a bill.

**The balancer, not the containers, is what an idle environment pays for.** Scaling both services
to zero saves about 25 and leaves 40. Stopping the database as well leaves 28, and RDS restarts a
stopped instance by itself after seven days. Destroying the application stack and stopping the
database leaves the idle floor of about $4.20: storage, secrets, zones, images. On eight hours a
day, twenty-two days a month, that is about $19. **Destroying the stack is the lever that matters**,
which is why the CDK app is split the way the next section splits it. Fargate Spot and ARM64
images change the rate rather than the hours and are below.

### The CDK app: five stacks, split by lifetime

| Stack | Lifetime | Holds |
|---|---|---|
| `Dns` | permanent | the public hosted zone. Alone, because recreating a zone changes its name servers and breaks the delegation |
| `Data` | long-lived | VPC, all four security groups, RDS, secrets, ECR, the ECS cluster, the Cloud Map namespace, the regional certificate, the GitHub OIDC role, the CloudFront KeyValueStore |
| `EdgeCert` | long-lived, `us-east-1` | the certificate CloudFront uses |
| `Migrate` | redeployed each release | one task definition that runs the migration bundle, so it can be deployed and run *before* the application stack changes |
| `App` | **disposable** | the balancer, listeners, target groups, task definitions, both services, log groups, the DNS alias, and later the distribution and its function |

Three placements are deliberate. **All four security groups and the rules between them live in
the data stack**, so the application stack can be destroyed and recreated without touching them and
the two cannot form a dependency cycle. **The Cloud Map namespace lives there**, because a private
DNS namespace is a hosted zone, billed $0.50 on creation unless deleted within twelve hours, and
one in the application stack would be billed on every re-creation. **The KeyValueStore lives there**
so the basic-auth credential survives a destroy. One app, parameterised by an `env` context that
prefixes every name, so `prod` is a second value and a second account rather than a second code
base; the application and migration stacks are instantiated only when an `imageTag` is supplied,
so the long-lived stacks deploy without one and nothing ever falls back to `latest`.

### The network and the database

Two availability zones, because a balancer and an RDS subnet group each need two; no NAT gateway
(0015); three subnet groups, `alb` public, `tasks` public, `data` isolated. The balancer gets its
own subnets so that "the balancer's subnets" is an exact thing to name in the forwarded-headers
trust list. Four security groups: `alb` admits 443 from a CIDR the deployer names — the owner's own
address, `/32`, until CloudFront exists, because 0036 wants dev private and basic auth arrives with
the CDN; when that parameter is absent the group admits only CloudFront's origin-facing prefix list,
so forgetting it fails closed, unreachable rather than public. `api` admits 8080 from `alb` and
`ssr`; `ssr` 3000 from `alb`; `db` 5432 from `api`. Egress is open on the task groups: IGDB, Steam,
ECR and the AWS APIs are all reached through the internet gateway.

**RDS for PostgreSQL 18**, what `compose.yaml` runs, on the `db.t4g.micro` Single-AZ instance 0014
chose, storage autoscaling off, encryption on, seven days of backups, deletion protection on. **Its
credentials are a generated Secrets Manager secret, not RDS's own managed master password**: that
one rotates on a schedule, ECS reads secrets only when a task starts, and a running task would be
left holding a password that no longer works. **The password travels as `PGPASSWORD` beside a
password-free `ConnectionStrings__DefaultConnection`** — `SSL Mode=Require`, since RDS refuses
unencrypted connections from PostgreSQL 15 on — which Npgsql documents among the PostgreSQL
environment variables it honours ("behaves the same as the password connection parameter"), and
which was verified by running the API image with the password only in `PGPASSWORD`: `/readyz`
reports the database reachable, and reports it unreachable with a wrong value. 0005 names the
variable; the password simply exists in one place rather than inside it. The IGDB secret is created by CDK with a placeholder and set by hand, so the
real value never passes through CloudFormation or the repository. 0005 judged rotating the IGDB
secret unnecessary; it costs a minute and is done before the secret goes anywhere near AWS.

### One image, and the environment it runs as

**`ASPNETCORE_ENVIRONMENT` is `Production` in dev too.** The application's only environment switch
is `IsDevelopment()` — migrations at startup, user secrets, exception detail in error bodies, the
unpersisted key ring — and all of them must be off in anything deployed. What distinguishes dev from
prod is configuration, as 0036 already assumes: one image, built once, tagged by SHA, with ECR
tag immutability on. Both images are built from the current layout — the old roadmap's one-line
Dockerfile predates SSR — on the default `aspnet:10.0` tag, not Alpine or chiseled, which ship
without ICU; and `node:24-slim` starting `react-router-serve` directly, not through `npm start`,
because npm swallows `SIGTERM` and ECS would wait the full kill timeout on every deploy. The
migration bundle is produced in the API image's build and sits beside `appsettings.json`, because
EF resolves configuration from the directory the bundle runs in. It runs as a separate task, from
the separate stack, before the application stack changes — the discrete pipeline step 0007 asked for.

**`UseHttpsRedirection` cannot cause the failure 0007 and 0033 describe.** Both warn that, behind a
TLS-terminating balancer, the middleware redirects every request that already arrived over HTTPS.
In a container that exposes no HTTPS port it cannot: it finds no port to redirect to, logs "Failed
to determine the https port for redirect" once, and carries on. The real hazard is the opposite one
— **configuring an HTTPS port** — because then every plain-HTTP health check and every call from the
SSR server would be redirected. So `ASPNETCORE_HTTPS_PORT` and `HTTPS_PORT` are never set, and
`ASPNETCORE_FORWARDEDHEADERS_ENABLED` is never set either: it is the framework's own switch and
applies no `KnownProxies` restriction, so it would put a second, trusting copy of the middleware in
front of the one 0033 made fail-fast. Forwarded headers are still required, for the limiter's
partition key and for HSTS, which is what 0033 was right about.

### The two tasks, their health, and how one finds the other

One task per service, 0.25 vCPU and 0.5 GB, unmeasured; **one task per service is what makes
`AddMemoryCache` correct**, since the IGDB token, the caches and both limiters are per process
(0033, 0034), and the desired count is not raised to "test scaling" before the distributed cache
of [#101](https://github.com/ChronosSF/myvideogamelist/issues/101). Minimum healthy 100% and
maximum 200%, so a deploy starts the new task before stopping the old, with ECS's deployment
circuit breaker — its own mechanism for marking a revision that never passes its health checks as
failed, not the alarm-driven rollback #109 defers.

**The target group's health check is `/healthz`, never `/readyz`.** `/readyz` makes a live IGDB
query behind a pipeline with a thirty-second ceiling, so in an IGDB outage it can outlast the
check's timeout, and the balancer would then remove the very instance 0034 says must stay in
rotation. The SSR target group checks `/robots.txt`, a resource route that makes no upstream call.
**`/healthz` and `/readyz` are routed through the balancer in dev** (D-5), since they are not under
`/api/` and would otherwise reach the SSR server and 404; prod decides again, because each
`/readyz` is an IGDB call against the four-a-second budget, open to anyone.

**The SSR server reaches the API over Cloud Map DNS, not ECS Service Connect.** Service Connect
adds an Envoy sidecar that AWS recommends 256 CPU units for — doubling these tasks — and, in
`awsvpc` mode, routes balancer traffic through the agent, which forwards over loopback;
`ProxyHeaders.cs` clears loopback from the trust list on purpose, so the API would ignore the
balancer's headers unless loopback were trusted again. Cloud Map is a name and nothing else: the
API sees the SSR task's own address, and the cost is the zone already counted. What it lacks is
draining: for a few seconds in a deploy the name can resolve to the task being stopped, which the
loaders already turn into a deliberate, uncacheable 502 (0013). Revisit with the distributed cache.

**Fargate Spot after the first deploy, never for the migration task** (D-4). AWS is plain that a
service with one task is interrupted until capacity returns and is never replaced with on-demand;
dev can live with that, and the first deploy keeps the variable out.

### The pipeline

**No AWS key is ever stored in GitHub.** One OIDC provider, and a deploy role whose trust policy
matches `sub` with `StringEquals` on `repo:ChronosSF/myvideogamelist:environment:dev` — never a
wildcard, so only a job that declares that GitHub environment in this repository can assume it, and
the environment's deployment branches are restricted to `master`. The role can assume the CDK
bootstrap roles, push to the two repositories, run the migration task and read service health, and
little else; everything it deploys, it deploys as the CDK roles. **The long-lived stacks are not
deployed by the pipeline**: they change rarely, the role that could change them would have to be
far broader, and a mistake in one of them is a database.

**Every merge builds and pushes; only an awake environment deploys** (D-6). Deploying the
application stack *recreates* it if it was destroyed, so an unconditional deploy-on-merge silently
un-parks the environment and the balancer starts billing again. So the workflow always builds and
pushes — ECR holds an image for every commit on `master`, at cents — and deploys only when a
repository variable says the environment is awake. The migration task's exit code fails the run.

### CloudFront, and what it may believe

**One cache policy for every cached page, with a minimum TTL of 0.** The managed policies do not
fit: `CachingOptimized` has a minimum of one second, and any minimum above zero makes CloudFront
cache a response the origin marked `private, no-store`, which is the root's fail-closed default in
0013; the `UseOriginCacheControlHeaders` pair put every cookie in the cache key, giving each
signed-in reader a private copy of a public page. Default TTL 0, so a response that states no
policy is not cached; maximum a year, so it clears the game page's day of stale-while-revalidate;
the cache key is 0032's six browse parameters, `page`, and React Router's `_routes`. `/api/*` is
uncached with every viewer header forwarded — **that is where `X-MVGL-Request` has to survive**
(0033), and no CORS policy is added anywhere. `/lists*`, `/wishlist*`, `/user*` and `/news*` are
uncached by an explicit behaviour ending in `*` with no slash, because React Router 8 asks for
`/lists.data`, not `/lists/…`, and a pattern with a slash would let the `.data` request fall
through to the cached default. **Error caching minimum TTL is 0 for 500 to 504**, because
CloudFront otherwise keeps a `no-store` 502 for ten seconds; 404 is left alone and stays a real 404.
**Every deploy invalidates `/*`**: a cached page names hashed bundles the new container no longer
has, because the bundles are served by the SSR container and not from S3.

**Basic auth is a CloudFront Function on every behaviour, the default included**, reading the
expected value from the KeyValueStore so it is never in the repository, and failing closed when the
key is missing. **Three paths are exempt** (D-8): the game page's reviews, community scores and
community times. The client fetches them with `credentials: 'omit'` on purpose (0028), so the
sign-in cookie cannot reach endpoints that answer everybody alike — and HTTP authentication counts
as a credential too, so the browser withholds the `Authorization` header from exactly those
requests, and behind basic auth every game page's community section would be empty. They are
read-only, public by design, and expose nothing the production site will not.

**The balancer admits only CloudFront, and then stands aside on the viewer's address** (D-7). Once
the distribution exists, the `alb` group admits 443 only from the managed prefix list
`com.amazonaws.global.cloudfront.origin-facing` — fifty-five rules against a quota of sixty, so
one port, and the port-80 listener goes. Then: CloudFront appends the viewer's address to
`X-Forwarded-For` and the balancer appends CloudFront's, and 0033 says "a CDN in front of it is 2".
**Raising `ForwardLimit` to 2 does not by itself work.** ASP.NET's middleware checks the trust
list before *each* hop: having taken the edge server's address from the right, it looks for a
CloudFront address in `KnownNetworks`, finds none among the balancer's subnets, and stops. The
symptom is quiet — the login limiter partitions by edge server rather than by person. Trusting
every CloudFront origin-facing range instead would mean dozens of ranges that are AWS's to change,
failing silently when stale. So the balancer is set to `routing.http.xff_header_processing.mode=preserve`,
`ForwardLimit` stays 1 and `KnownNetworks` stays the balancer's subnets: the right-most entry is
then CloudFront's, and is the viewer. **That is trustworthy only because nothing but CloudFront can
reach the balancer**, which is why the prefix-list rule must be live before `preserve` is, and why
opening that security group later would let callers choose their own address.

### Two things the walkthrough found and the code has since fixed

`vite.config.ts` did its certificate work at module load and spawned `dotnet dev-certs`, so the
SSR image could not be built on a `node:24` image; CI never caught it because GitHub's runners ship
with `dotnet`. The certificate block now runs only when Vite's command is `serve`. And the home
page could go out cacheable while degraded on one path — the API up, IGDB down, a 200 with nothing
in it — which 0013's amendment records and `HomeResponse.degraded` closes. A job that builds the
client image is [#106](https://github.com/ChronosSF/myvideogamelist/issues/106).

## Consequences

- **The records amended keep their text.** 0014's and 0015's credit assumptions, 0015's $40,
  0033's "a CDN in front of it is 2" and 0007's and 0033's redirect warning are all wrong as
  written and are left as written, with a status line pointing here. `appsettings.json` and
  `ProxyHeadersOptions` say the corrected thing, since a comment is not a record.
- **D-1 is decided; D-2 is recorded as recommended.** Frankfurt is the owner's choice. Whether
  to create `mvgl-prod` early is recorded as the walkthrough recommended it and is overturned by
  editing this record's status line, not by a new record.
- **Nothing here is proved.** This is the plan the environment is built to; the figures are to be
  amended once seen on a bill, and the two things the code cannot test — a session surviving a
  redeploy (0043) and the viewer's address surviving two hops — are the first things verified after
  each milestone.
- **What is deliberately left for later** is #109: an internal balancer behind a CloudFront VPC
  origin, which removes the balancer's two addresses and the side door with them; HSTS on documents
  through a response headers policy; a WAF; the sporadic 502 from Node closing idle connections
  before the balancer does; database hardening; ARM64; Service Connect once a service has more than
  one task; blue/green; and alarms at all. Production's own list — private subnets behind NAT,
  Multi-AZ, the cookie domain, indexing — is [#98](https://github.com/ChronosSF/myvideogamelist/issues/98).
