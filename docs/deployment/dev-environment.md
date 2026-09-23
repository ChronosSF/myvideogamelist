# Deploying the dev environment to AWS

A step-by-step guide to standing up `dev.myvideogamelist.net`, written to be followed from top to
bottom and ticked off. What you end up with: a dedicated `mvgl-dev` account inside the AWS
Organization you already have, reached through the IAM Identity Center you already use; the ASP.NET
API and the Node SSR server as two ECS Fargate services behind one Application Load Balancer;
PostgreSQL on a private `db.t4g.micro`; CloudFront in front, with the cache behaviours the routes'
`Cache-Control` headers assume, basic auth, and `noindex` on every response; all of it defined in
one CDK app in C# and deployed from GitHub Actions through OIDC. Until launch `dev` is the only
environment and doubles as the staging rehearsal — `prod` is later stamped out of the same code with
a different environment name.

The architecture is already decided and is not reopened here: ADRs
[0003](../decisions/0003-two-process-deployment.md),
[0007](../decisions/0007-aws-target-architecture.md),
[0014](../decisions/0014-rds-postgresql-over-aurora.md) and
[0015](../decisions/0015-fargate-confirmed-and-nat-less-networking.md). Where checking turned up
something those records did not anticipate, this guide follows the record and says so; the full list
is in [Where this guide adds to the decision records](#where-this-guide-adds-to-the-decision-records).

Nothing deployment-related exists in the repository yet: no Dockerfile, no CDK project, no deploy
workflow. So some steps are marked **Build first**. They say what has to be built, precisely enough
to be a work order, and the step after them assumes it exists.

## How to read this

- Every step is a checkbox. Steps are numbered within their phase.
- **Build first** — code that has to be written before the next step can run.
- **Decision needed** — a call this guide will not make for you. Each one gives a recommendation.
- **Verify** — closes each phase: what to run and what to expect. Do not start the next phase on a
  failed Verify.
- Values in `<ANGLE_BRACKETS>` are yours to fill in. `mvgl-dev` is used throughout as the AWS CLI
  profile name, the account name and the ECS cluster name.
- Commands are one to a line and written for a POSIX shell; Git Bash on Windows is fine. The `aws`,
  `cdk`, `docker` and `dotnet` commands are identical in PowerShell.
- Facts were checked against official documentation on 21 September 2026, and prices against the
  AWS Price List files published 11–18 September 2026. Where something could not be verified, the
  text says so in plain words. The sources are listed at the end.

## What you end up with

```
   myvideogamelist.net zone (wherever it is hosted today)
        │  NS records delegate dev.myvideogamelist.net
        ▼
   Route 53 public zone  dev.myvideogamelist.net          (mvgl-dev account)
        │  alias: ALB in milestone 1, CloudFront in milestone 2
        ▼
   viewer ──HTTPS──► CloudFront                                          ← milestone 2
                       certificate in us-east-1
                       viewer-request function: basic auth
                       /api/*  uncached, every header forwarded (X-MVGL-Request, cookie)
                       pages   cached on the origin's Cache-Control, query-string cache key
                     │ HTTPS, Host header forwarded
   ┌─────────────────▼───────────── VPC, two AZs, no NAT gateway ──────────────────────┐
   │ public subnets "alb"     ALB :443, regional certificate                           │
   │                            ├─ /api/*, /healthz, /readyz ──► API target group      │
   │                            └─ everything else ────────────► SSR target group      │
   │                                                                                   │
   │ public subnets "tasks"   ECS Fargate, public IPs, ingress from the ALB only       │
   │    ┌──────────────┐  http://api.mvgl-dev.internal:8080   ┌───────────────┐        │
   │    │ SSR  (Node)  │ ───── Cloud Map private DNS ───────► │ API (ASP.NET) │ ──► IGDB, Steam
   │    │ :3000        │                                      │ :8080         │        │
   │    └──────────────┘                                      └───────┬───────┘        │
   │ isolated subnets "data"                                          ▼                │
   │                          RDS PostgreSQL, db.t4g.micro, Single-AZ, no public endpoint
   └───────────────────────────────────────────────────────────────────────────────────┘
   Beside the VPC: ECR (SHA-tagged images) · Secrets Manager (IGDB, database) ·
                   the Data Protection key store · CloudWatch Logs
   GitHub Actions ──OIDC──► deploy role ──► CDK bootstrap roles ──► CloudFormation
```

Two milestones keep the first success small. **Milestone 1** is both containers behind the ALB on
the dev hostname with a regional certificate. **Milestone 2** puts CloudFront in front.

## Prerequisites

| Tool | Version | Why | Check |
|---|---|---|---|
| AWS CLI | v2, 2.22 or later | `sso-session` profiles; browser sign-in (PKCE) is the default from 2.22.0 | `aws --version` |
| Node.js | 24 | `package.json` requires `>=24` and CI builds on 24.x; it also runs the CDK CLI | `node --version` |
| AWS CDK CLI | current 2.x | `npm install -g aws-cdk` | `cdk --version` |
| .NET SDK | 10 | the API targets `net10.0`; CDK apps in C# need .NET 8 or later | `dotnet --version` |
| `dotnet-ef` | 10.0.x | only to try the migration bundle locally; the image build installs its own | `dotnet ef --version` |
| Docker Desktop | current | already needed for local PostgreSQL; builds the two images for the first deploy | `docker version` |

You also need: sign-in to the organization's management account with rights to create accounts and
administer IAM Identity Center; access to the Twitch developer console that owns the IGDB
credentials; and access to wherever the DNS for `myvideogamelist.net` is hosted.

## Running cost and how to pause it

Read this before Phase 1. It decides how you use everything after it.

### What it costs left running

Prices are on-demand, in USD, for 730 hours. Three Regions are shown because the Region is yours to
choose (step 1.5).

| Item | How it is counted | us-east-1 | eu-west-1 | eu-central-1 |
|---|---|---|---|---|
| Fargate, API task | (0.25 vCPU + 0.5 GB) × 730 h | 9.01 | 9.01 | 10.36 |
| Fargate, SSR task | the same again | 9.01 | 9.01 | 10.36 |
| Public IPv4, the two tasks | 2 × $0.005 × 730 h | 7.30 | 7.30 | 7.30 |
| ALB, hourly charge | $0.0225 / $0.0252 / $0.027 × 730 h | 16.43 | 18.40 | 19.71 |
| Public IPv4, the ALB | one address per AZ, two AZs | 7.30 | 7.30 | 7.30 |
| RDS `db.t4g.micro`, Single-AZ | $0.016 / $0.017 / $0.019 × 730 h | 11.68 | 12.41 | 13.87 |
| RDS storage, 20 GB gp3 | $0.115 / $0.127 / $0.137 per GB-month | 2.30 | 2.54 | 2.74 |
| Secrets Manager | 2 secrets × $0.40 | 0.80 | 0.80 | 0.80 |
| Route 53 | public dev zone + Cloud Map private zone, $0.50 each | 1.00 | 1.00 | 1.00 |
| ECR | about 1 GB of images at $0.10 | 0.10 | 0.10 | 0.10 |
| **Always on** | | **≈ 65** | **≈ 68** | **≈ 74** |

The Fargate line is `(0.25 × $0.04048 + 0.5 × $0.004445) × 730 = $9.01` in us-east-1 and eu-west-1,
and `(0.25 × $0.04656 + 0.5 × $0.00511) × 730 = $10.36` in eu-central-1. Not in the table because
they round to nothing at dev volume: ALB capacity units ($0.008 per LCU-hour, and dev traffic is a
small fraction of one), CloudFront (the always-free allowance is 1 TB out, 10 million requests and
2 million function invocations a month), CloudWatch Logs (the first 5 GB ingested is free), ACM
certificates, standard SSM parameters, and data transfer out at $0.09 per GB beyond the global free
allowance. A customer-managed KMS key, if you choose one anywhere, adds $1.00 a month each.

**This is not the ~$40 that ADR 0015 and ROADMAP §6 quote.** Their own lines still hold — RDS 12,
storage 2, ALB 17, a Fargate task 9, a hosted zone 0.50. What they leave out is the second Fargate
task the two-process design requires (+9), and the public IPv4 charge of $0.005 per address-hour
that has applied since 1 February 2024 to every public address in a VPC: one per public-subnet
task and one per ALB node, so four here (+14.60). Secrets and the private zone add about another
1.30.

### The three pause levers

Each is a step in [Phase 8](#phase-8--park-it-pause-and-resume), with the exact commands.

| State | What is still billed | us-east-1 | eu-west-1 | eu-central-1 |
|---|---|---|---|---|
| Always on | everything | 65 | 68 | 74 |
| Lever 1 — both services at zero tasks | ALB and its addresses, RDS, the small items | 40 | 43 | 46 |
| Levers 1 + 2 — and RDS stopped | ALB and its addresses, storage, the small items | 28 | 30 | 32 |
| Lever 3 — app stack destroyed, RDS running | RDS, storage, the small items | 16 | 17 | 19 |
| **Levers 3 + 2 — the idle floor** | storage, secrets, zones, images | **4.20** | **4.44** | **4.64** |
| Working pattern — awake 176 h a month, idle floor otherwise | | ≈ 19 | ≈ 20 | ≈ 21 |

The working-pattern row is eight hours on twenty-two days. It is approximate: the ALB and RDS bill
started hours in full, and RDS takes minutes to start. The lesson of the table is that the load
balancer, not the containers, is what an idle environment pays for — scaling to zero saves 25 and
leaves 40. **Destroying the app stack is the lever that matters**, which is why the CDK app is
split the way Phase 5 splits it.

Two further levers change the rate rather than the hours. Fargate Spot takes up to 70% off the two
Fargate lines (step 5.6 — with one task per service, a Spot interruption is an outage until
capacity returns, which dev can live with). ARM64 Fargate is 20% cheaper per vCPU and GB and both
base images publish `arm64` variants; it is left for later because it complicates the image build.

### The burn against a shared credit pot

Whether there are credits at all is step 0.1. Whatever is there is one pot for the whole
organization, and the other application draws on it too:

```
months of runway = credits remaining ÷ (MVGL monthly cost + the other application's monthly cost)
```

| Credits left | MVGL always on, alone | plus another app at $30 | plus another app at $65 | MVGL on the working pattern, alone |
|---|---|---|---|---|
| $100 | 1.5 months | 1.1 | 0.8 | 5.3 |
| $200 | 3.1 months | 2.1 | 1.5 | 10.6 |

The figures use us-east-1, and $30 and $65 are placeholders for a number only you know. Two limits
sit on top: Free Tier credits expire twelve months after the account was opened whatever is left,
and an account in an Organization is on the paid plan, so **when the credits run out nothing stops
— the card is charged**. That is what Phase 0 is for.

## Decisions at a glance

| # | Decision | Where | Recommendation |
|---|---|---|---|
| D-1 | Region | step 1.5 | the Region nearest you and your expected audience; an EU Region if either is in the EU |
| D-2 | Create `mvgl-prod` now, empty, to start the SES clock | step 2.2 | yes |
| D-3 | Where Data Protection keys are persisted | step 3.1 | SSM Parameter Store |
| D-4 | Fargate Spot for dev | step 5.6 | on-demand for the first deploy, Spot afterwards |
| D-5 | Route `/healthz` and `/readyz` through the ALB | step 5.7 | yes in dev; decide again for prod |
| D-6 | Whether a merge to `master` deploys while the environment is parked | step 9.3 | no — gate it on a repository variable |
| D-7 | How the API learns the viewer's address behind CloudFront | step 10.6 | ALB `preserve` mode, `ForwardLimit` stays 1 |
| D-8 | Exempt the three public community endpoints from basic auth | step 10.5 | yes |

---

## Phase 0 — Credits and guard rails

- [ ] **0.1 Find out what is actually paying for this.** Sign in to the **management account**, open
  *Billing and Cost Management → Credits*, and for each credit note the type, the amount remaining,
  the expiry date, the applicable products and the owning account.

  What AWS publishes, as of this writing:

  - **Creating or joining an Organization moves an account from the Free plan to the paid plan,
    automatically.** The Billing User Guide, the Free Tier FAQ and the Free Tier terms all say so.
  - **The FAQ and the terms also say the Free Tier credits go.** The FAQ, under "What happens when
    my account creates or joins an AWS Organization?": "your Free Tier credits expire immediately,
    and your account will be ineligible to earn more AWS Free Tier credits." The terms (last
    updated 9 July 2025): an account that enrols in AWS Organizations "will no longer be able to
    use or earn credits offered under the Free Tier." The five credit-earning activities, the
    AWS Budgets one included, expire at the same moment.
  - **A new member account earns no credits of its own.** The terms: "An Organization (under AWS
    Organizations) can only benefit from Offers from one account in the Organization", with usage
    aggregated across all accounts; the FAQ rules out anyone who has, or has had, an AWS account.
  - **Credits that do exist are shared across the organization by default.** A credit covers the
    account that owns it first, then the account with the highest spend. Only the management
    account can turn sharing off or restrict it, under *Billing preferences → Credit sharing
    preferences*, where **Default sharing for newly created member accounts** decides whether the
    account you are about to create takes part.

  The first two points do not square with an organization that still shows a Free Tier balance, and
  I could not resolve that from documentation: the User Guide page describing the plans mentions
  the automatic upgrade but says nothing about credits being removed. **The Credits page is the
  record of what you hold.** If it lists an active Free Tier credit, it is being applied — but plan
  as though it may stop, and ask AWS through an *Account and billing* support case, which needs no
  paid support plan. If the credits are of another type (Activate or another promotion), the
  expiry rule above does not apply to them and the sharing rules do.

  What follows for the account structure in Phase 1: **nothing**. A dedicated member account
  neither earns nor forfeits credits. It draws on the same pot as long as credit sharing is active
  for it, and creating the organization — which has already happened — was the only step that
  could cost any.

- [ ] **0.2 Confirm credit sharing covers new accounts.** In *Billing preferences → Credit sharing
  preferences*, check that sharing is active and that **Default sharing for newly created member
  accounts** is selected.

- [ ] **0.3 Create an organization-wide cost budget** in the management account: monthly,
  recurring, a fixed amount you would be unhappy to exceed, alerts at 50%, 80% and 100% of
  **actual** spend to your email. Two settings matter more than the amount:

  - **Exclude credits** in the budget's advanced options. A budget that counts credits reads close
    to zero until the day they run out, which is the day it is too late.
  - Use actual thresholds, not only forecast ones. AWS needs about five weeks of history before a
    forecast alert can fire.

  Budgets that only alert are free. They are not a cap: billing data is refreshed at least once a
  day, not continuously, so an alert trails the spend by hours.

**Verify**

```bash
aws budgets describe-budgets --profile <MGMT_PROFILE> --account-id <MGMT_ACCOUNT_ID> --query "Budgets[].{Name:BudgetName,Limit:BudgetLimit.Amount,Credits:CostTypes.IncludeCredit}"
```

Expect your budget, with `"Credits": false`.

---

## Phase 1 — An account for MVGL inside the organization

- [ ] **1.1 Settle the account structure.** Recommended: **one member account per environment** —
  `mvgl-dev` now, `mvgl-prod` when there is a production to run — and nothing of MVGL's in the
  management account or in the other application's account.

  - *Not the management account.* AWS's own guidance is to keep workloads out of it: service
    control policies do not restrict it, and it is the account that can close the others.
  - *Not the other application's account.* The two would share service quotas, IAM, one CDK
    bootstrap and one blast radius, and their costs could be told apart only by tags. In separate
    accounts the bill splits by account for free, `cdk destroy` cannot reach the wrong application,
    and abandoning an experiment is closing an account.
  - *The alternative* is the same account with separate stacks: one bootstrap and one profile
    fewer, which is a real saving in ceremony for one person. It costs the isolation above, and
    with Identity Center already running a second account adds a profile name and nothing else, so
    the recommendation stands.

- [ ] **1.2 Create the member account** from the management account. The email address must not
  belong to any other AWS account; a plus-address on a mailbox you control works if your mail
  provider supports them.

  ```bash
  aws organizations create-account --profile <MGMT_PROFILE> --email <UNIQUE_ADDRESS> --account-name mvgl-dev
  ```

  The call returns a request id beginning `car-`. Poll it:

  ```bash
  aws organizations describe-create-account-status --profile <MGMT_PROFILE> --create-account-request-id <CAR_ID>
  ```

  Wait for `"State": "SUCCEEDED"` and note the `AccountId`. Organizations creates the role
  `OrganizationAccountAccessRole` in the new account, and the account has **no root user
  credentials** — nobody can sign in as its root unless account recovery is enabled later. Leave it
  that way. If the call fails on the account quota: the default is 10 accounts, and AWS notes that
  new organizations may start lower; the increase is requested from the management account, in
  Service Quotas, in `us-east-1`.

- [ ] **1.3 Give your Identity Center user access to it.** In the IAM Identity Center console:

  1. *Multi-account permissions → Permission sets → Create permission set*, choose the predefined
     **AdministratorAccess** if you do not already have one. `cdk bootstrap` creates IAM roles, so
     anything much narrower will fail there.
  2. *Multi-account permissions → AWS accounts*, tick `mvgl-dev`, **Assign users or groups**, pick
     your user (or a group), pick the permission set, **Submit**. Provisioning takes a few minutes.

- [ ] **1.4 Add a CLI profile.** If the other application already gave you an `sso-session` block
  in `~/.aws/config`, reuse it and add only the profile; otherwise run `aws configure sso` and
  answer its prompts.

  ```ini
  [sso-session <YOUR_SSO>]
  sso_start_url = https://<YOUR_PORTAL>.awsapps.com/start
  sso_region = <IDENTITY_CENTER_REGION>
  sso_registration_scopes = sso:account:access

  [profile mvgl-dev]
  sso_session = <YOUR_SSO>
  sso_account_id = <DEV_ACCOUNT_ID>
  sso_role_name = AdministratorAccess
  region = <REGION>
  output = json
  ```

  `sso_region` is where Identity Center lives, which need not be where MVGL runs.

  ```bash
  aws sso login --profile mvgl-dev
  ```

- [ ] **1.5 Choose the Region.**

  > **Decision needed (D-1) — Region.** Cached pages will come from CloudFront's edge wherever the
  > reader is, but every API call and every cache miss goes to the Region, so choose by where you
  > and your expected signed-in users are. If either is in the EU, an EU Region also keeps
  > members' email addresses in the EU. For this stack eu-west-1 costs about 5% more than
  > us-east-1 and eu-central-1 about 13% more (the table above). With no reason to prefer anywhere,
  > us-east-1 is cheapest and saves a step, because the CloudFront certificate has to live there
  > regardless. **Whatever you choose, two things stay in `us-east-1`:** the ACM certificate
  > CloudFront uses — and so a second CDK bootstrap and the `Mvgl-dev-EdgeCert` stack — and the
  > Service Quotas entries for AWS Organizations. CloudFront, Route 53 and IAM are global and
  > indifferent to the choice; everything else in this guide lives in the Region you pick.

- [ ] **1.6 Bootstrap the account for CDK**, in your Region and in `us-east-1`.

  ```bash
  cdk bootstrap aws://<DEV_ACCOUNT_ID>/<REGION> aws://<DEV_ACCOUNT_ID>/us-east-1 --profile mvgl-dev --termination-protection
  ```

  How this works with an SSO profile: the CDK CLI reads the same `~/.aws/config`, so `--profile
  mvgl-dev` uses the temporary credentials from `aws sso login`. When the session expires the CLI
  fails with an expired-token error and the fix is to log in again. Bootstrapping deploys a
  CloudFormation stack named `CDKToolkit` into each account-and-Region pair: an S3 bucket and an ECR
  repository for assets, an SSM parameter recording the bootstrap version, and five IAM roles. The
  CLI assumes the deploy, publishing and lookup roles; CloudFormation itself runs as the fifth,
  which has `AdministratorAccess` by default. That indirection is what lets GitHub Actions deploy
  in Phase 9 with a role that can do little more than assume these. Re-running the command is safe
  and is how the bootstrap stack is upgraded.

- [ ] **1.7 Add a second budget for this account alone**: as 0.3, filtered to the linked account
  `mvgl-dev`, sized from the always-on figure for your Region. It is the alarm for "I forgot to
  park it".

**Verify**

```bash
aws sts get-caller-identity --profile mvgl-dev
```

Expect `"Account": "<DEV_ACCOUNT_ID>"` and an ARN containing `AWSReservedSSO_AdministratorAccess_`.

```bash
aws ssm get-parameter --profile mvgl-dev --region <REGION> --name /cdk-bootstrap/hnb659fds/version --query Parameter.Value
```

Expect a version number. Repeat with `--region us-east-1`.

---

## Phase 2 — Start the slow clocks

None of these blocks the deploy. Each has a wait in it that you do not want to discover later.

- [ ] **2.1 Rotate the IGDB client secret before it goes anywhere near AWS.** ROADMAP §1 and §7
  list this as outstanding. (ADR 0005 judged it unnecessary because the values never reached git
  history; it costs a minute, so this guide does it.) In the Twitch developer console open the
  application and choose **New Secret** — Twitch's documentation is explicit that this invalidates
  the previous secret at once, so local development breaks until you run:

  ```bash
  dotnet user-secrets set "Igdb:ClientSecret" "<NEW_SECRET>" --project MyVideoGameList.Server
  ```

  With the API running locally, `curl http://localhost:5039/readyz` should answer `Healthy`.

- [ ] **2.2 SES.** Nothing sends email yet, and `mvgl-dev` can stay in the SES sandbox for good: a
  sandboxed account delivers to verified addresses, which is all a dev environment needs. The
  reviewed request is *production access*, and the sandbox is **per account and per Region** — so
  the request has to be made in the account and Region production will send from, and one made in
  `mvgl-dev` would be wasted.

  > **Decision needed (D-2) — create `mvgl-prod` now?** An empty account costs nothing.
  > Recommended: create it as in 1.2–1.4, and in it, in the production Region: create a domain
  > identity for `myvideogamelist.net` with Easy DKIM, publish the three CNAME records it gives you
  > in the `myvideogamelist.net` zone (SES allows up to 72 hours to detect them), add a DMARC
  > record, and then request production access as *Transactional*. AWS says it gives an initial
  > response within 24 hours and may ask for more, and that verifying the domain first helps. The
  > form asks for the website URL. **I could not verify how reviewers treat a site that is not yet
  > public**; if the request is declined it can be resubmitted once something is live at the URL.

- [ ] **2.3 Find out whether the new account may create CloudFront distributions.** Several reports
  on AWS re:Post describe new accounts refused with "Your account must be verified before you can
  add new CloudFront resources", cleared only by a support case. This is community-reported, not
  documented, and I could not verify whether it affects member accounts of an organization. It is
  cheap to find out now rather than at Phase 10: create a throwaway distribution in `mvgl-dev` from
  the console, against any origin, then disable and delete it. If it is refused, open the support
  case today.

- [ ] **2.4 Check the organization's account quota** if D-2 added an account (see 1.2).

**Verify** — local `/readyz` answers `Healthy` on the new secret; the SES identity, if created,
shows its DKIM status as pending or successful; the throwaway distribution was created, or the
support case is open.

---

## Phase 3 — Application changes the deployment needs

Most of what deployment needs is already in the code: forwarded headers, the write guard, the two
health endpoints, per-route `Cache-Control`, `SITE_URL` / `SITE_INDEXABLE`, and migrations that run
at startup in Development only. Two things are not, and both block the first deploy. A third does
not block it, and should be closed before CloudFront arrives in Phase 10.

- [ ] **3.1 Build first — persist the Data Protection keys.** `Program.cs` has no
  `AddDataProtection` call, so the key ring that encrypts the Identity cookie lives on the
  container's own filesystem. Every new task starts with a new key ring, so **every deploy signs
  everybody out**. ADR 0007 requires this fixed before the first deploy and names "S3 or DynamoDB
  with a KMS key".

  > **Decision needed (D-3) — where the keys live.**
  >
  > | Option | What it is | Needs | Trade-off |
  > |---|---|---|---|
  > | **A. SSM Parameter Store** | `Amazon.AspNetCore.DataProtection.SSM` — owned by AWS on NuGet, 4.0.3 released April 2026. `PersistKeysToAWSSystemsManager("/mvgl/dev/data-protection")` stores each key as a KMS-encrypted `SecureString` parameter | On the task role: `ssm:PutParameter` and `ssm:GetParametersByPath` on that path (its README adds `ssm:DeleteParameter` for key deletion on .NET 9 and later, and KMS permissions if you name a customer-managed key). A configuration switch so `dotnet run` does not call AWS | Closest to what 0007 meant: KMS-backed and outside the database. Puts an AWS SDK in the API. Standard parameters are free |
  > | **B. The application database** | `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` — Microsoft's, versioned with ASP.NET. `PersistKeysToDbContext<ApplicationDbContext>()`, the context implements `IDataProtectionKeyContext`, one migration adds `DataProtectionKeys` | Nothing in AWS | No AWS coupling, identical locally, keys travel with a database restore. But the keys that can forge a session sit in the database they protect, in plain XML unless a `ProtectKeysWith…` call is added — Microsoft's documentation warns that naming a persistence location turns off the default encryption at rest. RDS storage encryption covers the disk, not a dump. The table has no `UserId`, so `UserOwnedDataTests` and the export manifest should not notice it; run them to confirm |
  > | **C. S3 with KMS, as the ROADMAP words it** | A hand-written `IXmlRepository` | A bucket, a key, code and tests | I found no maintained package for S3 or DynamoDB (the search was not exhaustive). The community `AspNetCore.DataProtection.Aws.S3` repository was archived in 2022 and its README sends readers to option A |
  >
  > Recommended: **A**; **B** if you would rather keep AWS SDKs out of the API.

  Whichever you choose: call `SetApplicationName("MyVideoGameList")` so that a change to the
  image's working directory cannot silently orphan every cookie, and record the choice in a
  decision record — it departs from the letter of 0007. The proof is step 7.8: a session survives a
  forced redeploy. It cannot be proved locally, because on a developer machine the default key
  ring already persists in the user profile.

- [ ] **3.2 Build first — let the client build without `dotnet` or the dev certificate.**
  `myvideogamelist.client/vite.config.ts` does its certificate work at module load: if the PEM
  files are missing it spawns `dotnet dev-certs` and throws when that fails, and it reads both
  files unconditionally for `server.https`. `npm run build` loads the same file, and a `node:24`
  image has no `dotnet`, so **the SSR image cannot be built today**. CI has not caught this, most
  likely because GitHub's Ubuntu runners ship with `dotnet`. Move the certificate block and the
  `server.https` value behind a check that the command is `serve` (`defineConfig` accepts a
  function that is passed `command`), so `react-router build` touches neither.

- [ ] **3.3 Build first, before Phase 10 — an IGDB outage must not be cached as a healthy home
  page.** Not a blocker for milestone 1; it becomes real the day a CDN is in front. When IGDB fails
  and the API is up, `HomeService` catches the failure and `/api/home` answers **200 with an empty
  payload**, which it keeps for a minute instead of fifteen. The loader in `HomePage.tsx` counts
  only a rejected `fetch` or a non-OK status as degraded, so that empty page goes out under
  `CACHE_HOME` — `s-maxage=300, stale-while-revalidate=600`. ADR 0013 records the degraded home
  page as fixed; the fix covers an unreachable API, not this path. Behind CloudFront an IGDB blip
  would pin an empty home page at the edge for five minutes and let it be served stale for ten
  more. No CloudFront setting can tell the two 200s apart, so the fix is in the code: the API has
  to say that its answer is degraded — a field in the payload or a header on the response — and
  the loader has to attach `no-store` when it sees it. I read this in the code and did not run it;
  the Verify in Phase 4 shows it either way.

**Verify** — `npm run build` succeeds in `myvideogamelist.client` with `dotnet` off the `PATH`
(or, simply, inside the image build in Phase 4); `npm run dev` still serves HTTPS on 58546;
`dotnet test` and `npm run test` still pass.

---

## Phase 4 — Two container images

**Build first.** Two processes (ADR 0003) are two images. The ROADMAP's one-line Dockerfile
description predates SSR — it has `node:22` building a SPA that ASP.NET serves — and should not be
followed.

- [ ] **4.1 The API image** — `MyVideoGameList.Server/Dockerfile`, build context the repository
  root so the root `NuGet.Config` applies.

  1. *Build stage*, `mcr.microsoft.com/dotnet/sdk:10.0`: restore from the project file first for
     layer caching, then `dotnet publish MyVideoGameList.Server -c Release -o /app/publish`. The
     test project is not copied in.
  2. *Bundle stage*, from the build stage: install `dotnet-ef` 10.0.x, set
     `ASPNETCORE_ENVIRONMENT=Production`, and run `dotnet ef migrations bundle --project
     MyVideoGameList.Server --configuration Release --target-runtime linux-x64 --output
     /app/efbundle`. EF's documentation asks for the environment to be set explicitly when a bundle
     is generated and when it runs, because its tooling otherwise assumes `Development`. Generating
     the bundle executes the application's startup code as far as building the host; it needs no
     database. I have not run this against this codebase.
  3. *Final stage*, `mcr.microsoft.com/dotnet/aspnet:10.0` — **the default tag, not Alpine or
     chiseled**, which ship without ICU and work only in invariant-globalisation mode. `WORKDIR
     /app`, copy the publish output and `efbundle` into it, `USER $APP_UID` (the image's non-root
     user), `EXPOSE 8080` (the image's default port since .NET 8), `ENTRYPOINT ["dotnet",
     "MyVideoGameList.Server.dll"]`.
  4. No secret and no environment-specific value is baked in. The bundle sits beside
     `appsettings.json` on purpose: EF resolves configuration files from the directory the bundle
     runs in.

- [ ] **4.2 The SSR image** — `myvideogamelist.client/Dockerfile`, build context that directory.

  1. *Build stage*, `node:24`: copy `package.json` and `package-lock.json`, `npm ci`, copy the
     source, `npm run build`. Depends on 3.2.
  2. *Runtime stage*, `node:24-slim`: `npm ci --omit=dev`, copy `build/` from the build stage,
     `ENV NODE_ENV=production PORT=3000`, `USER node`, `EXPOSE 3000`. `public/` does not need
     copying — Vite has already copied it into `build/client`.
  3. Start the server **directly**, `CMD ["./node_modules/.bin/react-router-serve",
     "./build/server/index.js"]`, not through `npm start`. The Node image's own guidance is that
     npm swallows `SIGTERM`; `react-router-serve` handles it and closes the listener, which is what
     makes ECS deployments stop tasks promptly rather than after the 30-second kill timeout.
  4. `@react-router/dev` sits under `dependencies` in `package.json`, so `--omit=dev` still
     installs the build toolchain into the runtime image. It works; moving it to
     `devDependencies` is a clean-up of its own.

- [ ] **4.3 Two `.dockerignore` files**, one per build context. The root one must exclude
  `**/bin`, `**/obj`, `**/node_modules`, `.git`, `.vs` and `myvideogamelist.client/build`; the
  client one `node_modules`, `build` and `.react-router`. Without them the local `node_modules`
  and build output go into every build.

**Verify** — with `docker compose up -d --wait` running and the local database migrated:

```bash
docker build -t mvgl-api:local -f MyVideoGameList.Server/Dockerfile .
```

```bash
docker run --rm -p 8080:8080 -e ASPNETCORE_ENVIRONMENT=Production -e "ConnectionStrings__DefaultConnection=Host=host.docker.internal;Port=5432;Database=myvideogamelist;Username=mvgl;Password=localdev" mvgl-api:local
```

```bash
curl -i http://localhost:8080/healthz
```

Expect `200` and `Healthy`. `curl -i http://localhost:8080/readyz` should be `200` and `Degraded`:
the database answers, and there are no IGDB credentials in the container (ADR 0005 — user secrets
load only in Development). Then, with the API container still running:

```bash
docker build -t mvgl-ssr:local myvideogamelist.client
```

```bash
docker run --rm -p 3000:3000 -e API_BASE_URL=http://host.docker.internal:8080 -e SITE_URL=https://dev.myvideogamelist.net mvgl-ssr:local
```

```bash
curl -i http://localhost:3000/robots.txt
```

Expect `200`, the header `X-Robots-Tag: noindex, nofollow`, and a body with no `Sitemap:` line.
Then `curl -i http://localhost:3000/`: `200` with empty rails, because this API container has no
IGDB credentials. Its `Cache-Control` is the state of step 3.3 — `public, max-age=0, s-maxage=300,
stale-while-revalidate=600` before that fix, `private, no-store` after it. Stop the API container
and ask again, and it is `private, no-store` either way: an unreachable API is the case the loader
already handles.

---

## Phase 5 — The CDK app

**Build first.** A C# CDK app in a new `infra/` directory (`cdk init app --language csharp` needs
an empty one, and writes a `.gitignore` there that covers `cdk.out`, which the repository's own
patterns do not).

- [ ] **5.1 One app, parameterised.** Context `env` (only `dev` exists) prefixes every stack and
  resource name, so `prod` is later a second value and a second account, not a second code base.
  Context `imageTag` carries the git SHA. **The app and migration stacks are instantiated only when
  `imageTag` is supplied**, so the long-lived stacks deploy without one, and nothing ever falls
  back to `latest`. The Region comes from the profile or `CDK_DEFAULT_REGION`; nothing in the code
  names one except the certificate stack's `us-east-1`.

- [ ] **5.2 Five stacks, split by lifetime.** The split is what makes the cheapest pause lever a
  single command.

  | Stack | Lifetime | Holds |
  |---|---|---|
  | `Mvgl-dev-Dns` | permanent | the public hosted zone `dev.myvideogamelist.net`. Alone, because recreating a zone changes its name servers and breaks the delegation in 6.2 |
  | `Mvgl-dev-Data` | long-lived | VPC, all four security groups, RDS, secrets, ECR repositories, ECS cluster, Cloud Map namespace, regional certificate, the key store for D-3, the GitHub OIDC role (Phase 9), the CloudFront KeyValueStore (Phase 10) |
  | `Mvgl-dev-EdgeCert` | long-lived, `us-east-1` | the certificate CloudFront uses. Not needed if your Region is `us-east-1` |
  | `Mvgl-dev-Migrate` | redeployed each release | one Fargate task definition that runs `efbundle`. Separate so it can be deployed and run *before* the app stack changes |
  | `Mvgl-dev-App` | **disposable** | ALB, listeners, target groups, task definitions, the two services, log groups, the DNS alias, and from Phase 10 the CloudFront distribution and its function |

  Three placements are deliberate. **All four security groups and the rules between them live in
  the data stack**, so the app stack can be destroyed and recreated without touching them and the
  two stacks cannot form a dependency cycle. **The Cloud Map namespace lives there too**, because a
  private DNS namespace is a Route 53 hosted zone, a zone is billed $0.50 when it is created unless
  deleted within twelve hours, and one in the app stack would be billed again on every re-creation.
  **The KeyValueStore lives there** so the basic-auth credential survives a destroy.

- [ ] **5.3 The data stack — network.**

  - VPC across **two AZs** (an ALB needs two, and so does an RDS subnet group), **no NAT gateway**
    (ADR 0015), three subnet groups: `alb` public, `tasks` public, `data` isolated. The ALB gets
    its own subnets — at least /27, with eight free addresses — so that "the balancer's subnets"
    is an exact thing to name in 5.7.
  - Security groups: `alb` accepts 443 and 80 from the CIDR in context `allowedCidr`; `api` accepts
    8080 from `alb` and from `ssr`; `ssr` accepts 3000 from `alb`; `db` accepts 5432 from `api`.
    Egress open on `api` and `ssr`: IGDB, Steam, ECR and the AWS APIs are all reached through the
    internet gateway. **In milestone 1 set `allowedCidr` to your own address**, `/32`: ROADMAP D3
    wants dev kept private, and basic auth does not arrive until CloudFront does. When the
    parameter is absent the group admits only CloudFront's prefix list on 443 (step 10.6), so
    forgetting it fails closed: the site becomes unreachable, not public.

- [ ] **5.4 The data stack — database and secrets.**

  - RDS for PostgreSQL **18** (what `compose.yaml` runs; RDS has supported 18 since November 2025),
    `db.t4g.micro`, Single-AZ, 20 GB gp3 with storage autoscaling off, storage encryption on, in
    the `data` subnets, not publicly accessible, security group `db`, database name
    `myvideogamelist`, seven days of automated backups, deletion protection on, instance
    identifier `mvgl-dev-db`. Performance Insights and enhanced monitoring off.
  - Its credentials as a **generated Secrets Manager secret** (`mvgl/dev/db`), *not* RDS's own
    managed master password: that one rotates on a schedule, ECS reads secrets only when a task
    starts, and a running task would be left holding a password that no longer works.
  - The connection string. RDS refuses unencrypted connections from PostgreSQL 15 onwards
    (`rds.force_ssl` defaults to 1), and Npgsql's default `SSL Mode=Prefer` would cope, but say it:
    `Host=<endpoint>;Port=5432;Database=myvideogamelist;Username=mvgl;SSL Mode=Require`. Pass that
    as the plain environment variable `ConnectionStrings__DefaultConnection`, and inject the
    password separately as the secret `PGPASSWORD`, from the `password` key of `mvgl/dev/db` —
    Npgsql documents `PGPASSWORD` among the PostgreSQL environment variables it honours. The
    variable name is the one ADR 0005 and `appsettings.json` specify; the password simply travels
    beside it instead of inside it, so it exists in one place. The alternative is a third secret
    holding the whole string, written by hand after the database exists.
  - A secret `mvgl/dev/igdb`, created by CDK with a placeholder value. The real value is set by
    hand in 6.5 so it never passes through CloudFormation or the repository.

- [ ] **5.5 The data stack — the rest.**

  - Two ECR repositories, `mvgl/api` and `mvgl/ssr`: **tag immutability on** (ROADMAP: never
    `latest`), and a lifecycle rule keeping the most recent 20 images.
  - An ECS cluster `mvgl-dev` with the Fargate capacity providers enabled. A cluster costs nothing.
  - A Cloud Map **private DNS namespace**, `mvgl-dev.internal`, on the VPC.
  - An ACM certificate for `dev.myvideogamelist.net`, DNS-validated in the zone from `Mvgl-dev-Dns`.
  - Whatever D-3 needs: for option A nothing but IAM, since the application creates the parameters.

- [ ] **5.6 The app stack — tasks and services.**

  Both task definitions: Fargate, Linux x86-64, **0.25 vCPU and 0.5 GB** (the cost table assumes
  it; I have not measured either process, and 1 GB for the API adds $1.62 a month), `awslogs` to a
  log group with 14 days' retention that is destroyed with the stack, image
  `<repository>:<imageTag>`.

  | | API task | SSR task |
  |---|---|---|
  | Port | 8080 | 3000 |
  | Environment | `ASPNETCORE_ENVIRONMENT=Production`, `ConnectionStrings__DefaultConnection` (5.4), the `ForwardedHeaders__*` values (5.7) | `API_BASE_URL=http://api.mvgl-dev.internal:8080`, `SITE_URL=https://dev.myvideogamelist.net`, `PORT=3000` |
  | Secrets | `PGPASSWORD`, `Igdb__ClientId`, `Igdb__ClientSecret` | none |
  | Must not be set | `ASPNETCORE_HTTPS_PORT`, `HTTPS_PORT`, `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `SITE_INDEXABLE`, `HOST` |
  | Task role | what D-3 needs; later `cloudfront:CreateInvalidation` for ROADMAP D14 | nothing |

  - `ASPNETCORE_ENVIRONMENT` is `Production` in dev too. The application's only environment switch
    is `IsDevelopment()` — migrations at startup, user secrets, exception detail in error bodies —
    and all three must be off in anything deployed. What distinguishes dev from prod is
    configuration, as ADR 0036 already assumes: one image, built once.
  - **Never set an HTTPS port.** `Program.cs` calls `UseHttpsRedirection` outside Development, and
    the middleware redirects only if it can discover an HTTPS port; the container listens on plain
    8080, finds none, logs "Failed to determine the https port for redirect" once and carries on.
    That is the behaviour you want: the ALB's health checks and the SSR server's calls both arrive
    as plain HTTP, and a configured port would redirect every one of them. The HTTP-to-HTTPS
    redirect belongs to the ALB listener, and later to CloudFront.
  - `ASPNETCORE_FORWARDEDHEADERS_ENABLED` is the framework's own switch for forwarded headers, and
    Microsoft's documentation warns that it applies no `KnownProxies` restriction. Setting it would
    put a second, trusting copy of the middleware in front of the one 5.7 configures.
  - `SITE_INDEXABLE` stays **unset** in dev. Every response then carries `X-Robots-Tag: noindex,
    nofollow` (ADR 0036). `HOST` stays unset because `react-router-serve` binds to it when it is
    given, and without it listens on every interface, which is what the ALB needs.
  - Both services — named `api` and `ssr`, which is what the commands in Phases 7 to 9 assume:
    desired count 1, public IP on, `tasks` subnets, their security group, health check grace 60
    seconds, minimum healthy 100% and maximum 200% so a deploy starts the new task before stopping
    the old one, and the **deployment circuit breaker with rollback**. That is ECS's basic
    mechanism for marking a revision failed when its tasks never pass their health checks, instead
    of retrying it; it is not the alarm-driven auto-rollback the ROADMAP defers.
  - **One task per service is what makes `AddMemoryCache` correct.** The IGDB token, the response
    caches and both rate limiters are per process (ADRs 0033, 0034). Redis is deliberately deferred
    for dev; do not raise the desired count to "test scaling" without it.

  > **Decision needed (D-4) — Fargate Spot.** The ROADMAP lists it as a dev cost control, and it
  > takes up to 70% off the two Fargate lines. AWS's documentation is plain about the price: "A
  > service with only one task is interrupted until capacity is available", and Spot is never
  > replaced with on-demand. Recommended: on-demand for the first deploy, to keep one variable out
  > of it, then a capacity-provider strategy of `FARGATE_SPOT` for both services. The migration
  > task stays on-demand always.

- [ ] **5.7 The app stack — SSR to API, the load balancer, and forwarded headers.**

  **SSR → API stays inside the VPC, over Cloud Map DNS.** Register the API service in the namespace
  as `api` with an A record and a **10-second TTL**, and point `API_BASE_URL` at it, plain HTTP.
  This is the concrete recommendation between the two candidates:

  - **ECS Service Connect** costs nothing in itself, but it adds an Envoy sidecar to every task,
    and AWS recommends adding 256 CPU units and 64 MiB for it — on 0.25 vCPU tasks that means
    doubling to 0.5 vCPU, about $7.40 a month per task. More to the point, AWS documents that in
    `awsvpc` mode "Application Load Balancer traffic defaults to routing through the Service
    Connect agent", which forwards to the application over `127.0.0.1`. `ProxyHeaders.cs` clears
    loopback from the trust list on purpose, so the API would ignore the balancer's
    `X-Forwarded-For` and `X-Forwarded-Proto` unless loopback were trusted again or
    `ingressPortOverride` were used to route around the proxy. That is avoidable complexity on
    exactly the code ADR 0033 made fail-fast.
  - **Cloud Map DNS** is a name and nothing else: no sidecar, the API sees the SSR task's own
    private address, and the cost is the $0.50 zone already counted. What it lacks is Service
    Connect's retries and connection draining: for a few seconds in a deploy the name can still
    resolve to the task being stopped. The loaders already turn an unreachable API into a
    deliberate, uncacheable 502 or a degraded render (ADR 0013), so dev tolerates that. Revisit
    with the distributed cache, when there is more than one task per service.

  **The load balancer.** Internet-facing, in the `alb` subnets, security group `alb`, idle timeout
  left at 60 seconds.

  | Listener | Rule | Action |
  |---|---|---|
  | 80 | everything | redirect to HTTPS, 301 |
  | 443, the regional certificate | path `/api/*` | forward to the API target group |
  | 443 | path `/healthz` or `/readyz` (D-5) | forward to the API target group |
  | 443 | default | forward to the SSR target group |

  Target groups are of type `ip`, with a deregistration delay of 30 seconds rather than the default
  300, or every deploy waits five minutes. **API health check: `/healthz`. SSR health check:
  `/robots.txt`**, which is a resource route that makes no upstream call. Do **not** point the API
  target group at `/readyz`. It makes a live IGDB query on every call, behind a resilience pipeline
  with a 30-second ceiling, so during an IGDB outage it can outlast a health check's timeout — and
  the balancer would then remove the very instance ADR 0034 says must stay in rotation. `/readyz`
  is for a person and for the pipeline's smoke test.

  > **Decision needed (D-5) — expose `/healthz` and `/readyz`?** They are not under `/api/`, so
  > without the second rule they reach the SSR server and 404. Recommended: add the rule in dev,
  > where only you (milestone 1) or somebody past basic auth (milestone 2) can reach it. Decide
  > again for prod: each `/readyz` is an IGDB call against the four-a-second budget, open to anyone.

  **Forwarded headers.** `ProxyHeaders.cs` binds the `ForwardedHeaders` section and **throws at
  startup** if `Enabled` is true while both trust lists are empty. Behind the ALB:

  | Environment variable | Value |
  |---|---|
  | `ForwardedHeaders__Enabled` | `true` |
  | `ForwardedHeaders__ForwardLimit` | `1` |
  | `ForwardedHeaders__KnownNetworks__0` | the CIDR of the first `alb` subnet |
  | `ForwardedHeaders__KnownNetworks__1` | the CIDR of the second `alb` subnet |

  CDK knows both CIDRs at synthesis, so they are never typed. The ALB's addresses change over time,
  which is why this is a network and not `KnownProxies`. Plain IPv4 CIDRs are enough even though
  Kestrel reports addresses as IPv4-mapped IPv6: the middleware maps them back before comparing.
  What is at stake is the login limiter. Left off, every visitor appears to come from the
  balancer's two addresses, and ten attempts per five minutes becomes a budget the whole site
  shares. Only the address and the scheme are honoured; `X-Forwarded-Host` stays ignored, as ADR
  0033 decided.

- [ ] **5.8 The migration stack.** A Fargate task definition `mvgl-dev-migrate`: the **API image**
  at the same `imageTag`, entry point overridden to `/app/efbundle`, working directory `/app`, the
  same `ASPNETCORE_ENVIRONMENT`, connection string and `PGPASSWORD` as the API, its own log group
  `/mvgl/dev/migrate`. It runs in the `tasks` subnets with the `api` security group — the one `db`
  admits — and a public IP, which it needs to pull its image.

- [ ] **5.9 Outputs.** Emit what the runbook needs as stack outputs rather than making the reader
  hunt in the console. From the data stack: the `tasks` subnet ids, the `api` security group id,
  the repository URIs, the KeyValueStore ARN. From the app stack: the two target group ARNs, the
  ALB's DNS name and, from Phase 10, the distribution id.

**Verify**

```bash
cdk synth --profile mvgl-dev -c env=dev -c imageTag=0000000
```

Expect five templates in `infra/cdk.out`, and `cdk synth -c env=dev` with no tag to produce only the
three long-lived ones. Search the output for `latest`: there should be none.

---

## Phase 6 — DNS and the long-lived stacks

- [ ] **6.1 Deploy the zone.**

  ```bash
  cdk deploy Mvgl-dev-Dns --profile mvgl-dev -c env=dev
  ```

  ```bash
  aws route53 list-hosted-zones-by-name --profile mvgl-dev --dns-name dev.myvideogamelist.net --query "HostedZones[0].Id" --output text
  ```

  ```bash
  aws route53 get-hosted-zone --profile mvgl-dev --id <ZONE_ID> --query "DelegationSet.NameServers"
  ```

  Note the four name servers.

- [ ] **6.2 Delegate `dev` from the parent zone.** The procedure is the same wherever
  `myvideogamelist.net` is hosted; only the place you type differs. Add **one NS record set** named
  `dev.myvideogamelist.net` whose values are those four name servers. Use a TTL of 300 while
  setting up and raise it once it works. Do not add an SOA record for `dev` in the parent; if the
  DNS provider adds one by itself, delete it.

  - *Parent zone in Route 53 in another account of the organization:* in that account, create the
    record in the console, or write the change as `delegate-dev.json` — a `CREATE` of type `NS`
    with the four values — and run:

    ```bash
    aws route53 change-resource-record-sets --profile <PARENT_ZONE_PROFILE> --hosted-zone-id <PARENT_ZONE_ID> --change-batch file://delegate-dev.json
    ```

    CDK has a construct that automates this across accounts through a delegation role. For one
    record created once, by hand is less machinery.
  - *Parent zone at an external registrar or DNS host:* in their panel, add NS records for host
    `dev` with the same four values.

  Nothing else about the apex changes, and the registration stays where it is.

- [ ] **6.3 Deploy the data stack.** It validates its certificate through the delegation, so 6.2
  has to be answering first or the deploy waits on ACM. The database takes the longest.

  ```bash
  cdk deploy Mvgl-dev-Data --profile mvgl-dev -c env=dev -c allowedCidr=<YOUR_IP>/32
  ```

  Pass `allowedCidr` on **every** deploy of this stack until Phase 10 — step 9.1 is one — and run
  it again whenever your address changes. It takes about a minute when nothing else has changed.

- [ ] **6.4 Deploy the CloudFront certificate** — skip this if your Region is `us-east-1`. It is
  free and not needed until Phase 10, but issuing it now proves the cross-Region wiring early.

  ```bash
  cdk deploy Mvgl-dev-EdgeCert --profile mvgl-dev -c env=dev
  ```

- [ ] **6.5 Put the real IGDB credentials in the secret.** Write `igdb.json` **outside the
  repository** as `{"ClientId":"…","ClientSecret":"…"}`, using the secret rotated in 2.1, then:

  ```bash
  aws secretsmanager put-secret-value --profile mvgl-dev --secret-id mvgl/dev/igdb --secret-string file://igdb.json
  ```

  Delete the file.

**Verify**

```bash
nslookup -type=NS dev.myvideogamelist.net
```

Expect the four `awsdns` name servers from 6.1.

```bash
aws acm list-certificates --profile mvgl-dev --region <REGION> --query "CertificateSummaryList[].{Domain:DomainName,Status:Status}"
```

Expect `ISSUED`.

```bash
aws rds describe-db-instances --profile mvgl-dev --db-instance-identifier mvgl-dev-db --query "DBInstances[0].{Status:DBInstanceStatus,Public:PubliclyAccessible,Class:DBInstanceClass,MultiAZ:MultiAZ,Engine:EngineVersion}"
```

Expect `available`, `false`, `db.t4g.micro`, `false` and an 18.x engine.

---

## Phase 7 — First deploy by hand (milestone 1)

Done by hand once, from your machine, because every step here is one the pipeline will repeat and
it is far easier to debug with your own hands on it. Build from a **commit**, with a clean working
tree: the tag is a promise about what is inside.

- [ ] **7.1 Name the release and sign Docker in to ECR.**

  ```bash
  SHA=$(git rev-parse --short=12 HEAD)
  ```

  ```bash
  REGISTRY=<DEV_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
  ```

  ```bash
  aws ecr get-login-password --profile mvgl-dev --region <REGION> | docker login --username AWS --password-stdin $REGISTRY
  ```

- [ ] **7.2 Build both images.** On an ARM machine add `--platform linux/amd64` to each.

  ```bash
  docker build -t $REGISTRY/mvgl/api:$SHA -f MyVideoGameList.Server/Dockerfile .
  ```

  ```bash
  docker build -t $REGISTRY/mvgl/ssr:$SHA myvideogamelist.client
  ```

- [ ] **7.3 Push both.** The repositories are immutable, so pushing the same SHA twice is refused;
  that is the point.

  ```bash
  docker push $REGISTRY/mvgl/api:$SHA
  ```

  ```bash
  docker push $REGISTRY/mvgl/ssr:$SHA
  ```

- [ ] **7.4 Deploy the migration task definition.**

  ```bash
  cdk deploy Mvgl-dev-Migrate --profile mvgl-dev -c env=dev -c imageTag=$SHA
  ```

- [ ] **7.5 Run the migrations, before anything serves traffic.** Outside Development the
  application never migrates by itself, and a deployed API against an empty database starts, passes
  `/healthz`, and fails on its first query. The subnet and security group ids are the stack outputs
  from 5.9.

  ```bash
  aws ecs run-task --profile mvgl-dev --cluster mvgl-dev --task-definition mvgl-dev-migrate --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[<TASKS_SUBNET_A>,<TASKS_SUBNET_B>],securityGroups=[<API_SG>],assignPublicIp=ENABLED}" --query "tasks[0].taskArn" --output text
  ```

  ```bash
  aws ecs wait tasks-stopped --profile mvgl-dev --cluster mvgl-dev --tasks <TASK_ARN>
  ```

  ```bash
  aws ecs describe-tasks --profile mvgl-dev --cluster mvgl-dev --tasks <TASK_ARN> --query "tasks[0].containers[0].exitCode"
  ```

  Expect `0`. The bundle's own output — one "Applying migration" line each, then "Done." — is in:

  ```bash
  aws logs tail /mvgl/dev/migrate --profile mvgl-dev --since 15m
  ```

  A non-zero exit stops here. A failure that mentions the password means `PGPASSWORD` is not
  reaching Npgsql; fall back to the single-secret connection string from 5.4.

- [ ] **7.6 Deploy the app stack.**

  ```bash
  cdk deploy Mvgl-dev-App --profile mvgl-dev -c env=dev -c imageTag=$SHA
  ```

  If the API task stops at once and its log shows the `InvalidOperationException` from
  `ProxyHeaders.cs`, the two `KnownNetworks` variables did not arrive — that is the fail-fast
  working as designed.

- [ ] **7.7 Check the plumbing.**

  ```bash
  aws elbv2 describe-target-health --profile mvgl-dev --target-group-arn <API_TARGET_GROUP_ARN> --query "TargetHealthDescriptions[].TargetHealth.State"
  ```

  Expect `["healthy"]`, and the same for the SSR target group. Then, from the address in
  `allowedCidr`:

  ```bash
  curl -i https://dev.myvideogamelist.net/healthz
  ```

  ```bash
  curl -i https://dev.myvideogamelist.net/readyz
  ```

  Expect `200 Healthy` from both. `Degraded` on the second means the IGDB secret is wrong: redo
  6.5, then force a new deployment as in 7.8, because ECS reads secrets only when a task starts.

- [ ] **7.8 Check the application.**

  - Open `https://dev.myvideogamelist.net/`. The rails are populated. An empty home page still
    answers `200`, and its `Cache-Control` says which half is broken. `private, no-store` means
    the SSR server is not reaching the API: check that the `api` name is registered in Cloud Map
    and that `ssr` is allowed into `api` on 8080. If the API task has no container health check,
    confirm the Cloud Map instance shows as healthy; I could not verify how ECS reports health to
    Cloud Map in that case. The public `s-maxage=300` policy on an empty page means the API
    answered and IGDB did not (step 3.3); `/readyz` in 7.7 should already have said so.
  - Open any game from `/games`. A rendered page is SSR → API → IGDB end to end.
  - `SITE_URL` arrived:

    ```bash
    curl -s https://dev.myvideogamelist.net/sitemaps/pages.xml
    ```

    Expect two `<loc>` entries beginning `https://dev.myvideogamelist.net`. Any other origin there
    means the variable is missing: without it the sitemap falls back to the request's own origin,
    and no page gets a canonical URL.
  - The write guard is on, and a write gets through:

    ```bash
    curl -s -o /dev/null -w "%{http_code}\n" -X POST https://dev.myvideogamelist.net/api/auth/logout
    ```

    Expect `403` — no header, refused by `CsrfHeaderMiddleware`.

    ```bash
    curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "X-MVGL-Request: 1" https://dev.myvideogamelist.net/api/auth/logout
    ```

    Expect `401` — past the guard, and nobody is signed in.
  - In the browser: register, sign in, add a game to a list, reload. It is still there.
  - **Still signed in, force a redeploy:**

    ```bash
    aws ecs update-service --profile mvgl-dev --cluster mvgl-dev --service api --force-new-deployment
    ```

    ```bash
    aws ecs wait services-stable --profile mvgl-dev --cluster mvgl-dev --services api
    ```

    Reload. **You are still signed in.** If you are not, Data Protection keys are not persisting
    and 3.1 is not done.

**Verify** — every expectation in 7.7 and 7.8 met. That is milestone 1. Now park it once, before
doing anything else.

---

## Phase 8 — Park it: pause and resume

Practise this the day milestone 1 works. Two applications share the runway, and an environment
nobody is looking at should be costing the idle floor.

- [ ] **8.1 Lever 1 — scale both services to zero.** Saves the two Fargate tasks and their two
  addresses; the ALB, its addresses and RDS keep billing. The site answers `503`.

  ```bash
  aws ecs update-service --profile mvgl-dev --cluster mvgl-dev --service api --desired-count 0
  ```

  ```bash
  aws ecs update-service --profile mvgl-dev --cluster mvgl-dev --service ssr --desired-count 0
  ```

  Resume with `--desired-count 1` on each, then `aws ecs wait services-stable`. Any release resets
  the count to what the stack declares, because it updates the service; a parked environment wakes
  on the next deploy.

- [ ] **8.2 Lever 2 — stop the database.** **Only after lever 1 or 3.** `/healthz` checks no
  dependency, so with the database stopped ECS would keep both tasks running, and billing, while
  every page fails.

  ```bash
  aws rds stop-db-instance --profile mvgl-dev --db-instance-identifier mvgl-dev-db
  ```

  Storage and backups keep billing; instance hours stop. **RDS starts a stopped instance by itself
  after seven consecutive days.** For a longer pause, stop it again, or schedule a daily
  `StopDBInstance` — AWS's own note on this points to a scheduled approach. A stopped instance
  cannot be modified, so do not deploy the data stack while it is stopped. Resume:

  ```bash
  aws rds start-db-instance --profile mvgl-dev --db-instance-identifier mvgl-dev-db
  ```

  ```bash
  aws rds wait db-instance-available --profile mvgl-dev --db-instance-identifier mvgl-dev-db
  ```

  AWS warns that a start "can take from minutes to hours". Start the database before the services.

- [ ] **8.3 Lever 3 — destroy the app stack.** Removes the ALB, its addresses and both services in
  one command, from `infra/`:

  ```bash
  cdk destroy Mvgl-dev-App --profile mvgl-dev -c env=dev -c imageTag=<LAST_SHA>
  ```

  The tag is there only because the app stack is not instantiated without one (5.1); any value
  names the stack. Nothing is lost: images are in ECR, data in RDS, secrets, keys and the
  basic-auth credential in the data stack. Resume is 7.6 with the last SHA, which ECR will tell
  you:

  ```bash
  aws ecr describe-images --profile mvgl-dev --repository-name mvgl/api --query "sort_by(imageDetails,&imagePushedAt)[-1].imageTags"
  ```

  Once CloudFront is in the stack both directions take longer, because distributions are slow to
  deploy and slower to delete; I have not measured this stack. If the wait becomes the reason you
  stop parking it, move the distribution to a stack of its own in front of a stable origin name.

- [ ] **8.4 Tell the pipeline.** Once Phase 9 exists, set the repository variable
  `DEV_DEPLOY_ENABLED` to `false` whenever the environment is parked (D-6).

**Verify** — after levers 3 and 2:

```bash
aws elbv2 describe-load-balancers --profile mvgl-dev --query "LoadBalancers[].LoadBalancerName"
```

Expect `[]`.

```bash
aws rds describe-db-instances --profile mvgl-dev --db-instance-identifier mvgl-dev-db --query "DBInstances[0].DBInstanceStatus"
```

Expect `stopped`. Then resume, and repeat 7.7. A day later, confirm in Cost Explorer, filtered to
the `mvgl-dev` linked account, that the daily figure fell.

---

## Phase 9 — Deploy from GitHub Actions through OIDC

No AWS key is ever stored in GitHub. The workflow proves who it is with a token GitHub signs, and
AWS exchanges that for short-lived credentials.

- [ ] **9.1 Build first — the OIDC provider and the deploy role**, in the data stack. One IAM OIDC
  identity provider for `https://token.actions.githubusercontent.com` with audience
  `sts.amazonaws.com` — an account can hold only one per URL, which a fresh account does not yet
  have; no thumbprint is needed any more. Then a role `mvgl-dev-github-deploy` with this trust
  policy:

  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<DEV_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:ChronosSF/myvideogamelist:environment:dev"
        }
      }
    }]
  }
  ```

  `StringEquals` on `sub`, never a wildcard: only a job that declares the GitHub environment `dev`
  in this repository can assume it. The comparison is case-sensitive, so use the owner and
  repository name exactly as GitHub shows them. Permissions: `sts:AssumeRole` on
  `arn:aws:iam::<DEV_ACCOUNT_ID>:role/cdk-hnb659fds-*`; `ecr:GetAuthorizationToken`, plus push
  actions on the two repositories only; `ecs:RunTask` on the migration task definition,
  `ecs:DescribeTasks`, `ecs:DescribeServices`, `elasticloadbalancing:DescribeTargetHealth`, and
  `iam:PassRole` for that task's two roles; from Phase 10, `cloudfront:CreateInvalidation` on the
  one distribution. Everything else it does, it does as the CDK roles. Then deploy it, from your
  machine:

  ```bash
  cdk deploy Mvgl-dev-Data --profile mvgl-dev -c env=dev -c allowedCidr=<YOUR_IP>/32
  ```

- [ ] **9.2 Configure GitHub.** Create the environment `dev` with no reviewers, and restrict its
  deployment branches to `master`, so a workflow on another branch cannot claim it. Add
  *variables*, not secrets — none of these is secret: `AWS_ROLE_ARN`, `AWS_REGION`,
  `AWS_ACCOUNT_ID`, `DEV_DEPLOY_ENABLED`. The production environment, later, is the same with
  required reviewers.

- [ ] **9.3 Build first — `.github/workflows/deploy-dev.yml`.**

  - Triggers: `workflow_run` of **CI**, completed successfully, on `master`; and
    `workflow_dispatch`. Check out `github.event.workflow_run.head_sha` in the first case, or the
    images will not be of the commit CI tested.
  - `permissions: id-token: write, contents: read`. `environment: dev` on the job. A `concurrency`
    group, so two deploys never interleave.
  - Steps, in the ROADMAP's order: configure credentials (`aws-actions/configure-aws-credentials`,
    v6 as of this writing, with `role-to-assume` and `aws-region` — the role is assumed for an hour
    by default) → sign in to ECR → build and push both images tagged with the SHA → **stop here
    unless `DEV_DEPLOY_ENABLED` is `true`** → set up .NET 10 and Node 24 and `npm install -g
    aws-cdk`, because the CDK app is C# and its CLI is Node → `cdk deploy Mvgl-dev-Migrate` → run
    the migration task, wait, **fail on a non-zero exit code** → `cdk deploy Mvgl-dev-App` →
    `aws ecs wait services-stable` on both services → smoke test. Both `cdk deploy` calls take
    `-c env=dev -c imageTag=<SHA> --require-approval never`; without the last the CLI stops to ask
    about IAM changes and nobody is there to answer.
  - The smoke test cannot reach the ALB while `allowedCidr` is your address, so in milestone 1 it
    is the target-health check from 7.7. From Phase 10 it is `/readyz` and `/` through CloudFront,
    with the basic-auth pair as an environment secret: the only secret the workflow holds.
  - The long-lived stacks are **not** deployed by the pipeline. They change rarely, the role that
    could change them would have to be far broader, and a mistake in one of them is a database.

  > **Decision needed (D-6) — deploy on every merge, or only when awake?** Deploying the app stack
  > *recreates* it if it was destroyed, so an unconditional deploy-on-merge silently un-parks the
  > environment and the ALB starts billing again. Recommended: always build and push, so ECR holds
  > an image for every commit on `master` at a cost of cents, and deploy only when
  > `DEV_DEPLOY_ENABLED` is `true`.

**Verify** — run the workflow by hand from a trivial commit. Then:

```bash
aws ecs describe-services --profile mvgl-dev --cluster mvgl-dev --services api --query "services[0].taskDefinition"
```

```bash
aws ecs describe-task-definition --profile mvgl-dev --task-definition <THAT_ARN> --query "taskDefinition.containerDefinitions[0].image"
```

Expect the new SHA. In IAM, the role's *Last activity* shows the run, and the repository's secrets
hold no AWS key.

---

## Phase 10 — CloudFront in front (milestone 2)

**Build first**, in the app stack, except where noted. One origin — the ALB — and the ALB goes on
routing between the two processes. CloudFront decides only what is cached and what is forwarded.

- [ ] **10.1 The distribution.** Alternate domain name `dev.myvideogamelist.net`; the `us-east-1`
  certificate; viewer protocol policy *redirect to HTTPS*; HTTP/2 and HTTP/3; price class 100. One
  custom origin: the ALB's DNS name, **HTTPS only**, TLS 1.2. Raise the origin response timeout
  from its default of 30 seconds to 60: the API's own ceiling on an IGDB call is 30 (ADR 0034), and
  the reader should get the API's 502 that says what happened, not CloudFront's 504. (The default
  is documented; I did not re-check the largest value allowed without a quota increase, so if 60
  is refused, use the largest that is accepted.) **Every
  behaviour forwards the `Host` header.** The ALB's certificate is for `dev.myvideogamelist.net`,
  not for its own `…elb.amazonaws.com` name, and CloudFront accepts an origin certificate that
  matches either the origin domain or the forwarded `Host`. A behaviour that forgets answers 502.

- [ ] **10.2 One cache policy for every cached page** — `mvgl-pages`. The managed policies do not
  fit: `CachingOptimized` has a minimum TTL of one second, and any minimum above zero makes
  CloudFront cache a response the origin marked `private, no-store`; the
  `UseOriginCacheControlHeaders` pair put every cookie in the cache key, which gives each
  signed-in reader a private copy of a public page.

  | Setting | Value | Why |
  |---|---|---|
  | Minimum TTL | 0 | only at 0 does CloudFront honour `no-store` and `private` — the root's fail-closed default (ADR 0013) depends on it |
  | Default TTL | 0 | a response that states no policy is not cached |
  | Maximum TTL | 31,536,000 | CloudFront serves stale for the lesser of `stale-while-revalidate` and this, so it must clear the game page's 86,400 |
  | Query strings in the key | `search`, `sort`, `platform`, `genre`, `year`, `minScore`, `page`, `_routes` | D12's six for `/games` and `page` for `/u/*`, plus React Router's `_routes` |
  | Cookies, headers in the key | none | the server render reads no cookie |
  | Gzip and Brotli | on | `react-router-serve` compresses |

  `_routes` is insurance. React Router 8.3 adds it to a `.data` request only when a route with a
  loader opts out of revalidation, has a `clientLoader`, or is loaded by a fetcher, and nothing in
  the client does any of those today — ADR 0036 turned down a root loader partly to keep it that
  way. But the body differs by it, so it belongs in the key before the first `shouldRevalidate`
  rather than after.

- [ ] **10.3 The behaviours**, in order of precedence. "Host only" is the managed origin request
  policy `HostHeaderOnly`; whatever is in the cache key is forwarded as well, automatically.

  | # | Path pattern | Methods | Cache policy | Origin request policy |
  |---|---|---|---|---|
  | 1 | `/api/*` | all seven | managed `CachingDisabled` | managed `AllViewer` |
  | 2 | `/assets/*` | GET, HEAD | managed `CachingOptimized` | Host only |
  | 3–6 | `/lists*`, `/wishlist*`, `/user*`, `/news*` | GET, HEAD | managed `CachingDisabled` | managed `AllViewer` |
  | default | `*` | GET, HEAD | `mvgl-pages` | Host only |

  - **Behaviour 1 is where `X-MVGL-Request` has to survive** (ADR 0033). `AllViewer` forwards every
    viewer header, the cookie and the query string. Without it every write is a 403 that looks
    like an application bug. It is also the only behaviour that allows anything but GET and HEAD:
    all writes go to `/api/*`, and the SSR server has no actions. **Do not add a CORS policy
    anywhere**, neither here nor on the API: one that lets another origin send this header undoes
    the guard.
  - **Behaviours 3–6 end in `*`, with no slash before it — that is D13.** React Router 8 asks for
    `/lists.data`, not `/lists/…`; a pattern of `/lists` or `/lists/*` would let the `.data`
    request fall through to the cached default. The origin says `private, no-store` for all four
    anyway; ADR 0013 asks for the explicit behaviour so that safety does not rest on one header.
  - **The default behaviour covers `/`, `/games`, `/games/{id}`, `/u/*`, `/robots.txt`, the
    sitemaps and every 404**, including their `.data` forms — `/games.data`, `/games/12.data`, and
    `/_.data` for the root. With no path pattern of their own there is no format to get wrong. Each
    is cached for exactly what `@/lib/cache` says.
  - Behaviour 2 caches the hashed bundles; `react-router-serve` sends them `immutable` for a year.

- [ ] **10.4 Errors must not be cached.** For a cached behaviour CloudFront keeps a 404, a 414 and
  the 500 to 504 family for the greater of the origin's `max-age`/`s-maxage` and an *error caching
  minimum TTL* that defaults to **10 seconds** — so a `private, no-store` 502 from the SSR server
  would still be served from the edge for ten seconds, against the rule that caching a failure
  outlives the failure. Add custom error responses for 500, 502, 503 and 504 that set that TTL to
  **0** and change nothing else: no error page, no status rewrite. Leave 404 alone. The origin
  gives it `s-maxage=60`, and **a 404 must stay a real 404** — never map it to a page that
  answers 200.

- [ ] **10.5 Basic auth** (ROADMAP D3, ADR 0036). A CloudFront Function on **viewer request**,
  JavaScript runtime 2.0, associated with **every** behaviour, the default included — a behaviour
  without it is an open door. It runs before the cache is consulted, so cached pages are protected
  too. The expected value lives in the KeyValueStore from the data stack, never in the repository.
  Illustrative and untested:

  ```js
  import cf from 'cloudfront';

  const kvs = cf.kvs();

  // Public aggregates the client asks for with `credentials: 'omit'`. See D-8.
  const OPEN = /^\/api\/games\/\d+\/(reviews|community-scores|community-times)$/;

  async function handler(event) {
      const request = event.request;

      if (request.method === 'GET' && OPEN.test(request.uri)) return request;

      // Throws if the key is missing, which fails closed: CloudFront answers with an error.
      const expected = await kvs.get('basic-auth');
      const sent = request.headers.authorization;

      if (sent && sent.value === expected) return request;

      return {
          statusCode: 401,
          statusDescription: 'Unauthorized',
          headers: { 'www-authenticate': { value: 'Basic realm="MVGL dev"' } },
      };
  }
  ```

  > **Decision needed (D-8) — the three open paths.** `useGameCommunity` and `useCommunityTimes`
  > fetch with `credentials: 'omit'`, deliberately, so the sign-in cookie cannot reach endpoints
  > that answer everybody alike. But HTTP authentication counts as a credential too, so the browser
  > withholds the `Authorization` header from exactly those three requests. Behind basic auth they
  > 401 and every game page's community section stays empty. Recommended: exempt them as above —
  > read-only, public by design (ADR 0028), and they expose nothing the production site will not.
  > The alternative is to accept the empty sections in dev.

  Set the credential once the data stack has created the store, and **before** the app stack
  attaches the function (10.9) — without the key the function fails closed and every request is an
  error:

  ```bash
  printf '<USER>:<PASSWORD>' | base64
  ```

  ```bash
  aws cloudfront-keyvaluestore describe-key-value-store --profile mvgl-dev --kvs-arn <KVS_ARN>
  ```

  ```bash
  aws cloudfront-keyvaluestore put-key --profile mvgl-dev --kvs-arn <KVS_ARN> --if-match <ETAG> --key basic-auth --value "Basic <BASE64>"
  ```

  That API signs with SigV4A, and I could not verify that it accepts Identity Center credentials;
  if it refuses, set the pair in the console under *CloudFront → Functions → KeyValueStores*. Two
  things are unaffected by basic auth: ALB health checks, which never pass through CloudFront, and
  the SSR server's calls to the API, which never leave the VPC.

- [ ] **10.6 Close the side door, and decide what the API believes.** The security group is in the
  data stack; the listener and the balancer's attributes are in the app stack. They ship together,
  in the order 10.9 gives.

  1. The `alb` security group admits **443 only, from the managed prefix list
     `com.amazonaws.global.cloudfront.origin-facing`**, and the `allowedCidr` rule goes (5.3). That
     list counts as 55 rules against a default quota of 60 per security group, so it fits on one
     port and not on two: delete the ALB's port-80 listener, which nothing can reach any more.
  2. The forwarded address.

  > **Decision needed (D-7) — how the API learns the viewer's address.** CloudFront appends the
  > viewer's address to `X-Forwarded-For`, and the ALB then appends CloudFront's. ADR 0033 and
  > `appsettings.json` say "a CDN in front of it is 2". **Raising `ForwardLimit` to 2 does not by
  > itself work.** ASP.NET's middleware checks the trust list before *each* hop: having taken the
  > edge server's address from the right, it consults `KnownNetworks`, does not find a CloudFront
  > address among the ALB's subnets, and stops there. The symptom is quiet — the login limiter
  > partitions by edge server, not by person.
  >
  > | Option | What changes | Cost |
  > |---|---|---|
  > | **A. The ADR's letter** | `ForwardLimit=2`, and every CloudFront origin-facing range added to `KnownNetworks` | The ranges are AWS's to change and there are dozens; a stale list fails silently, back to the edge server's address |
  > | **B. Let the ALB stand aside** | ALB attribute `routing.http.xff_header_processing.mode=preserve`; `ForwardLimit` stays 1, `KnownNetworks` stays the ALB's subnets | The right-most entry is then CloudFront's and is the viewer. It is trustworthy *only because* step 1 means nothing but CloudFront can reach the ALB; open that security group later and callers choose their own address |
  >
  > Recommended: **B**, which must never be live before the prefix-list rule is — 10.9's order
  > guarantees that — and ADR 0033 amended either way. The stakes in dev are low: only login and
  > register read the address.

- [ ] **10.7 Move the name.** In the app stack, the alias `dev.myvideogamelist.net` (A and AAAA)
  points at the distribution instead of the ALB.

- [ ] **10.8 Invalidate after every deploy.** The final step of `deploy-dev.yml`:

  ```bash
  aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths "/*"
  ```

  A game page may sit at the edge for an hour and be served stale for a day, and it names hashed
  asset files that the new container no longer has, because the bundles are served by the SSR
  container and not from S3. Without the invalidation a deploy leaves cached pages pointing at
  scripts that 404. A wildcard counts as one path and the first 1,000 paths a month are free.

- [ ] **10.9 Deploy, in this order.** Dev is unreachable from the first command until the last has
  finished, which is acceptable for dev and is the reason to do it in one sitting.

  1. The data stack, now **without** `allowedCidr`: the `alb` group admits only CloudFront, and the
     KeyValueStore exists.

     ```bash
     cdk deploy Mvgl-dev-Data --profile mvgl-dev -c env=dev
     ```

  2. The basic-auth credential, as in 10.5.
  3. The app stack: the distribution and its function, the ALB's `preserve` attribute if D-7 is B,
     the port-80 listener removed, and the alias moved (10.7).

     ```bash
     cdk deploy Mvgl-dev-App --profile mvgl-dev -c env=dev -c imageTag=<LAST_SHA>
     ```

  4. In GitHub, add the basic-auth pair as a secret of the `dev` environment and the distribution
     id as a variable, for the smoke test (9.3) and the invalidation (10.8).

**Verify** — first without credentials:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dev.myvideogamelist.net/
```

Expect `401`. Every request after this one carries `-u <USER>:<PASSWORD>`. Request a game page
twice:

```bash
curl -s -o /dev/null -D - -u <USER>:<PASSWORD> https://dev.myvideogamelist.net/games/<ANY_ID_FROM_THE_LISTING>
```

Expect `x-cache: Miss from cloudfront`, then `Hit from cloudfront`, and `cache-control: public,
max-age=0, s-maxage=3600, stale-while-revalidate=86400` both times. The same command against
`/lists` never gives a Hit. The two `curl` checks from 7.8, with `-u` added, must still answer
`403` and `401`: a `403` on the second means `X-MVGL-Request` is being stripped. And the ALB must
not answer you directly:

```bash
curl -m 10 -sk -o /dev/null -w "%{http_code}\n" https://<ALB_DNS_NAME>/healthz
```

Expect a timeout, reported as `000`.

---

## Phase 11 — End-to-end verification

The acceptance test for the dev environment. Run all of it after any change to the stacks, and
after every resume from lever 3.

- [ ] `/healthz` answers `200 Healthy`, and `/readyz` answers `200 Healthy`. `Degraded` is still a
  200, by design (ADR 0034), but here it means the IGDB secret is wrong.
- [ ] The home page renders with its rails, and a game page renders.
- [ ] **Not indexable.** `/robots.txt` is `200`, disallows nothing and has no `Sitemap:` line;
  every document carries `X-Robots-Tag: noindex, nofollow`; API responses carry `X-Robots-Tag:
  noindex`; without the basic-auth pair everything is a `401`.
- [ ] **`SITE_URL` arrived**: `/sitemaps/pages.xml` lists two URLs beginning
  `https://dev.myvideogamelist.net`, and a game page's source carries a `rel="canonical"` link on
  the same origin (7.8).
- [ ] Registering and signing in work. A deliberately wrong password is a `401` with the shared
  message, and the eleventh attempt within five minutes is a `429` — for *your* address, which is
  what shows that forwarded headers are configured and not collapsing everybody into one bucket.
- [ ] **A write succeeds through the whole chain**: add a game to a list in the browser, reload, it
  is there. The `403` / `401` pair of `curl` checks from 7.8 still holds. Together they prove the
  guard is on and that CloudFront forwards `X-MVGL-Request`.
- [ ] **A session survives a redeploy** (7.8). That proves the Data Protection keys persist.
- [ ] **Cache headers match ADR 0013**, read through CloudFront:

  | Path | Expect |
  |---|---|
  | `/` | `public, max-age=0, s-maxage=300, stale-while-revalidate=600` |
  | `/games` | `public, max-age=0, s-maxage=600, stale-while-revalidate=3600`, and a different `?search=` is a different cache entry (a Miss, then its own Hit) |
  | `/games/{id}` | `public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` |
  | `/lists`, `/wishlist`, `/user`, `/news` | `private, no-store`, and never `Hit from cloudfront` |

- [ ] **A 404 is a real 404**: `/no-such-page` answers status `404` with `s-maxage=60`, not `200`.
- [ ] *Optional, and worth doing once:* scale `api` to zero and request a game page you have not
  visited — `502` with `private, no-store`. Scale back up and request it again at once: the page,
  not a remembered 502. That is step 10.4 working.

---

## What this guide deliberately leaves for later

- **Deferred for dev, by decision:** Redis and the shared rate limits; OpenTelemetry; Multi-AZ;
  WAF and edge rate limiting; blue/green; alarm-driven auto-rollback; alarms at all; the `/version`
  endpoint, which would make "which SHA is live" one `curl`.
- **Production:** the `mvgl-prod` environment and its GitHub approval gate; `SITE_INDEXABLE=true`;
  the cookie domain (D7); OAuth redirect URIs (D6); SES bounce and complaint handling (D11); and
  private subnets behind NAT, which ADR 0015 says to revisit before launch rather than after.
- **ROADMAP D14.** Invalidating `/u/{name}`, its `.data` URL and the profile sitemap file when a
  profile is withdrawn. It needs the distribution id in the API's configuration and
  `cloudfront:CreateInvalidation` on the API task role. Until it ships, the window is the one ADR
  0027 records.
- **Bundles in S3.** The ROADMAP's diagram sends `/assets/*` to S3; ADR 0007's does not, and this
  guide follows 0007. S3 would let an old page keep its old scripts across a deploy; here, 10.8's
  invalidation stands in for it.
- **Sporadic 502s from the ALB.** Node's HTTP server closes idle connections after 5 seconds
  (checked on the installed 24.18); the ALB's idle timeout is 60; AWS's guidance is that the
  application's should be the longer, or the balancer occasionally reuses a connection the target
  has just closed. `react-router-serve` offers no hook to change it, and lowering the ALB's timeout
  would cut off slow API calls, because the setting is per balancer. The fix is a small custom
  server entry. It is a race, not a steady failure, and not worth the change for dev.
- **The ALB's two public addresses.** CloudFront VPC origins can reach an *internal* ALB in private
  subnets, which removes both addresses ($7.30 a month) and the side door with them. The ALB's
  scheme cannot be changed in place, so it is a replacement, and it cannot be done before
  CloudFront exists. It is the natural next step after milestone 2.
- **HSTS on documents.** `UseHsts` covers API responses; `securityHeaders.ts` sends none. A
  CloudFront response headers policy is the cheap place to add it. The `script-src` nonce is ADR
  0033's open item, not deployment's.
- **Database hardening:** separate roles for the migration and for the running application (EF's
  documentation recommends it); `SSL Mode=VerifyFull` with the RDS CA bundle in the image; password
  rotation; a restore drill.
- **Cheaper compute:** ARM64 images.
- **Service Connect**, once there is more than one task per service (5.7).

## Where this guide adds to the decision records

Nothing here departs from a record silently. Each of these is a place where checking found
something a record did not know, and each deserves an amendment or a new record when it is settled.

1. **Credits** (0014, 0015, ROADMAP §6). All three treat roughly $200 of new-account credits and a
   six-month Free plan as the runway. By AWS's FAQ and terms, creating the Organization ended the
   Free plan, expired the Free Tier credits and closed the earning activities — including the $20
   for a budget that 0015 says to collect first. See 0.1, which also says why the console outranks
   this paragraph.
2. **The cost baseline** (0015, ROADMAP §6). About $65–74 a month always on, not $40: one Fargate
   task was priced where the design has two, and the public IPv4 charge was missed.
3. **`ForwardLimit`** (0033, `appsettings.json`). "A CDN in front of it is 2" is incomplete: each
   hop is checked against the trust list. See D-7.
4. **`UseHttpsRedirection`** (0007, 0033, the comment in `Program.cs`). The failure they describe —
   every request redirected behind a TLS-terminating balancer — cannot happen in a container that
   exposes no HTTPS port: the middleware logs a warning and does not redirect. The real hazard is
   the opposite one: configuring a port. Forwarded headers are still required, for the limiter's
   partition key and for HSTS.
5. **The target group health check** is `/healthz`, not `/readyz` (5.7).
6. **Data Protection storage** (0007, ROADMAP §5). "S3 or DynamoDB" has no maintained package
   behind it; see D-3.
7. **The database password** travels as `PGPASSWORD` beside a password-free
   `ConnectionStrings__DefaultConnection` (0005, 0014), so that it exists once.
8. **The Dockerfile line in ROADMAP §6** describes one image on `node:22`; there are two, on Node 24.
9. **Credential rotation.** 0005 judged it unnecessary; ROADMAP §1 and §7 list it as outstanding.
   This guide does it (2.1).
10. **Basic auth against `credentials: 'omit'`** (0028, 0036). See D-8.
11. **`vite.config.ts` needs `dotnet` to build** (3.2) — a blocker no record mentions, because CI
    hides it.
12. **A degraded home page is still cacheable on one path** (0013, and the rule in `CLAUDE.md`).
    0013 records it as fixed. The fix covers an API that cannot be reached; when the API answers
    and IGDB does not, `/api/home` is a 200 with nothing in it and the page goes out under
    `CACHE_HOME`. See 3.3. Read in the code, not run.

## Sources

Checked 21 September 2026.

**AWS accounts, billing and credits**

- Free Tier FAQ — https://aws.amazon.com/free/free-tier-faqs/
- Free Tier terms — https://aws.amazon.com/free/terms/
- Choosing a plan — https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html
- Explore AWS services with AWS Free Tier — https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html
- Free Tier update, 15 July 2025 — https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/
- Applying AWS credits — https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html
- Budgets pricing — https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/
- Budgets best practices — https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html
- Creating a member account — https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_create.html
- Accessing member accounts — https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_access-as-root.html
- Best practices for the management account — https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices_mgmt-acct.html
- Organizations quotas — https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html
- Create a permission set — https://docs.aws.amazon.com/singlesignon/latest/userguide/howtocreatepermissionset.html
- Assign user or group access — https://docs.aws.amazon.com/singlesignon/latest/userguide/assignusers.html
- AWS CLI with IAM Identity Center — https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html

**Pricing** — AWS Price List bulk files,
`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<SERVICE>/current/<REGION>/index.json`,
for AmazonECS, AmazonRDS, AWSELB, AmazonVPC, AWSSecretsManager, AmazonECR, AmazonCloudWatch, awskms,
AmazonRoute53 and AWSDataTransfer, published 11–18 September 2026; and:

- Fargate — https://aws.amazon.com/fargate/pricing/
- VPC, public IPv4 — https://aws.amazon.com/vpc/pricing/
- The public IPv4 charge — https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/
- CloudFront, pay as you go — https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/
- Route 53 — https://aws.amazon.com/route53/pricing/

**CDK and GitHub**

- Bootstrapping — https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html
- CDK in C# — https://docs.aws.amazon.com/cdk/v2/guide/work-with-cdk-csharp.html
- `aws-ecs` module — https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs-readme.html
- `aws-cloudfront` module — https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront-readme.html
- OpenID Connect in AWS — https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- `configure-aws-credentials` — https://github.com/aws-actions/configure-aws-credentials

**Compute, network and database**

- Fargate task networking — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
- Fargate capacity providers and Spot — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html
- Deployment circuit breaker — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html
- Service Connect — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html
- Service Connect components — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect-concepts-deploy.html
- Service discovery — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-discovery.html
- Application Load Balancers — https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
- ALB attributes — https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html
- ALB and `X-Forwarded` headers — https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html
- Managed prefix lists — https://docs.aws.amazon.com/vpc/latest/userguide/working-with-aws-managed-prefix-lists.html
- Stopping an RDS instance — https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html
- SSL with RDS for PostgreSQL — https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html
- RDS for PostgreSQL 18 — https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-rds-postgresql-major-version-18/

**DNS and email**

- Delegating a subdomain — https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html
- SES production access — https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- SES identities — https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html

**CloudFront**

- Custom origins — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html
- Origin settings — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html
- HTTPS to a custom origin — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-custom-origin.html
- Expiration and stale content — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html
- 4xx and 5xx from the origin — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HTTPStatusCodes.html
- Cache policies — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html
- Managed cache policies — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
- Managed origin request policies — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html
- Restricting access to an ALB — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html
- Edge server addresses and the prefix list — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html
- VPC origins — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html
- Functions event structure — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html
- KeyValueStore — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html
- KeyValueStore helper methods — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html
- KeyValueStore data and CLI — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html
- Community reports of the new-account block (not official) — https://repost.aws/questions/QUwuoclRJlQ7Gw5qjrlTAi4w/aws-account-needs-to-be-verified-before-you-can-add-new-cloudfront-resources

**ASP.NET, EF Core, Npgsql, Node**

- Enforcing HTTPS — https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl?view=aspnetcore-10.0
- Proxies and load balancers — https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0
- `ForwardedHeadersMiddleware` source, release/10.0 — https://github.com/dotnet/aspnetcore/blob/release/10.0/src/Middleware/HttpOverrides/src/ForwardedHeadersMiddleware.cs
- Key storage providers — https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-storage-providers?view=aspnetcore-10.0
- `Amazon.AspNetCore.DataProtection.SSM` — https://www.nuget.org/packages/Amazon.AspNetCore.DataProtection.SSM and https://github.com/aws/aws-ssm-data-protection-provider-for-aspnet
- `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` — https://www.nuget.org/packages/Microsoft.AspNetCore.DataProtection.EntityFrameworkCore
- The archived S3 package — https://github.com/hotchkj/AspNetCore.DataProtection.Aws
- Applying migrations and bundles — https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying
- Container port 8080 — https://learn.microsoft.com/en-us/dotnet/core/compatibility/containers/8.0/aspnet-port
- .NET container images — https://learn.microsoft.com/en-us/dotnet/core/docker/container-images
- Npgsql connection string parameters and environment variables — https://www.npgsql.org/doc/connection-string-parameters.html
- Npgsql security — https://www.npgsql.org/doc/security.html
- Node in Docker, best practices — https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
- `Request.credentials` — https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials
- Twitch, registering an app — https://dev.twitch.tv/docs/authentication/register-app/

**Read in the repository or its installed packages:** `@react-router/serve` 8.3.0 `dist/cli.js`
(`PORT`, `HOST`, the `SIGTERM` handler, asset cache headers); `react-router` 8.3.0
`lib/dom/ssr/single-fetch.js` and `lib/server-runtime/urls.js` (`.data` URL shapes, `_routes`);
Node 24.18's default `keepAliveTimeout`.
