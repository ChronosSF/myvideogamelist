# 0080. An alarm watches what a reader sees, and mails an address the repository never holds

**Status:** Implemented; proved only by a deploy, which waits for the owner (`infra/README.md`, "Alarms").
The alarms that [0044](0044-what-the-deployment-walkthrough-settled.md) left on
[#109](https://github.com/ChronosSF/myvideogamelist/issues/109) and
[0059](0059-a-request-is-known-by-its-trace-and-a-build-by-its-commit.md) left on
[#103](https://github.com/ChronosSF/myvideogamelist/issues/103), now
[#406](https://github.com/ChronosSF/myvideogamelist/issues/406)'s first item. Each of the two now points here.

## Context

#406 asks for alarms on the 5xx rate, p99 latency, task restarts, the database's connections and
IGDB's failure rate, emailed to the owner. Before this change nothing said that the site was down. The
first public release, v1, waits on it.

Five things about the environment shape the answer.

- **The application stack is destroyed on every park and made again on every resume** (0044), with a
  new balancer whose name is in every one of its metrics, and new log groups. The Data stack is
  long-lived and deployed by hand, by name; the pipeline deploys `Migrate` and `App` only, and always
  `--exclusively`. Cross-stack references are weak, so a new reference from `App` into `Data` adds an
  output to `Data` that exists only once somebody deploys `Data` again.
- **The site is small.** A five-minute window holds tens of requests, not thousands. A rate over three
  requests is noise, and the 99th percentile of twenty requests is the slowest of them.
- **The repository is public**, so the address the alarms go to cannot be in it.
- **The request line sees half the site.** #406 offers the API's request line, its `StatusCode` and
  `ElapsedMilliseconds`, as a source for metric filters. The SSR server writes no such line, and a 5xx
  the balancer answers itself, with no target to send to or none that answered, reaches neither
  process.
- **The IGDB client's own lines cannot be counted.** Measured on .NET 10 with
  `Microsoft.Extensions.Http.Resilience` 10.11.0 and the API's own pipeline, against a local server:
  the client factory's logical handler writes an end line for a call that came back with a response,
  of any status, and a failure line for one that threw `HttpRequestException`, and **nothing at all**
  for a call that ended in `TimeoutRejectedException` or `BrokenCircuitException`, or that its caller
  cancelled. The first two are most of what an outage looks like from here. Polly's "Execution attempt" lines are one per attempt, and their
  `Handled` says whether the retry strategy handled the result, not whether the call failed: a 400 or a
  401 is not handled, and a 401 is what a rotated credential earns.

## Decision

### 1. The alarms live with what they watch, and the topic lives apart

**A new stack, `Mvgl-<env>-Alerts`, holds the topic `mvgl-<env>-alerts` and the owner's email
subscription to it.** Long-lived, because an email subscription is confirmed by a person clicking a
link, and a topic in the application stack would be a new subscription to confirm after every
resume. Deployed by hand, by name, as `Data` is; the pipeline never touches it. Not
termination-protected: it holds that confirmation and nothing else, and destroying and redeploying it
is how a lost subscription is made again.

**The alarms are a construct, `Alarms`, inside the application stack**, because what they watch is
named by that stack's balancer, target groups and log group. A parked environment has nothing to alarm
about, and has no alarms; a resume makes them again with the balancer, and nothing has to be confirmed.

**They name the topic rather than refer to it**, by an ARN built from `Site.AlertsTopicName`, as
`DataStack`'s deploy role already names the migration task's roles. A reference would make every
`App` deploy, the pipeline's included, read an output of a stack only the owner deploys, and fail until
it exists. The database's metric is named by `Site.DatabaseIdentifier` and the rule's cluster by
`Site.ClusterName`, which `DataStack` now reads too, for the same reason: neither adds an output to
`Data`. The synthesised `Data`, `Migrate`, `Dns` and `EdgeCert` templates are byte for byte what they
were before this change, and `App` gains eight resources and changes none. What naming costs is order:
an `App` deployed before `Alerts` exists alarms into nothing, and CloudWatch records the failed action
in the alarm's history and tells nobody. So `Alerts` goes first, once.

### 2. The address is a Parameter Store value the owner sets

`/mvgl/<env>/alarm-email`, a `String` parameter in the environment's own account, set by hand before
the first deploy of `Alerts`. The stack reads it as a CloudFormation parameter of the type
`AWS::SSM::Parameter::Value<String>`.

- **Not a context value.** A context value has to be given on every deploy of the stack, from a shell
  or a file outside the repository, and a deploy that forgot it would need a guard to stop it
  subscribing nobody. A parameter lives in the account the alarms do, one per environment, and a
  deploy while it is missing fails.
- **It is read on every deploy.** CloudFormation fetches an SSM-typed parameter's value each time the
  stack is created or updated, and the CDK CLI never skips such a stack as unchanged: it assumes a
  parameter from SSM may have changed (`ParameterValues.hasChanges` in aws-cdk-cli). So a new address
  is the parameter written again and the same deploy, and makes a new subscription, confirmed again.
- **Not a `SecureString`.** An address is not a secret, only not the public's, and the subscription's
  endpoint takes it as given.

### 3. Five alarms and a rule, each with a floor

Every alarm that is a rate has a floor of failures under it, and the percentile a floor of requests,
because on a window of tens of requests one bad request is half a percent of nothing.

| Alarm | What it measures | Window | Fires when |
|---|---|---|---|
| `5xx-rate` | the balancer's targets' 5xx and its own, over its requests and its own 5xx | 5 min | at least 5% and at least five, in 2 of the last 3 windows |
| `p99-latency` | the balancer's `TargetResponseTime`, p99 | 5 min | 3 seconds or more with at least twenty requests, in 3 windows running |
| `unhealthy-target` | `UnHealthyHostCount` of both target groups, at its maximum | 1 min | one or more in any minute |
| `db-connections` | RDS's `DatabaseConnections`, at its maximum | 5 min | forty or more, in 3 windows running |
| `igdb-failure-rate` | the API's IGDB calls that failed, over those that succeeded or failed | 5 min | at least 10% and at least three, in 2 of the last 3 windows |
| `task-stopped` (a rule) | ECS stopping a task of either service whose essential container exited, or which never started | each | every time |

- **The 5xx rate is the balancer's**, because it is the reader's view: both processes and the
  balancer's own answers. The balancer counts a request only once it has chosen a target, so one it
  answered itself before that is in its 5xx and not in its requests; the denominator adds the two,
  which counts twice a 502 or 504 it answered for a target and can only make the rate read lower. Its
  5xx are reported only when there are any, so every term is filled with zero. A 502 from the API is a
  third party failing (0034), almost always IGDB, so an IGDB outage with readers on game pages trips
  this and the IGDB alarm both. That is deliberate: one says readers are failing, the other why. Five
  errors in each of two windows is meant to stay above the sporadic 502 from Node closing an idle
  connection before the balancer does (#109).
- **Latency is the balancer's too, and three seconds**, chosen rather than measured: well past what a
  page should take to start answering, IGDB's calls included, and short of the ten seconds an attempt
  at IGDB may take before its timeout. Fifteen minutes past it is something queueing, most likely
  behind IGDB's four-a-second limiter on cache misses. The floor of twenty requests a window is what
  stops one slow cold page paging anybody.
- **A task restart is two signals, because AWS documents one of them.** The rule matches the stop
  codes the ECS API documents, `EssentialContainerExited`, which an out-of-memory kill is too, and
  `TaskFailedToStart`, and sends one email per stop, saying which task definition and why: with one
  task to a service every such stop is an outage of it until the replacement is up, and a crash loop
  is as loud as it ought to be. It selects the tasks by their task definitions' families, which this
  stack names, so the migration task, whose container exits every release, is not one; `detail.group`
  would do the same, but its `service:` form is shown only by example. A process that is up and not
  answering is stopped by the scheduler for failing the balancer's checks, and AWS documents neither
  the code nor the reason that stop carries, so the rule cannot name it. The balancer's
  `UnHealthyHostCount` is documented, and a target it has marked unhealthy is that restart seen from the
  balancer, before ECS acts on it. Any minute is enough, since the state lasts only until the
  task is replaced. A deploy's and a park's stops are the scheduler's too, and should carry neither stop
  code, and a deploy's new target starts "initial" rather than unhealthy; neither is documented, so the
  first deploy after this one is the check.
- **Forty connections.** The API's pool allows a hundred per process (Npgsql's default
  `Maximum Pool Size`, which the connection string does not change), and RDS sets PostgreSQL's
  `max_connections` from the class's memory, `LEAST({DBInstanceClassMemory/9531392}, 5000)`, which on a
  1 GiB class is at most 112 and in practice lower, since `DBInstanceClassMemory` is less than the
  class's memory; `SHOW max_connections` gives the real figure. A quiet site holds a handful, and Npgsql
  closes an idle pooled connection after five minutes, so forty for fifteen minutes is a leak or a load
  the instance was not sized for, seen before the server starts refusing.
- **IGDB's failure rate is counted from a line of the API's own** (§4). Three failures and 10% of the
  calls, in two windows of three: the background refresh alone makes about one call a minute while
  rows are due (0052), five to a window, so an IGDB outage on a site nobody is browsing still fires,
  within ten minutes.

Every alarm sends on **OK as well as ALARM**, so the inbox says when it is over. **Missing data is not
breaching**: no data is no traffic, a stopped database or a quiet log, and none of those is a failure
anybody is suffering. Each alarm's description is what its email says: what crossed what, and where to
look first.

### 4. The API writes one line per IGDB call, outside its retries

`Observability/IgdbCallLog.cs` is a handler on the `Igdb` client, added before the resilience pipeline
so that it is outermost and sees each call as `IgdbService` does: after the retries, the breaker and
both timeouts. Once the call is over it writes
`IGDB {Endpoint} {Outcome} in {ElapsedMilliseconds} ms: {Result}`, at Information whatever the outcome,
because it is a count and the failure is described by Polly's own lines and by the caller.

| Outcome | When | Counted |
|---|---|---|
| `succeeded` | a success status | yes, in the denominator |
| `failed` | an error status, any 4xx included, or no answer: unreachable, timed out, an open circuit, or past a deadline the caller set itself | yes |
| `cancelled` | the caller's own token: a reader who left, or the host stopping a job | no |
| `refused` | our own limiter's queue was full, the 503 of 0034 | no |

**A caller's own deadline is a failure, and the caller says that it is one.** The cache refresh bounds
each IGDB request at fifteen seconds of its own (0052, 0079), by cancelling the token it hands the call, and a
hanging IGDB ends there: each attempt times out at ten seconds, and the retry is cut off by the
refresh. The handler is handed one token and cannot tell that deadline from the host stopping, so a
hanging IGDB was logged as cancelled on every call, and on a quiet site, where the refresh is the only
caller, the alarm counted nothing through the whole outage. So a caller with a deadline of its own makes
its call inside `IgdbCallLog.UnderDeadline`, passing the token it was itself handed: a cancellation while
that token is still live is the deadline, `failed`; one after it is the caller stopping, `cancelled`. The
refresh is the one such caller today. `GameCacheRefreshTests` fails if it calls IGDB outside the mark,
and `IgdbCallLogTests` holds the two cases apart. A reader's request has no deadline of the API's, so
its cancellation is the reader leaving.

Measured with the scratch harness above, each of the seven ways a call ended wrote exactly one line,
with the right outcome. The token request goes through the same client and is counted, since a refused
credential fails every call after it. The path and nothing else of the address, which here has no
query: IGDB's queries travel in the body and the credentials in a form. **The category is stated, not
taken from the type's name**, `MyVideoGameList.Server.Observability.IgdbCalls`, because the metric
filters in `infra/src/Infra/Alarms.cs` match it and the CDK app cannot reference the API's project.
`IgdbCallLogTests` reads that file and fails when the category or either counted outcome is not there,
and `ApiPipelineTests` fails when `Program.cs` puts the line inside the resilience handler, where it
would count attempts, three to every failed call.

### 5. The topic admits this environment's alarms and its rule, and nothing else

A topic policy of our own names everything that publishes: `cloudwatch.amazonaws.com` for alarms named
`mvgl-<env>-*`, and `events.amazonaws.com` for rules named the same way, each conditioned on the
account and on that ARN, so nothing else in the account or outside it can write to the owner's inbox
through here. CloudWatch documents exactly that statement. EventBridge's SNS example carries no
condition, and its confused-deputy page asks for `aws:SourceArn` on its other resource-policy targets,
SQS's queue policy among them. A rule that cannot publish fails its invocations quietly, which is why
the rule has a test stop (§6).

### 6. It is proved on the environment, by hand, once

A stop by hand is `UserInitiated` and matches no stop code, so the rule also matches a stop whose
reason begins `Alarm test`: `aws ecs stop-task --reason "Alarm test"` on either service's task proves the
path from ECS to the inbox, at the cost of that service for the minute its replacement takes. Each alarm
is proved by `aws cloudwatch set-alarm-state`, which sends its email and returns to OK at the next
evaluation, and the IGDB filters by `aws logs filter-log-events` with their own pattern over the API's
log group. `infra/README.md` has the commands.

## Consequences

- **The first deploy has an order:** the parameter, then `Alerts`, then the confirmation, then `App`.
  SNS deletes a subscription nobody confirmed within two days, and CloudFormation does not notice;
  nor does it notice the unsubscribe link in every alarm's email, which asks for no sign-in unless the
  subscription was confirmed to require one. Both are mended by destroying and redeploying `Alerts`,
  which the alarms find again by name.
- **What it costs.** Ten alarm metrics, counting each metric an expression reads, at $0.10 a month and
  two custom metrics from the filters at $0.30 (the `eu-central-1` price list of 2026-10-07), prorated by
  the hour and only while `App` stands: about $1.60 a month always on, before CloudWatch's free
  allowance of ten of each, and less on the working pattern. One more log line per IGDB call.
- **What no alarm sees.** The edge: a CloudFront function that errors, such as basic auth with no key in
  its store, answers every request before the balancer is asked, and CloudFront's metrics are in
  `us-east-1`, where an alarm would need a topic of its own; #406 carries it. A failure on a site nobody
  is using, beyond what the health checks and the IGDB refresh exercise. The database's storage and CPU
  credits. The background jobs' own warnings, the refresh's twenty-five-hour row and the sweep's stalled
  lock (0038, 0052), which stay log lines.
- **Production** is the holding page until #98, and has none of this. Its application stack will carry
  the construct as dev's does, and needs its own `Alerts` stack and parameter in `mvgl-prod`.
- **A threshold is a number to be moved.** These are set before any traffic was seen; the first
  month's graphs, and the first false alarm, are what move them, here and in this record.
