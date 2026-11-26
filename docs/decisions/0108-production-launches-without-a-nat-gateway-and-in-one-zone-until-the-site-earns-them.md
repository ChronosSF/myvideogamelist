# 0108. Production launches without a NAT gateway and in one zone, until the site earns them

**Status:** Accepted, 2026-11-23, the owner's decision. Nothing is built by it: the stacks are as master
had them. Leaves in place, past launch, the two trades
[0015](0015-fargate-confirmed-and-nat-less-networking.md) took only until it.

## Context

0015 kept the dev environment cheap with two trades and said when each was to be looked at again: tasks
in public subnets with no NAT gateway, "revisit this before launch, not after", and a database in one
availability zone, to be revisited "before the service is one anyone depends on". #98 put both before
production's launch, as [#415](https://github.com/ChronosSF/myvideogamelist/issues/415) and
[#416](https://github.com/ChronosSF/myvideogamelist/issues/416).

**Both were built on 2026-11-23**, for production alone, as pull requests
[#504](https://github.com/ChronosSF/myvideogamelist/pull/504) and
[#503](https://github.com/ChronosSF/myvideogamelist/pull/503). Each synthesised, left dev's templates as
they were, and passed CI. Each wrote its own record on its branch, numbered 0105 and 0106, which is why
those two numbers are not in the index.

**What they cost**, by those pull requests' reading of AWS's price list for Frankfurt: $41.61 a month for
one NAT gateway and its address, $34.31 net of the two public addresses the tasks would give up, and
$15.88 for the standby. An environment that is awake is about $80 a month (`dev-env.mjs`), so production
would have been about $130.

The owner asked what each buys a small site that nobody depends on yet, and decided.

## Decision

### 1. No NAT gateway at launch

**A task's public address answers nobody today.** `DataStack`'s security groups admit, and nothing else:

| Group | Admits |
|---|---|
| The balancer's | CloudFront's prefix list, on 443 |
| The API's | the balancer's and the SSR server's, on 8080 |
| The SSR server's | the balancer's, on 3000 |
| The database's | the API's, on 5432 |

**What the gateway would add** is tasks with no public address at all, so that a rule opened by mistake
exposes nothing, and one fixed address for what the tasks send out. Neither closes a door that is open.

**What somebody using the API hard can do is the same with it or without**, since every request comes
through CloudFront and the balancer either way:

- use up the four requests a second the API may send IGDB, which slows or fails pages for everybody else;
- run up the edge's charges, which are by the request. The web ACL holds one address to 300 requests in
  five minutes ([0098](0098-one-rate-rule-at-the-edge.md)).

Compute does not grow under load: each service is one task of a fixed size, and nothing scales it.

### 2. One zone at launch

**What protects the data is the backups**: fourteen days of them for production, and one restored in
rehearsal ([0107](0107-production-keeps-fourteen-days-of-backups-and-a-restore-has-been-rehearsed.md)).

**What a standby would add** is that a failure of the instance, its storage or its zone is put right by
RDS itself, which the shelved record puts at a minute or two of errors, where without one it is 0107's
restore run by hand, and the writes since the last restorable moment are lost. That moment was about
five minutes behind the clock each time it was read on dev.

**How often**: AWS states gp3's "99.8 percent to 99.9 percent volume durability with an annual failure
rate (AFR) no higher than 0.2 percent"
([general purpose volumes](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html)). What a
single instance does by itself when its host fails was not found stated on the pages read, so it is not
counted on.

### 3. Both wait for the site to earn them

The owner's rule, and the gate both issues now wait behind: the site takes on a monthly cost once it
makes some money, and not before.

- **#415 and #416 stay open**, under a label of their own, `long-term hardening`, and off the V1 board.
- **The standby first** when the time comes. It is the cheaper, and it is the one that takes a person out
  of an outage.
- **How each comes back**: its pull request is reopened and master merged into its branch,
  `claude/prod-private-subnets-67ddbc` or `claude/prod-multi-az-1dbd90`. Its record comes with it, under
  the number it has.
- **Neither needs the VPC or the database made again, as far as a synthesis shows.** #504's templates
  kept every subnet under its own name, changed two properties of the tasks' two, the public-address
  setting and the default route, and added the gateway beside them. AWS's guide says of the standby:
  "You can use the console to convert existing DB
  instances to Multi-AZ DB instance deployments by modifying the DB instance and specifying the Multi-AZ
  option" ([Multi-AZ DB instance deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)).
  Neither has been done to a live stack of ours, and the guide does not say on that page whether the
  conversion interrupts the database.

## Consequences

- **Production's first `Data` deploy is dev's shape**, and costs about what dev does.
- **A failure of the database's hardware or its zone is an outage until somebody restores it.** That
  makes the step 0107 left untried, putting a restored copy in service, worth trying on production before
  the door opens (#440).
- **0105 and 0106 are not on master.** They are the two shelved records, on their branches.
- **The email on a failover, a line on #406, waits with #416**: with no standby there is no failover to
  report.
- **0103 §2's list is unchanged by this**: what differs for production stays what `Site` says, and the
  sizes stay dev's.
