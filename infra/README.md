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
