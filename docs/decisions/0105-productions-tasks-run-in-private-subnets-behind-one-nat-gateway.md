# 0105. Production's tasks run in private subnets behind one NAT gateway

**Status:** Implemented; nothing deployed. Undoes, for production alone, the trade
[0015](0015-fargate-confirmed-and-nat-less-networking.md) accepted until launch, and amends for production
the network [0044](0044-what-the-deployment-walkthrough-settled.md) describes: its `tasks` group is private
and a fourth group holds the gateway. Dev keeps both as written. A member of `Site`, as
[0103](0103-production-is-the-same-stacks-behind-an-approval.md) §2 has every difference between the
environments. Closes [#415](https://github.com/ChronosSF/myvideogamelist/issues/415).

## Context

0015 put the tasks in public subnets, each with a public address, with no NAT gateway, and said to
revisit that "before launch, not after". [#98](https://github.com/ChronosSF/myvideogamelist/issues/98)
holds production to it. Production's `Data` stack, which holds the VPC, is about to be deployed by hand,
once, termination-protected; making its network what it will be before anything lives in it means no
change to it is ever made under a database with people's lists in it.

Dev stays as it is, to the byte. It holds the testers' accounts and lists, which move to production at
launch ([#465](https://github.com/ChronosSF/myvideogamelist/issues/465)), and nothing here may change
what it deploys.

### What the tasks reach

Everything a task talks to outside the VPC, from the code and from Fargate's own needs:

- **The API**: IGDB (`api.igdb.com`) and Twitch's token endpoint (`id.twitch.tv`), `IgdbService`; Steam's
  news (`api.steampowered.com`), `SteamNewsService`; Cloudflare's siteverify
  (`challenges.cloudflare.com`), `Turnstile`; SES in `eu-central-1`, which production's API sends through
  as its own task role (0103), where dev's assumes production's role through STS first (0088);
  CloudFront's API, to invalidate a withdrawn profile (0058); and Parameter Store, where the key ring is
  (0043).
- **Fargate, for both services and the migration task**: ECR, to log in and pull the image, whose layers
  come from S3; CloudWatch Logs; and Secrets Manager and Parameter Store, for the secrets the task
  definition names. From platform version 1.4.0, "all network traffic flows through that ENI within your
  VPC", the task's own, and AWS lists the image pull, the log driver and the secrets among it; "for a task
  on Fargate to pull a container image, the task must have a route to the internet"
  (<https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html>). ECR's
  guide says why S3: ECR "uses Amazon S3 to store your image layers"
  (<https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html>).
- **The SSR server** calls nothing outside but the API, which it reaches inside the VPC by Cloud Map.

Inside the VPC, and untouched by any of this: the database, in the isolated `data` subnets; Cloud Map's
names; the balancer, which reaches each task at its private address, since the target groups are of
type IP.

So a task with no public address needs a NAT gateway or, for the AWS services alone, VPC endpoints.
IGDB, Steam and Cloudflare have none, so a NAT gateway is needed whatever else is chosen.

## Decision

### 1. Production has one NAT gateway, in subnets of its own; dev has none

`Site.NatGateways` is 1 for production and 0 for every other environment, and `Site.PrivateTasks` is
whether it is more than none. Where it is:

- **The `tasks` group is private with egress**: its subnets hand out no address at launch and their
  default route is the gateway. Both services and the migration task are started with
  `AssignPublicIp` `DISABLED`.
- **The gateway is in a fourth group, `nat`, public, the smallest a subnet can be (/28).** Not in the
  balancer's `alb` subnets, which [0044](0044-what-the-deployment-walkthrough-settled.md) made the
  balancer's own so that they could be the API's forwarded-headers trust list, exactly. Listed last, so
  that every other group's ranges are dev's: `alb` 10.0.0.0/27 and 10.0.0.32/27, `tasks` 10.0.1.0/24 and
  10.0.2.0/24, `data` 10.0.3.0/24 and 10.0.4.0/24, then `nat` 10.0.5.0/28 and 10.0.5.16/28.
- **The gateway is in `eu-central-1a`**, with an Elastic IP, and both task subnets route through it. A
  task in `eu-central-1b` reaches it across zones.
- **Dev's subnets are described as they were made**, as a second list rather than a switch in each line
  of one: its seven templates synthesise byte for byte as they did before this change.

**One, not two, and that is a trade.** With one gateway in `eu-central-1a`, the loss of that zone leaves
the tasks in both zones with no way out: no task can pull its image or read its secrets, so none can
start, and one still running loses IGDB, Steam, Cloudflare, SES and its logs, whatever the database does.
The loss of `eu-central-1b` costs the way out nothing. Two gateways, one in each zone, would make the
way out survive either; they cost twice as much (§3). The trade is taken because the second can be added
on any day without replacing anything, where the subnets are what had to be settled before the stack
holds a database:

- **A second gateway is `Site.NatGateways = 2` and a `Data` deploy.** Synthesised, that adds an Elastic
  IP and a gateway in `eu-central-1b`'s `nat` subnet and changes one route, `eu-central-1b`'s task
  subnet's default, to name the new gateway; no subnet changes. CloudFormation updates a route's
  `NatGatewayId` with "No interruption"
  (<https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-route.html>).
- **Each service has one task** until [#101](https://github.com/ChronosSF/myvideogamelist/issues/101), so
  losing the zone a task is in already costs that task a restart in the other. That is when the second
  gateway is worth
  deciding again: once a service runs a task in each zone, one of them would otherwise depend on the
  other zone for its way out.
- **The Multi-AZ database of [#416](https://github.com/ChronosSF/myvideogamelist/issues/416)
  ([0106](0106-productions-database-is-multi-az-and-a-failover-is-a-minute-or-two-of-errors.md)) keeps its
  standby either way.** What this record changes is that, with one gateway, production as a whole
  survives the loss of `eu-central-1b` and not of `eu-central-1a`.

**Not a regional NAT gateway.** AWS has had one since November 2025, and CDK 2.273 makes one
(`NatProvider.RegionalGateway`). It needs no public subnet, and "automatically expands across
Availability Zones based on your workload presence", taking "up to 60 minutes" to reach a new zone,
during which a task's traffic "is processed across zones" by the gateway in a zone it is already in
(<https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html>). It is billed "for each
hour that the NAT Gateway is configured in each availability zone" (<https://aws.amazon.com/vpc/pricing/>),
at the zonal gateway's rate in Frankfurt (§3). Two services with one task each land in whichever zone ECS
picks, so it costs one gateway on the days they share a zone and two on the days they do not, without
saying which in advance. It would also be the newest thing in the stack, chosen for production first. Two
zonal gateways give its resilience at a price known in advance.

**Not a NAT instance.** A `t4g.nano` doing the gateway's job is about $8 a month against its $41.61
(§3). It is a server: its operating system is ours to patch, its replacement is an interruption of the
way out, and it is one machine in one zone, which is the trade above with its own failures added. About
$400 a year does not buy making production's way out the one part of the stack that is a machine we
run.

### 2. No VPC endpoints

**Interface endpoints are billed for each zone they are in, and replace none of the gateway.** PrivateLink
bills "for each hour that your VPC endpoint remains provisioned in each Availability Zone"
(<https://aws.amazon.com/privatelink/pricing/>), at $0.012 an hour in Frankfurt, which is $8.76 a month a
zone, and $0.01 a GB. A Fargate task with no way out needs at least five, for ECR's API and its registry,
CloudWatch Logs, Secrets Manager and Parameter Store, before SES and CloudFront: $87.60 a month in both
zones, $43.80 in one. IGDB, Steam and Cloudflare would still need the gateway. What they would save is
the gateway's $0.052 a GB of AWS traffic for their own $0.01, which pays for five of them past about two
terabytes a month. This is 0015's verdict again, at Frankfurt's prices.

**The S3 gateway endpoint is free and not added.** "There is no additional charge for using gateway
endpoints" (<https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html>), and it would
carry an image's layers past the gateway's per-GB charge, since ECR keeps them in S3. What that saves is
$0.052 a GB of images pulled: at a release a day of half a gigabyte of layers, an assumption, not a
measurement, about 80 cents a month. It is one more resource in a stack that is deployed by hand, for
less than a dollar, and it can be added beside what is there on any day.

### 3. What each option costs

From AWS's Price List files for `eu-central-1`, as published on 2026-11-19 (`AmazonVPC`,
`AWSDataTransfer`) and 2026-11-21 (`AmazonEC2`), each price effective from 2026-11-01, at 730 hours a
month (<https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json> and
its siblings): a NAT gateway, zonal or regional, $0.052 an hour and $0.052 a GB processed; a public IPv4
address, $0.005 an hour; an interface endpoint, $0.012 an hour and $0.01 a GB; a `t4g.nano`, $0.0048 an
hour; gp3, $0.0952 a GB-month; data between zones, $0.010 a GB each way.

The tasks' own public addresses are what each option removes: two, one for each service, $7.30 a month
while the application stack is up.

| Option | Fixed, a month | Net of the tasks' addresses | And per GB |
|---|---|---|---|
| No NAT gateway: public tasks, as dev has and 0015 chose | $0 | $0 | nothing |
| **One zonal NAT gateway and its address (chosen)** | **$41.61** | **+$34.31** | $0.052 processed; $0.010 each way more for a task in the other zone |
| Two zonal NAT gateways | $83.22 | +$75.92 | $0.052 processed |
| A regional NAT gateway | $37.96 for each zone it is in, and its addresses | about +$34 to +$76 | $0.052 processed |
| A `t4g.nano` NAT instance, its address and a small volume | about $7.91 | about +$0.61 | nothing processed |
| Five interface endpoints in both zones, beside the gateway | $87.60 more | +$87.60 more | $0.010 processed |
| The S3 gateway endpoint | $0 | $0 | nothing |

What the gateway processes is not counted, because nothing has measured it: IGDB's and Steam's answers,
the log lines, and an image for every task started. At 10 GB a month it is 52 cents. What the tasks send
out to the internet is charged as it is today.

So production always on is about $114 a month where dev is about $80 (0044's $74 and
[0098](0098-one-rate-rule-at-the-edge.md)'s web ACL), before 0106's standby.

### 4. The migration task asks the Data stack whether it takes an address

The pipeline and `dev-env.mjs resume` start the migration task themselves, outside the stacks, with the
subnets and the security group they read from `Data`'s outputs, and both said `assignPublicIp=ENABLED`
outright. In production's private subnets that asks for an address the task has no route to use, at
$0.005 an hour; in dev's public ones a task without it could not pull its image. So `Data` says which,
as `TaskAssignPublicIp`, beside `TaskSubnetIds`, and both launchers pass on what it says: the subnets
and the address come from one deploy of one stack.

**It is an output only where the tasks are private.** Dev's live `Data` stack was deployed before it
existed, and the launchers have to work with it as it is, since `Data` is deployed by hand and never by
the pipeline; and dev's template is not to change. So an absent output means what every `Data` stack
before this one means, a public address, and any value but `ENABLED` or `DISABLED` stops the run.

Not a check of the environment's name in the workflow: a `Site` change deployed in code before `Data`
is deployed by hand would then start the task in subnets the change has not yet made.

### 5. Nothing else depends on a task's public address

- **The trust list is unchanged.** `ForwardedHeaders__KnownNetworks` is the two `alb` subnets,
  10.0.0.0/27 and 10.0.0.32/27, in production as in dev, and the gateway is in neither. `ForwardLimit`
  stays 1, and the balancer still preserves `X-Forwarded-For` (0044).
- **The balancer is still the one door.** Internet-facing, in the `alb` subnets, whose route is the
  internet gateway, and its group admits CloudFront's origin-facing prefix list on 443 and nothing else.
- **Nobody is told the tasks' address.** IGDB and Twitch take a client id and secret, Steam's news is
  public, Cloudflare takes the secret and the viewer's address, which is the forwarded one, and the AWS
  APIs take the task role's credentials. Production's way out is one Elastic IP where dev's is a new
  address with every task.
- **The deploy role needs nothing new.** `ecs:RunTask` is the same action with another network
  configuration.

### 6. CI holds it

`scripts/check-network.mjs <env> <public|private>` reads a synthesis and says whether the tasks are
where CI says each environment means them to be: both services' address and subnets, each task subnet's
default route and whether it hands out addresses, what `Data` tells the migration task, where each NAT
gateway is, and that the balancer is internet-facing with its group admitting CloudFront's prefix list,
as `cdk.context.json` caches it, on 443 and nothing else. CI runs it after each synthesis, dev `public`
and production `private`. Against master's production synthesis before this change it fails on five
lines, the five things this changes. `scripts/site.mjs` restates the count as `natGateways`, which
`check-site.mjs` holds to the synthesis, for `dev-env.mjs status` to add the gateway to the cost it
reports for production.

## Consequences

- **The gateway bills from `Data`'s first deploy**, about $41.61 a month whether or not the application
  stack is up. Production is never parked, so that is the same thing.
- **The owner's steps in `infra/README.md` do not change, and they are the proof.** The first
  `dev-env.mjs resume --env prod` runs the migration task in the private subnets, which pulls its image,
  reads its secret and writes its log through the gateway, before the holding page is touched; a way
  out that does not work fails there. `App`'s deploy, the smoke test's `/healthz` and `/readyz`, whose
  answer says whether IGDB was reached, and `dev-check.mjs --env prod` follow. What only a use of the
  rehearsal shows: a sign-up, which asks Cloudflare and sends through SES, a game page's Steam news, and
  a profile's withdrawal, which invalidates through CloudFront's API.
- **Dev is the one place 0015's trade holds**, and CI says it still holds there: a change to dev's
  network would be a change under its live database.
- **A second gateway, when #101 gives each service a task in each zone or when the loss of
  `eu-central-1a` should not take the site down**, is one number and a `Data` deploy (§1), about $41.61
  a month more.
- **Not here:** what the database's standby costs and buys (0106), and an internal balancer behind a
  CloudFront VPC origin, which #109 holds and which would leave the balancer no public address either.
