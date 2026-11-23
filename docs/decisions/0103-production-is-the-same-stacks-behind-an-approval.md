# 0103. Production is the same stacks, deployed by the workflow dev is, behind an approval

**Status:** Accepted; built, and nothing of it deployed. The production account is as it was. Builds on
[0044](0044-what-the-deployment-walkthrough-settled.md) and
[0066](0066-a-holding-page-until-production-takes-the-domain.md), whose §8 it fills in. Amends
[0099](0099-dev-is-deployed-by-hand.md): the steps a run executes are now `deploy.yml`, which `Deploy
dev` calls. Says what [0101](0101-devs-basic-auth-comes-off-for-the-trial.md)'s "any other environment"
means for production, and decides 0044's D-5 for it. §2's three members of `Site` are four, and
production's database is not in one zone, since
[0106](0106-productions-database-is-multi-az-and-a-failover-is-a-minute-or-two-of-errors.md).

## Context

`-c env=prod` synthesised three stacks: the holding page, the alerts topic and the email stack.
[#98](https://github.com/ChronosSF/myvideogamelist/issues/98) is the rest of production, in parts. This
record is the first part, the environment itself
([#414](https://github.com/ChronosSF/myvideogamelist/issues/414)), and with it the canonical host
([#417](https://github.com/ChronosSF/myvideogamelist/issues/417)). Private subnets, a Multi-AZ database
and the move of dev's accounts are their own issues and are not decided here.

The CDK app was written for a second environment from the start. `Site` derives every name from `env`,
knows production's account and that its host is the apex, and `AppStack` already sends email as its own
task role where the environment is production. Four things were missing:

- **`Program.cs` built nothing else for production.** It returned after the three stacks.
- **The zone.** Every other environment makes its own, delegated from the domain's. Production's is the
  domain's, made by hand, and a stack that made a second one of that name would be a mistake nobody
  would see until a record went missing (0044).
- **`www`.** The holding page sends it to the apex with a 301, which browsers keep for good, so
  production has to go on doing that (0066 §2).
- **A pipeline.** `Deploy dev` named dev in every command.

## Decision

### 1. `env=prod` synthesises what dev does, less the zone

`EdgeCert`, `Data`, `Migrate`, `Waf` and `App`, from the same classes, in the production account, beside
the three stacks it had. No `Dns` stack is synthesised for it.

`EdgeCert` looks the domain's zone up and hands it to the other stacks. It is the stack that asks
because a lookup is cached in `cdk.context.json` under the account and Region of the stack that asked,
and the holding page's stack asked from `us-east-1` first: the answer is already committed. What a
lookup returns is the zone's id as a plain string, so the stacks in the other Region use it with no
reference between them.

Two more lookups are production's own, the Region's availability zones and CloudFront's managed prefix
list. A synthesis with production's credentials made them on 2026-11-22 and wrote them into
`cdk.context.json`, which is committed, as 0066 did for the zone. So CI synthesises production beside
dev, with no lookups and no credentials, and a stack that asks either account something new fails there
until its answer is committed.

**An environment is refused in the other's account.** The stacks go wherever the credentials point, and
dev's synthesised for production's account as readily as for their own: `cdk deploy -c env=dev` with
production's profile would have made them there, three of them protected from deletion. Production's
failed in dev's account only by accident, at the zone they look up. So `Program.cs` compares the account
it is given with `Site.Account` before it makes a stack, and names both when they differ. CI asks for
dev's stacks with production's account and expects that refusal.

### 2. What differs is in `Site`, and is three things

- **`RedirectedHosts`**: `www` for production, nothing for any other environment.
- **`Indexable`**: production alone. Its SSR server is given `SITE_INDEXABLE=true`, and every other
  environment's is given nothing, so every response of theirs says `noindex, nofollow`
  ([0036](0036-what-a-crawler-is-told.md)).
- **`BehindBasicAuth`**, which 0101 added: false for dev, true for production. §5.

Everything else is dev's, sizes included: one task for each service at a quarter of a vCPU, a
`db.t4g.micro` in one availability zone, tasks in public subnets. Those are
[#415](https://github.com/ChronosSF/myvideogamelist/issues/415),
[#416](https://github.com/ChronosSF/myvideogamelist/issues/416) and
[#101](https://github.com/ChronosSF/myvideogamelist/issues/101), each to be decided on its own.

**The cookie keeps no `Domain`.** #414 asks for it to be set, as D7 did. 0066 §2 answered that against
its wording: with `www` only redirecting, the apex is the one host the app answers at, and
`Domain=myvideogamelist.net` would send production's session cookie to `dev.` as well. Nothing is set.

### 3. `www` only redirects, and the redirect and the door are one function

The edge certificate covers `www`, `App` points it at the distribution, and the distribution answers a
request for it with a 301 to the same path and query on the apex. So does a request by any other name,
the distribution's own `cloudfront.net` domain included, as 0066 §2 has it.

A CloudFront behaviour holds one function for each event, and the basic-auth door is already the
viewer-request function. So the two are one function, `functions/viewer-request.js`, with the redirect
first: a name that only redirects never asks for the pair. `Edge.cs` puts the host, whether the door is
on, and the environment's name in place of three tokens in the file, and refuses to synthesise if one
is gone.

The function is on a behaviour only where it has a job. Production's has both. Dev is open and answers
by one name, so no behaviour of dev's names it and its distribution is unchanged; it is still made, for
0101's reasons.

**Not a second distribution for `www`**, as the holding page's own stack could have been split. It
would be a second certificate, a second set of records and a second thing to keep answering, for a
redirect.

**The certificate is validated by the records the holding page's is, and the check asks for them.**
Both cover the apex and `www`, in one account, and ACM's documentation has a validation record made
for a domain and an account
(<https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html>). `EdgeCert` is deployed while
the holding page stands, and the holding page's certificate is deleted with its stack. ACM renews a
certificate only while its records are in public DNS, and looks 45 days before it expires
(<https://docs.aws.amazon.com/acm/latest/userguide/dns-renewal-validation.html>), so records that went
with the old certificate would cost nothing for a year and then the site its certificate.

What CloudFormation does with them is not in its documentation or ACM's, read on 2026-11-22: neither
whether a certificate's deletion removes the records, nor whether one asked for where they already
exist is refused. An open report on CloudFormation's roadmap says a deletion leaves them
(<https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/1603>), which is a
report and not a promise. So neither is assumed:

- **A refusal would show first, and cost nothing**: at `EdgeCert`'s deploy, ahead of the day, with the
  holding page untouched.
- **A removal is looked for.** `dev-check.mjs`, with the profile signed in, asks ACM which records the
  certificate is validated by and public DNS for each, where ACM looks. It does so on the day, after
  the holding page's destroy, and on every run after, for dev too. One found gone is put back by
  hand, as `infra/README.md` says.

### 4. `/healthz` and `/readyz` stay routed, in production too

0044's D-5 left this for production to decide, because each `/readyz` is an IGDB call open to anybody.
Since then the edge has a rate rule ([0098](0098-one-rate-rule-at-the-edge.md)), which counts a
`/readyz` as it counts a page, and a game page nobody has looked at lately costs IGDB three calls to
`/readyz`'s one. So it adds nothing an address could not already spend. It is also what the pipeline's
smoke test asks through the distribution, which is the one check that the API reaches its database and
IGDB after a deploy.

### 5. Production is behind basic auth from its first deploy, and opening it is the launch

0101 made the door one line, false for dev and true for anything else. For production that stands, and
is deliberate:

- **The first deploy is a rehearsal nobody else is in.** The stack is checked through the door with
  `dev-check.mjs --env prod` before a stranger can reach it.
- **Dev's accounts arrive first** ([#465](https://github.com/ChronosSF/myvideogamelist/issues/465)).
  A tester who signed up again on an open production before their account was moved would hold two.
- **Opening is then a reviewed change**: the line, a merge, a run of `Deploy prod`, and its approval.

**The cost:** between the holding page's destroy and that run, the apex answers a browser's password
prompt, and a crawler a 401. It is as long as the rehearsal takes, and the pull request that opens the
door can be ready before it starts.

### 6. One workflow deploys both, and production's asks for an approval

`deploy.yml` holds the steps, parameterised by the environment, and is run only by being called.
`Deploy dev` and `Deploy prod` are each a dispatch and a call, naming the environment and the variable
that gates it. So production is released by the steps dev has been released by: every run of
`Deploy dev` from now on is a run of production's pipeline.

**Not a copy of the file with the names changed.** Two files that have to be kept in step by hand are
in step until the day one is fixed in a hurry, and production's would be the one never run.

**The approval is the `prod` GitHub environment's required reviewers.** A job that names an environment
waits for its protection rules before it starts, so the wait comes before the build, not between the
build and the deploy. The deploy role's trust is `Data`'s, as dev's is: one subject, a job in this
repository that declares the environment `prod`.

**The gate is `PROD_DEPLOY_ENABLED`**, as dev's is `DEV_DEPLOY_ENABLED`. Off, or with no application
stack to update, a run builds both images, pushes them to production's own repositories and stops.
Each environment builds its image from the same commit, into its own account; the layer cache makes
the second build short. Copying dev's image across accounts would be one build fewer and a grant
between the accounts that nothing else needs.

The smoke test reads where the site answers from a new output of `App`, `SiteUrl`, as it reads whether
the door is on.

**The pair's secret is written out in `deploy.yml`, once for each environment**: `DEV_BASIC_AUTH` and
`PROD_BASIC_AUTH`, each read only in its own environment's run and neither as the other's fallback, so
that a secret of dev's name that was one day the repository's could not reach production. The first
draft had each caller pass the secret's
name and read it as `secrets[...]`, and code scanning raised it on the pull request
(`actions/excessive-secrets-exposure`): by that rule's account, a name that is only known once the job
runs leaves GitHub handing the runner every secret the job can read. Today that is the one secret
either way, since the repository holds none; written out, it stays the one. Each is its own
environment's secret, so the other's is empty in a run. A third environment is a third name there.

What GitHub's documentation says about a called workflow, read on 2026-11-22, and what it does not:

- **A job in a called workflow may name an environment, and gets that environment's secret only if the
  caller passes it.** One the caller did not pass is an empty string, with no error
  (<https://docs.github.com/en/actions/sharing-automations/reusing-workflows>). So both callers say
  `secrets: inherit`. The repository holds no secret of its own, so what that hands over is nothing but
  the right to read the environment's.
- **The `github` context there is the caller's**
  (<https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations>),
  so 0099's check that a run's workflow is still master's reads the same commit, and now compares
  both files.
- **A called workflow can be given fewer permissions than its caller and never more**, so each caller
  grants `id-token: write`.
- **Required reviewers are available to a public repository on the free plan**
  (<https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>).
- **Not said anywhere read:** that a job inside a called workflow sees its environment's *variables*,
  and what `sub` its OIDC token carries. The documented subject of a job that names an environment is
  `repo:<owner>/<repo>:environment:<name>`, which is what the role trusts. Both are proved by a run and
  by nothing else, and either being wrong stops the run before it deploys: with no role to assume, or
  with the gate read as off.

### 7. The first deploy is made by hand, by the tool that resumes dev

The pipeline only ever updates an application stack; creating one is `dev-env.mjs resume`'s alone
(0044's D-6, 0099). That holds for production, and is what keeps the step that takes the domain from the holding page
something a person runs. 0066 §8 gave the order; this is what each step is run with.

Ahead of the day, in any order that the list allows:

1. The lookups of §1, committed. Done, with this change.
2. `EdgeCert`, `Data` and, if it is not there, `Alerts`, deployed by name.
3. What is set by hand: IGDB's pair and a Turnstile widget's in their secrets, the basic-auth pair in
   its store, and `/mvgl/prod/admin-account-id` holding `none`
   ([0102](0102-a-deployed-admin-is-a-hand-set-parameter-the-task-reads.md)).
4. The `prod` GitHub environment: its reviewers, deployments from `master` only, its three AWS
   variables, the gate set to `false`, and the pair as its secret.
5. A run of `Deploy prod`, which pushes master's images and stops.

On the day:

6. `node scripts/dev-env.mjs resume --env prod`, with the holding page still answering. It migrates the
   database at the newest tag, deploys `Waf`, and stops before `App`, naming the holding page's stack.
   Neither step uses the holding page's names, so production's first migration and its first web ACL
   are made where whatever goes wrong in them costs the domain nothing.
7. `cdk destroy Mvgl-prod-Holding`. The domain answers nothing from here.
8. `resume` again. It finds the migration and `Waf` done, deploys `App`, proves the door is on, and
   sets the gate.
9. `node scripts/dev-check.mjs --env prod`, with the pair and the profile signed in, which is also
   what says the certificate's validation records outlived the holding page (§3).
10. The pull request that opens the door, and a run of `Deploy prod`.

`dev-env.mjs park --env prod` refuses. Production is not parked, and nothing in that script would put
the holding page back.

`dev-check.mjs --env prod` checks what production is meant to be where that differs from dev: that
`robots.txt` names the sitemap, that documents carry no `X-Robots-Tag`, and that `www` is redirected to
the same address on the apex.

### 8. An alarm in another Region is an error, not a silence

A CloudWatch alarm can only tell a topic in its own Region. Production's topic is pinned to the Region
the domain is verified with SES in, because SES sends each bounce and complaint to the same topic
([0091](0091-a-bounce-or-a-complaint-stops-all-mail-to-that-address.md)). Every other stack of
production's takes its Region from the profile. So where the two differ, `App` carries an error and
does not deploy, where it would otherwise have made five alarms that reach nobody.

## Consequences

- **Nothing is deployed by this, and nothing can be until the owner's steps.** What production costs
  once `Data` is up is what dev's rows say, since the resources are the same ones in the same Region
  (0044).
- **The shared workflow cannot be exercised by a pull request**, since it runs only when dispatched on
  master (0101). The first run of `Deploy dev` after this merges is its proof, and the two things §6
  says are not documented are what it proves. Run it when nothing is waiting on a deploy.
- **That run changes two things on dev and nothing a reader sees.** The idle edge function is replaced
  by one under the new name, `mvgl-dev-viewer-request`, and `App` gains the `SiteUrl` output.
- **The holding page's stack stays in the synthesis** until it is destroyed and then removed from
  `Program.cs`, with `holding/`.
- **`scripts/site.mjs` restates three lines of `Site.cs`** for the two scripts: the host, the names
  that redirect and whether the site is indexable. A change to one is a change to both, and
  `scripts/check-site.mjs` is what says so: CI runs it after each synthesis, against the names on the
  distribution, on the certificate and in the zone's records, the `SiteUrl` output and whether the SSR
  server is told it is indexable. Not stack outputs the scripts read, as they read `BasicAuth`: the acceptance test has to
  run with no profile signed in.
- **Not here:** private subnets and a Multi-AZ database (#415, #416), the move of dev's data (#465),
  HSTS on documents ([#436](https://github.com/ChronosSF/myvideogamelist/issues/436)), the managed
  rule lists ([#438](https://github.com/ChronosSF/myvideogamelist/issues/438)) and a second task (#101).
