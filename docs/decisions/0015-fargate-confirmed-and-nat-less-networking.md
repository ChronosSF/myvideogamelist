# 0015. ECS Fargate confirmed, with NAT-less networking

**Status:** Accepted — revisits the compute alternatives in [0007](0007-aws-target-architecture.md)
and adds the network topology it left unstated

## Context

[0007](0007-aws-target-architecture.md) chose ECS Fargate and listed App Runner as "a sensible
first step if ECS proves heavy early on". Before building, both that fallback and the obvious
PaaS alternative were re-examined.

0007 also never stated how the tasks reach the internet. Left to the default pattern —
containers in private subnets — that decision gets made implicitly by a NAT Gateway, which at
roughly **$32/month per availability zone plus $0.045/GB** would be the single largest line on
the bill, larger than the database.

## Decision

**Compute stays ECS Fargate.** Two services behind one ALB, as 0007 describes.

**Tasks run in public subnets with public IPs, and there is no NAT Gateway.** The database
stays in private subnets with no public endpoint, reachable only from the tasks' security
group. Inbound traffic to the tasks is restricted to the ALB's security group.

### Compute alternatives, re-examined

| Option | Verdict |
|---|---|
| **ECS Fargate** | Chosen. Handles the two-process split from [0003](0003-two-process-deployment.md) naturally — two containers, CloudFront routing `/api/*` to one and everything else to the other. |
| **AWS App Runner** | **Now in maintenance mode.** 0007 held it as a fallback; that is no longer a safe place to start something new. This ADR withdraws it as an option. |
| **Elastic Beanstalk** | Rejected. In 2026 it sits between two worlds — more opaque than raw EC2, less capable than containers-as-a-service, with lagging platform versions. It also handles a two-process application awkwardly. |
| **EKS** | Rejected. Kubernetes for two containers is not a serious proposal at this size. |
| **Lambda + API Gateway** | Still rejected, for the reasons in 0007. |

### Why no NAT Gateway

The tasks need outbound internet access for IGDB and Steam, which are on the request path.
Containers in private subnets can only reach those through a NAT Gateway.

Public subnets with public IPs give the same outbound access for nothing. The security
question people raise — "the containers are on the internet" — is answered by security groups
rather than subnet placement: nothing reaches a task except through the ALB, and the database
is unreachable from outside the VPC either way.

VPC interface endpoints were considered as the usual NAT alternative, but at roughly $7.30 per
endpoint per month, the four needed (ECR, ECR Docker, CloudWatch Logs, Secrets Manager) cost
about as much as the NAT Gateway they replace, and they do not solve outbound access to IGDB
or Steam at all — only AWS API traffic.

## Cost baseline

With the RDS choice from [0014](0014-rds-postgresql-over-aurora.md) and no NAT:

| Item | ~$/month |
|---|---|
| RDS `db.t4g.micro`, Single-AZ | 12 |
| 20 GB storage | 2 |
| Application Load Balancer | 17 |
| Fargate, one small task, always on | 9 |
| Route 53 hosted zone | 0.50 |
| NAT Gateway (avoided) | 0 |
| **Total** | **~$40** |

Against the ~$200 of new-account credits described in 0014, that is roughly **five months** of
runway. The Aurora-plus-NAT shape 0007 implied would have consumed the same credits in about
two.

## Consequences

- **Revisit this before launch, not after.** Public-subnet tasks are a reasonable trade at
  pre-launch scale; private subnets behind NAT are the right answer once the traffic justifies
  the cost, and the change is a CDK edit rather than a re-architecture.
- Single-AZ everywhere is deliberate and is a **deliberate availability trade**, not an
  oversight. It must be revisited before the service is one anyone depends on.
- One of the five credit-earning onboarding tasks is "set up a cost budget in AWS Budgets".
  Do that first: it pays $20 and is the correct hour-one habit regardless.
- Everything in 0007's consequences still applies unchanged — Data Protection keys off the
  local filesystem, migrations out of startup, a distributed cache, `UseForwardedHeaders`, and
  ACM certificates in `us-east-1`.
