# infra

The AWS environment, as one CDK app in C#. What it builds and why is ADR 0044; the records it
rests on are 0007, 0014, 0015 and 0043.

Five stacks, split by lifetime, named `Mvgl-<env>-<part>`:

| Stack | Lifetime | Holds |
|---|---|---|
| `Dns` | permanent | the environment's public hosted zone |
| `Data` | long-lived | VPC, security groups, RDS, secrets, ECR, the cluster, the regional certificate, the GitHub deploy role, the basic-auth store, the origin-verify secret |
| `EdgeCert` | long-lived, `us-east-1` | the certificate CloudFront uses |
| `Migrate` | each release | the task that runs the migration bundle |
| `App` | disposable | the balancer, both services, the distribution in front of the balancer, the DNS alias |

Context: `env` (required) and `imageTag` (the git SHA; without it `Migrate` and `App` synthesise
with an error the CLI refuses to deploy over, so nothing falls back to `latest`).

```bash
cdk synth --profile mvgl-dev -c env=dev -c imageTag=<sha>
cdk deploy Mvgl-dev-Data --profile mvgl-dev -c env=dev
```

The long-lived stacks are deployed from a developer machine; the pipeline deploys `Migrate` and
`App` only, as the deploy role the `Data` stack creates. The balancer admits CloudFront's
origin-facing prefix list and nothing else, so there is no way to reach the environment except
through the distribution, and no parameter that would open one.

## The pipeline

`.github/workflows/deploy-dev.yml` runs after every green CI run of a push to master, and by
hand. CI runs on pull requests too, and a fork's branch called `master` passes the branch
filter, so the automatic path also requires the triggering run to be a `push` to this
repository - without that, a green CI run would hand the AWS role to anybody's code. The job
assumes the deploy role through OIDC - no AWS key is stored in GitHub - builds both images and
pushes them tagged with the commit, and then stops unless `DEV_DEPLOY_ENABLED` is `true` on the
`dev` GitHub environment. Awake, it deploys `Migrate`, runs the migration task and fails the
release on a non-zero exit, deploys `App`, waits for both services, invalidates the distribution
and waits for that too, then checks target health and the site through the distribution: a 401
without the basic-auth pair, and with it `/readyz` and `/` answering 200. The distribution id is
read from the `App` stack's outputs, since it changes on every resume.
Both deploys are `--exclusively`, and the `App` deploy only ever *updates* the stack: the gate is
read once, when the job starts, so a park that began mid-run would otherwise be undone by a job
that recreates the stack over a stopped database. Creating `App` is `resume`'s job alone. A
re-run for a commit whose images are already in ECR skips the build; the repositories are
immutable, so it could not push them again anyway.

The `dev` environment holds four variables, none secret: `AWS_ROLE_ARN`, `AWS_REGION`,
`AWS_ACCOUNT_ID` and `DEV_DEPLOY_ENABLED`, and one secret, `DEV_BASIC_AUTH`, the basic-auth pair
as `user:password`, which only the smoke test reads; until it is set the authenticated checks are
skipped with a warning. The environment admits deployments from `master` only.
`scripts/dev-env.mjs park` and `resume` set the gate; nothing else should.

## The edge

CloudFront is one origin - the balancer - and decides only what is cached and what is forwarded;
the balancer goes on routing between the two processes. What each setting is for is ADR 0044's
CloudFront section, and `Edge.cs` says it again beside each one. Three things are not in the code:

- **The basic-auth credential lives in the KeyValueStore and is set by hand**, once, after the
  `Data` stack exists and before the first `App` deploy: with no key the function fails closed and
  every request is an error, not a 401. The value is the whole `Authorization` header:

  ```bash
  aws cloudfront-keyvaluestore put-key --profile mvgl-dev --kvs-arn <BasicAuthStoreArn output> --if-match "$(aws cloudfront-keyvaluestore describe-key-value-store --profile mvgl-dev --kvs-arn <BasicAuthStoreArn output> --query ETag --output text)" --key basic-auth --value "Basic $(printf '%s' '<user>:<password>' | base64)"
  ```

  Keep the pair to letters and digits. Nothing in the chain forbids other characters - the
  function compares the whole header byte for byte - but what a shell stores and what a browser
  sends for punctuation or accented letters are two encodings that have to agree, and the first
  pair set here did not pass the browser's prompt until it was simplified. Change the pair with
  the same command, then update the GitHub secret, or the smoke test fails with a 401.

  Three paths are exempt, because the client fetches them with `credentials: 'omit'` and the
  browser then withholds the `Authorization` header too: a game's reviews, community scores and
  community times (ADR 0044, D-8). The exemption is a regular expression in
  `src/Infra/functions/basic-auth.js`; a new public aggregate fetched the same way joins it there.

- **The balancer answers only our distribution** (ADR 0046). The prefix list proves that a request
  came through *some* distribution; the `X-Origin-Verify` header, whose value is the
  `mvgl/<env>/origin-verify` secret, proves it came through ours, and the listener's default action
  is a 403. The value reaches the distribution and the listener as a Secrets Manager dynamic
  reference, so it is in no template and in no output. Rotating it is a `Data` deploy with a new
  generated value followed by an `App` deploy, in that order, and the site is a 403 in between.

- **The first deploy of this phase has an order**, because every cross-stack reference is resolved
  when the consuming stack deploys: `EdgeCert` in `us-east-1` (its certificate output is new),
  then `Data`, then the credential, then `App`. After that, `resume` and the pipeline need nothing
  but `App`.

## Parking and resuming

The balancer, not the containers, is what an idle environment pays for, so the lever that matters
is destroying the `App` stack; stopping the database afterwards reaches the idle floor
(ADR 0044). `node scripts/dev-env.mjs park` does both in that order and gates the pipeline off;
`resume` starts the database, deploys `App` at the newest pushed tag, checks the site through the
distribution and gates it back on; `status` says which cost row the environment is on. Run them
from the repository root with the `mvgl-dev` profile signed in. The `App` stack includes the
distribution, so a park and a resume each take several minutes longer than the services alone
would; a resume creates a new distribution with a new id, and nothing is cached across one.
`resume` proves the door is on - a 401 without credentials - and, with `MVGL_DEV_BASIC_AUTH` set
to the pair as `user:password`, that `/healthz` answers through it.

`node scripts/dev-check.mjs` is the acceptance test, the walkthrough's Phase 11 as a program: run
it after any change to the stacks and after every resume. Without the pair it checks the door,
the three exempt paths and the redirect; with it, health, the crawler headers, `SITE_URL`, every
route's `Cache-Control`, where the cache hits and where it never may, that a 404 is a 404, and
that the write guard survives the edge. `--alb <dns name>` adds the check that the balancer does
not answer directly.

## Things that will bite you

- **A stopped database may refuse to start, for a while.** A Single-AZ instance is pinned to its
  availability zone, and the small classes run out of capacity there now and then: the first
  resume of this environment was refused with `InsufficientDBInstanceCapacity`, and the same
  request succeeded a few minutes later. That is AWS's weather, not a mistake. `dev-env.mjs
  resume` asks again once a minute for up to twenty minutes; by hand, retry `start-db-instance`.
  If it persists, the way out is a different instance class in `DataStack`, not a different zone -
  a Single-AZ instance cannot be moved.

- **`cdk deploy` deploys a stack's dependencies too.** So `cdk deploy Mvgl-dev-App -c imageTag=…`
  on its own also redeploys `Data`, with whatever this checkout synthesises for it. Before
  CloudFront, when `Data` took an `allowedCidr` parameter, that silently replaced the balancer's
  allow rule with the prefix list and the site timed out from the one address that was allowed;
  the parameter is gone, but the habit stays: every deploy of `Migrate` or `App` uses
  `--exclusively` - `scripts/dev-env.mjs` and the pipeline both do - so the long-lived stack
  changes only when somebody deploys it by name.

- **Cross-stack references are weak, so `Data`'s outputs are only as complete as the synthesis
  that deployed it.** `cdk.json` sets `defaultCrossStackReferences` to `weak`: `Migrate` and `App`
  read what they need from `Data` at deployment time with `Fn::GetStackOutput`, and `Data` emits
  one output per thing they read - derived from the consumers present in the synthesis. Unlike an
  export, CloudFormation removes such an output without complaint while a deployed stack still
  reads it. The first Data redeploy after the first release was synthesised without an image tag,
  so the two stacks were not in the app, every one of those outputs was dropped with a clean log,
  and the next resume failed with "output … was not found". That is why `Program.cs` now puts the
  two stacks in every synthesis, carrying an error instead of an image when no tag is given, and
  why the deployed Migrate stack kept working throughout: a weak reference is resolved only when
  its own stack deploys. If the error ever returns, `cdk diff Mvgl-dev-Data` with any tag shows
  the outputs it would add back, and deploying it is the whole fix.

- **Every ingress rule on the balancer is owned by `DataStack`, and the listener is
  `Open = false`.** CDK otherwise "opens" an internet-facing balancer by writing `0.0.0.0/0`
  ingress for the listener port into its security group - which is the data stack's, so a synth
  that includes the application stack would silently undo the CloudFront-only rule the data stack
  holds, and the next `Data` deploy would apply it. Read the balancer group's inline
  `SecurityGroupIngress` in the synthesised Data template, not only the standalone ingress
  resources, when checking this.
