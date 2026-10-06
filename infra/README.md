# infra

The AWS environment, as one CDK app in C#. What it builds and why is ADR 0044; the records it
rests on are 0007, 0014, 0015 and 0043.

Five stacks, split by lifetime, named `Mvgl-<env>-<part>`:

| Stack | Lifetime | Holds |
|---|---|---|
| `Dns` | permanent | the environment's public hosted zone |
| `Data` | long-lived | VPC, security groups, RDS, secrets, ECR, the cluster, the regional certificate, the GitHub deploy role, the basic-auth store |
| `EdgeCert` | long-lived, `us-east-1` | the certificate CloudFront uses |
| `Migrate` | each release | the task that runs the migration bundle |
| `App` | disposable | the balancer, both services, the DNS alias |

Context: `env` (required), `imageTag` (the git SHA; without it `Migrate` and `App` synthesise
with an error the CLI refuses to deploy over, so nothing falls back to `latest`), `allowedCidr`
(the one address the balancer admits before CloudFront exists; absent, it admits CloudFront only).

```bash
cdk synth --profile mvgl-dev -c env=dev -c imageTag=<sha>
cdk deploy Mvgl-dev-Data --profile mvgl-dev -c env=dev -c allowedCidr=<your ip>/32
```

The long-lived stacks are deployed from a developer machine; the pipeline deploys `Migrate` and
`App` only, as the deploy role the `Data` stack creates.

## The pipeline

`.github/workflows/deploy-dev.yml` runs after every green CI run of a push to master, and by
hand. CI runs on pull requests too, and a fork's branch called `master` passes the branch
filter, so the automatic path also requires the triggering run to be a `push` to this
repository - without that, a green CI run would hand the AWS role to anybody's code. The job
assumes the deploy role through OIDC - no AWS key is stored in GitHub - builds both images and
pushes them tagged with the commit, and then stops unless `DEV_DEPLOY_ENABLED` is `true` on the
`dev` GitHub environment. Awake, it deploys `Migrate`, runs the migration task and fails the
release on a non-zero exit, deploys `App`, waits for both services and checks target health.
Both deploys are `--exclusively`, and the `App` deploy only ever *updates* the stack: the gate is
read once, when the job starts, so a park that began mid-run would otherwise be undone by a job
that recreates the stack over a stopped database. Creating `App` is `resume`'s job alone. A
re-run for a commit whose images are already in ECR skips the build; the repositories are
immutable, so it could not push them again anyway.

The `dev` environment holds four variables, none secret: `AWS_ROLE_ARN`, `AWS_REGION`,
`AWS_ACCOUNT_ID` and `DEV_DEPLOY_ENABLED`, and admits deployments from `master` only.
`scripts/dev-env.mjs park` and `resume` set the gate; nothing else should.

## Parking and resuming

The balancer, not the containers, is what an idle environment pays for, so the lever that matters
is destroying the `App` stack; stopping the database afterwards reaches the idle floor
(ADR 0044). `node scripts/dev-env.mjs park` does both in that order and gates the pipeline off;
`resume` starts the database, deploys `App` at the newest pushed tag and gates it back on;
`status` says which cost row the environment is on. Run them from the repository root with the
`mvgl-dev` profile signed in.

## Things that will bite you

- **A stopped database may refuse to start, for a while.** A Single-AZ instance is pinned to its
  availability zone, and the small classes run out of capacity there now and then: the first
  resume of this environment was refused with `InsufficientDBInstanceCapacity`, and the same
  request succeeded a few minutes later. That is AWS's weather, not a mistake. `dev-env.mjs
  resume` asks again once a minute for up to twenty minutes; by hand, retry `start-db-instance`.
  If it persists, the way out is a different instance class in `DataStack`, not a different zone -
  a Single-AZ instance cannot be moved.

- **`cdk deploy` deploys a stack's dependencies too, and the `Data` stack synthesised without
  `allowedCidr` admits CloudFront only.** So `cdk deploy Mvgl-dev-App -c imageTag=…` on its own
  also redeploys `Data`, and silently replaces the balancer's allow rule with the prefix list -
  which is what happened on the first deploy by hand, and is why the site then times out from the
  one address that was allowed. Until the CloudFront phase, every deploy of `Migrate` or `App`
  either passes `allowedCidr` as well or uses `--exclusively`; `scripts/dev-env.mjs` always uses
  `--exclusively`, and so must the pipeline, which has no address to pass.

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

- **Every ingress rule on the balancer is owned by `DataStack`, and both listeners are
  `Open = false`.** CDK otherwise "opens" an internet-facing balancer by writing `0.0.0.0/0`
  ingress for each listener port into its security group - which is the data stack's, so a
  synth that includes the application stack would silently undo the `allowedCidr` and
  CloudFront-only rules the data stack holds, and the next `Data` deploy would apply it. Read the
  balancer group's inline `SecurityGroupIngress` in the synthesised Data template, not only the
  standalone ingress resources, when checking this.
