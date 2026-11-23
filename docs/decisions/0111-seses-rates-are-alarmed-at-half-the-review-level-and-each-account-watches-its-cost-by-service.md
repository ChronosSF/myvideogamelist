# 0111. SES's rates are alarmed at half the review level, and each account watches its cost by service

**Status:** Implemented; proved only by deploys, which wait for the owner (`infra/README.md`, "Production's
SES" and "Cost anomalies"). [#466](https://github.com/ChronosSF/myvideogamelist/issues/466), part of
[#406](https://github.com/ChronosSF/myvideogamelist/issues/406). Amends
[0091](0091-a-bounce-or-a-complaint-stops-all-mail-to-that-address.md) §4, "No alarm on the two rates".

## Context

**The rates.** 0091 §4 left them unalarmed for three reasons, and two no longer hold:

- *"The metrics do not exist yet."* They do. `mvgl-prod` has sent dev's mail since November, and its
  `AWS/SES` listing, read by the owner on 2026-11-23, holds `Reputation.BounceRate` and
  `Reputation.ComplaintRate` twice each: once with no dimension, for the account, and once under
  `ses:configuration-set` = `mvgl-email`.
- *"Each bounce and complaint is already in the owner's inbox."* True, and at one a week it is earlier
  warning than any rate. But it says nothing about the rate, and the sign-up form mails whatever address
  is typed into it. A run of bad addresses is a run of emails that look like each other.
- *"AWS writes to the account's address when it starts a review."* True, and a review is what this is
  meant to come before.

The listing also shows that 0091 §2 was wrong to say the set "has no reputation metrics of its own". CDK's
`ConfigurationSet` documents `reputationMetrics` as true by default. The synthesised template names no
reputation option, and the set's metrics are there.

What AWS says, read on 2026-11-23:

- **The levels.** "If your bounce rate is 5% or greater, we automatically place your account under review.
  If your bounce rate is 10% or greater, we might pause your account's ability to send additional email."
  Complaints are reviewed at 0.1% and may be paused at 0.5% (*Reputation dashboard messages*).
- **The scale.** SES's guide on these alarms gives the thresholds as "0.05 (5%)" and "0.001 (0.1%)". The
  metric is a fraction.
- **The window.** "We don't calculate your bounce rate based on a fixed period of time... Instead, we look
  at a *representative volume*" (the enforcement FAQ). AWS's announcement of the dashboard says the rates
  are worked out again every time the account sends.
- **Missing data.** The same guide's alarm steps choose "Treat missing data as ignore (maintain the alarm
  state)". It names no statistic and no period.
- **Tests do not count.** Mail to the mailbox simulator does not count toward "your bounce and complaint
  rates".

**The cost.** The budget alerts say the total is high, not where it comes from. AWS Cost Anomaly Detection
"is available at no additional charge". An account may hold one "AWS managed monitor for AWS services", and
up to ten email recipients per subscription (*Quotas and restrictions*). An email subscriber gets a daily
or weekly summary, while an alert per anomaly needs an SNS topic. Detection "runs approximately three times
a day" on Cost Explorer's data, "which has a delay of up to 24 hours". Since December 2023 its two resource
types can be made by a CloudFormation stack in any Region but GovCloud. AWS has made such a monitor by
itself, with a daily email, for a standalone account that turned on Cost Explorer on or after 27 March
2023. Neither account had a monitor on 2026-11-23: dev's was read then, and the owner read production's
and found its listing empty.

## Decision

### 1. Two alarms on the account's rates, at half the review level, in production's Email stack

| Alarm | Metric | Threshold | Window |
|---|---|---|---|
| `mvgl-prod-ses-bounce-rate` | `AWS/SES` `Reputation.BounceRate`, no dimension, `Maximum` | ≥ 0.025 (2.5%) | 1 hour, 1 of 1 |
| `mvgl-prod-ses-complaint-rate` | `AWS/SES` `Reputation.ComplaintRate`, no dimension, `Maximum` | ≥ 0.0005 (0.05%) | 1 hour, 1 of 1 |

- **The account's rates, not the set's**, because the account's are what AWS reviews, and they count every
  send from `mvgl-prod`, dev's included.
- **Half the line**, as #466 asked. That is far enough under the review to act on, and above the noise of a
  few typos only once the representative volume is more than a few dozen emails. The first months' figures
  will move it.
- **Missing data keeps the state**, as AWS's guide has it. A rate that is published only around sends says
  nothing new in an hour without one. An alarm in ALARM stays there until a send shows the rate back under
  the line, and its OK says so when that happens. That differs from 0080's alarms, whose missing data is "no
  traffic, no failure".
- **In `Mvgl-prod-Email`**, as 0091 §4 said one would be. That is the stack about sending, in the Region and
  account the metrics are in. They send to `mvgl-prod-alerts`, whose policy already admits alarms named
  `mvgl-prod-*`. The thresholds are written beside the review levels they halve,
  `EmailStack.BounceRateReviewed` and `ComplaintRateReviewed`.

### 2. A Costs stack in each account: one monitor per service, a daily email

`Mvgl-<env>-Costs` sits in the Region of the environment's Alerts stack, and reads the same
`/mvgl/<env>/alarm-email` parameter. It holds:

- **`mvgl-<env>-services`**: `DIMENSIONAL`, `SERVICE`, which watches each AWS service apart;
- **`mvgl-<env>-services-daily`**: an email subscription to it, `DAILY`, for anomalies whose total impact is
  $5 or more (`ANOMALY_TOTAL_IMPACT_ABSOLUTE`, `CostsStack.ImpactDollars`).

The figure: an awake dev is about $80 a month, under $3 a day, so $5 is a day or two of something nobody
meant to be running.

- **A stack of its own, not a part of Alerts.** The mend for a lost email subscription is to destroy
  `Alerts` and deploy it again (0080), and that should not take the monitor with it.
- **Email, not the topic.** An anomaly a day late is no worse than one twelve hours late, given the data's
  own delay. AWS's pages, read for this, state no Region requirement for a topic that subscribes, either way,
  so the topic would be one more thing to prove for no gain.
- **One per account, so an existing one is deleted first.** Neither account has one today. If AWS makes a
  default monitor before this stack is deployed, the owner deletes it, and its subscription, in the console
  first. With a quota of one, the deploy should otherwise fail at the monitor and roll back.

## Consequences

- **The owner's steps:**
  - **Production:** `cdk deploy Mvgl-prod-Email` for the alarms, any time, since `Alerts` stands. Then
    `cdk deploy Mvgl-prod-Costs`: production had no monitor on 2026-11-23, so nothing is deleted first.
  - **Dev:** `Mvgl-dev-Costs` once its alarm parameter exists. Read on 2026-11-23, it did not, since dev's
    Alerts stack has not been deployed (#434's pull request found it).
- **What it costs**, from AWS's price list for `eu-central-1` (2026-11-19):
  - $0.10 per alarm metric a month, so $0.20 a month for the two alarms in the production account. Each
    lists its one metric directly, which is what CloudWatch's free ten alarm metrics an account apply to, so
    they may cost nothing while production's account has fewer than ten.
  - Cost Anomaly Detection costs nothing.
  - SNS: the first 1,000 email notifications a month are free.
  - The cents are worth it because the account is the one every email depends on, both environments'. AWS
    reviewing it is the first step towards pausing it, and nothing else would say the rate is climbing.
- **What only a deploy shows.** `aws cloudwatch set-alarm-state` sends each alarm's email. Because missing
  data keeps the state, a test left in ALARM stays there until the next send, and is set back by hand.
  Nothing can make an anomaly to order. The console's Cost monitors page shows the monitor and its
  subscription, and the first anomaly over $5 is the first proof of the email.
- **Cost Explorer's API may charge $0.01 a request**, and AWS does not say whether its anomaly calls are
  among them. So the README sends the owner to the console, not the CLI, to look at the monitor. Two such
  read calls were made on dev's account while this was written.
- **Not here:** an alarm on the configuration set's own rates, which are a subset of the account's today.
  Also a subscriber in the application (0091 §3).
