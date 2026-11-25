# 0110. The edge is watched from us-east-1, through a topic of its own

**Status:** Implemented; proved only by deploys, which wait for the owner (`infra/README.md`, "Alarms").
[#434](https://github.com/ChronosSF/myvideogamelist/issues/434), part of
[#406](https://github.com/ChronosSF/myvideogamelist/issues/406). Fills the gap
[0080](0080-an-alarm-watches-what-a-reader-sees-and-mails-an-address-nobody-commits.md)'s consequences
named: "What no alarm sees. The edge".

## Context

0080's alarms watch the balancer, its targets, the database and the API's log. Some requests never reach
the balancer, because CloudFront answers them itself:

- **The viewer-request function**, on every behaviour where it has a job ([0101](0101-devs-basic-auth-comes-off-for-the-trial.md),
  [0103](0103-production-is-the-same-stacks-behind-an-approval.md) §3). It throws when the basic-auth key is
  missing from its store, and then every request is an error, before the cache and the balancer. AWS's guide
  on a 503 from CloudFront says it "can indicate that your function returned an execution error"
  (*HTTP 503 status code (Service Unavailable)*).
- **A balancer CloudFront cannot reach**, whose failures no balancer metric counts.

Five facts shape where an alarm on either can live. Each was read on 2026-11-23.

- **CloudFront's metrics are in `us-east-1`, and an alarm watches only its own Region's.** CloudFront's
  guide (*Monitor CloudFront metrics with Amazon CloudWatch*) says that to read them through the API "you
  must use the US East (N. Virginia) Region (`us-east-1`)". CloudWatch's guide on cross-Region work says
  "you cannot create an alarm in one Region that watches a metric in a different Region". The functions'
  metrics are published there too, "per function or per function per distribution".
- **They cost nothing.** "The following default metrics are included for all CloudFront distributions, at no
  additional cost": among them `Requests` (statistic `Sum`) and `5xxErrorRate` (`Average`, `Percent`). The
  functions' metrics, `FunctionExecutionErrors` among them (`Sum`), have no additional cost either.
- **The distribution's metrics are named by its id**, the `DistributionId` dimension, beside `Region` =
  `Global`. A resume makes a new distribution with a new id ([0044](0044-what-the-deployment-walkthrough-settled.md));
  the pipeline's `App` deploy updates the one that stands. A function's are named by the function's name,
  `mvgl-<env>-viewer-request`, which never changes.
- **No AWS page read says whether an alarm may notify a topic in another Region.** `PutMetricAlarm` gives the
  action as `arn:aws:sns:region:account-id:sns-topic-name`, and neither it nor the alarm-actions pages say
  anything about that Region either way. 0103 §8 holds that it must be the alarm's own; this record relies
  on neither answer.
- **The rate is weighted by request.** Measured on dev's distribution: at one minute, `5xxErrorRate`'s and
  `4xxErrorRate`'s sample count is the `Requests` sum, and their sum is a hundred times the number of
  answers in the class (1,000 for ten 4xx of 46 requests, an average of 21.7%). Over four hours of
  five-minute windows, the average times the requests over a hundred came out exactly that count in all 48.
  In one of them, a count of exactly five came out a hair under five inside the expression, and `>= 5` read
  it as false.

## Decision

### 1. A second Alerts stack, in `us-east-1`

`Mvgl-<env>-EdgeAlerts` is the `AlertsStack` class again, in `us-east-1`. It holds a topic with the same name
as the first, `mvgl-<env>-alerts`, in its own Region, displayed as "MVGL <env> edge", and one email
subscription. Its policy admits CloudWatch alarms named `mvgl-<env>-*` in that Region and account, and
nothing else: no rule and no SES send publishes there. Like the first, it is long-lived, deployed by hand by
name, never by the pipeline, and not termination-protected.

So an alarm finds its topic as 0080's do, by name, in its own Region: `AlertsStack.TopicByName` needed no
change. The topic is put beside the alarms, which needs nothing about cross-Region actions to be true.

**The address is the same parameter, set in `us-east-1` too.** `/mvgl/<env>/alarm-email`, read by the stack
as a CloudFormation parameter of the SSM type, exactly as 0080 §2 reads it. CloudFormation's pages read did
not state which Region such a parameter is read from. CDK's says of the parameters it shares that they
"must be located in the same AWS region as the AWS CDK stack". So the owner writes it in `us-east-1` with
`--region us-east-1`, and it is never in the repository. A second subscription means a second confirmation.

- **Not EventBridge carrying the alarms' state changes to the first topic.** That is a rule on each side and a
  role between them, and the email would be the event's JSON rather than the alarm's own message, all to save
  one parameter and one click.
- **Not a custom resource reading the parameter across Regions.** That is a function of our own, run at
  deploy time, to save one command.

### 2. The alarms are a disposable stack of their own, in `us-east-1`

`Mvgl-<env>-EdgeAlarms` holds the edge's alarms. It reads the distribution's id from `App` as a weak
cross-region reference, the same kind `App` already uses to read the web ACL's ARN from `us-east-1`
([0098](0098-one-rate-rule-at-the-edge.md)), the other way round. CloudFormation documents
`Fn::GetStackOutput` as supporting "cross-account and cross-region references". `App` gains the one output
that reference reads, and nothing else changes in it.

- **`dev-env.mjs resume` deploys it after `App`**, before anything after that can stop the run. **`park`
  destroys it first**, by name. `cdk destroy` of `App` alone would take it as well, since the CLI destroys a
  stack's dependents with it unless told `--exclusively`, but one left behind by a park that stopped halfway
  would not be.
- **The pipeline never deploys it.** The pipeline's `App` deploy keeps the distribution, and with it the id.
  If a change ever made `App` replace its distribution, the alarm would watch one that is gone.
  `dev-check.mjs` reports exactly that: the alarm's `DistributionId` against `App`'s output.
- **Not in `App`**, which is in the environment's Region.
- **Not a Metrics Insights alarm over every distribution in the account**, which would need no id. Until
  launch, production's account holds the holding page's distribution as well. CloudWatch's free allowance
  is "only applicable to Standard resolution alarms that list metrics directly and don't use a Metrics
  Insights query" (its pricing page).

### 3. Two alarms

| Alarm | Measures | Window | Fires when |
|---|---|---|---|
| `edge-5xx-rate` | the distribution's `5xxErrorRate`, `Average`, with `Requests`, `Sum` | 5 min | at least 5% and at least five 5xx, in 2 of the last 3 windows |
| `edge-function-errors` | the viewer-request function's `FunctionExecutionErrors`, `Sum` | 5 min | one or more in any window |

- **The 5xx rate has 0080's shape**: 5%, and a floor of five errors under it, in two windows of three. The
  count is the rate times the requests over a hundred, which the weighting above makes exact. It is written
  as `>= 4.5`, because of the five that came out under five. Whoever answered the 5xx counts: the origin,
  whose own alarm says so first, or the edge for an origin it could not reach or a function that failed.
- **A function error is never a blip.** The function is ours, small, and the same on every request it sees,
  so one error is a fault, and every one is a reader answered with an error instead of the page.
- **Execution errors only.** A validation error, which AWS's 502 page puts down to a function changing a
  read-only header, and a throttle both reach the reader as 5xx, and so reach the first alarm. Each metric an
  alarm reads costs $0.10 a month.
- **The function's alarm exists only where the function runs**: behind the door, or where a name only
  redirects (`Site.ViewerRequestRuns`, which `Edge` now reads too). That means production, and dev once its
  door is back. While dev is open and answers by one name, no behaviour names the function and nothing would
  ever be counted, so no alarm is made.
- **Everything else is 0080's**: OK and ALARM both emailed, missing data not breaching, and a description
  that says where to look. Both are made by `Alarms.Add`, which 0080's alarms now go through too, with
  their templates unchanged.

### 4. What can be shown before a deploy, and what cannot

- **The expression, shown on live data before any deploy.** Run through `GetMetricData` against dev's
  distribution, it gives 0 for every window of the last four hours, which had no 5xx. With `4xxErrorRate` in
  its place it gives the rate wherever there were five or more, and 0 below.
- **`FunctionExecutionErrors` has never been seen for any function of ours**: dev's `list-metrics` shows
  the old function's invocations and none of its errors. Its name, dimensions and statistic come from
  CloudFront's guide alone, and the first error is the first sighting.
- **After the deploys**, `dev-check.mjs` holds the 5xx alarm to `App`'s distribution and to the topic. It
  holds the function's alarm to the function's name, or to not existing where the function does not run, and
  each Alerts topic to a confirmed subscription. `aws cloudwatch set-alarm-state` sends each alarm's email
  (`infra/README.md`).

## Consequences

- **The owner's steps, once per environment, in this order:**
  1. the parameter in `us-east-1`;
  2. `cdk deploy Mvgl-<env>-EdgeAlerts`, and the confirmation;
  3. an `App` deploy, which carries the new output (a run of the pipeline, or a resume);
  4. `cdk deploy Mvgl-<env>-EdgeAlarms --exclusively`.

  After that, a resume brings the alarms by itself. For production, steps 1 and 2 go before the first
  `resume --env prod`, which does steps 3 and 4.
- **What it costs, from AWS's price list for `us-east-1` (2026-11-19):**
  - $0.10 per alarm metric a month.
  - Dev's alarm reads two metrics: $0.20 a month while `App` stands, and nothing parked.
  - Production's two alarms read three: $0.30 a month.
  - The topic has no fee. SNS's first 1,000 email notifications and its first million requests a month are
    free.
  - CloudWatch's free allowance is ten alarm metrics an account across every Region, always free. Its pricing
    page does not say whether metric-math alarms count toward it, and dev's ten from 0080 may already fill
    it, so these figures are before any allowance.
  - Worth the cents because it is the only alarm that sees a reader turned away before the balancer: the door
    failing closed for everybody is otherwise silent until somebody says so.
- **Found while building this: dev's first Alerts stack was never deployed.** Read on 2026-11-23, `mvgl-dev`
  has no `Mvgl-dev-Alerts` stack, no topic in `eu-central-1` and no `/mvgl/dev/alarm-email` parameter. 0080's
  five alarms and its rule stand, and send to a topic that does not exist, so they tell nobody. 0080's
  "Alerts goes first, once" is still owed. `dev-check.mjs` now fails until it is done.
- **Not here:** an alarm on the rate rule. AWS WAF reports a CloudFront web ACL's metrics in `us-east-1`
  too, so it would send to this topic, and would cost what each of these does.
