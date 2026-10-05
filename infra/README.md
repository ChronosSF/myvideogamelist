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

Context: `env` (required), `imageTag` (the git SHA; `Migrate` and `App` exist only when it is
given, so nothing falls back to `latest`), `allowedCidr` (the one address the balancer admits
before CloudFront exists; absent, it admits CloudFront only).

```bash
cdk synth --profile mvgl-dev -c env=dev -c imageTag=<sha>
cdk deploy Mvgl-dev-Data --profile mvgl-dev -c env=dev -c allowedCidr=<your ip>/32
```

The long-lived stacks are deployed from a developer machine; the pipeline deploys `Migrate` and
`App` only, as the deploy role the `Data` stack creates.

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

- **Every ingress rule on the balancer is owned by `DataStack`, and both listeners are
  `Open = false`.** CDK otherwise "opens" an internet-facing balancer by writing `0.0.0.0/0`
  ingress for each listener port into its security group - which is the data stack's, so a
  synth that includes the application stack would silently undo the `allowedCidr` and
  CloudFront-only rules the data stack holds, and the next `Data` deploy would apply it. Read the
  balancer group's inline `SecurityGroupIngress` in the synthesised Data template, not only the
  standalone ingress resources, when checking this.
