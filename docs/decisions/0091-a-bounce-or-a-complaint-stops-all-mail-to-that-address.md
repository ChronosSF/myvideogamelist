# 0091. A bounce or a complaint stops all mail to that address, in SES, and each one reaches the owner

**Status:** Implemented. Proved only by a deploy of two production stacks, which waits for the owner
(`infra/README.md`, "Production's SES, for dev's email").
[#419](https://github.com/ChronosSF/myvideogamelist/issues/419), part of
[#100](https://github.com/ChronosSF/myvideogamelist/issues/100) and
[#112](https://github.com/ChronosSF/myvideogamelist/issues/112). §5's support address also follows the
password reset's request ([0090](0090-a-password-reset-works-once-for-an-hour-and-ends-every-session.md) §7).

## Context

- **The request for SES production access made a promise**
  ([#418](https://github.com/ChronosSF/myvideogamelist/issues/418)). Its use-case text, which
  `aws sesv2 get-account` still shows, says three things: the account-level suppression list is on for bounces
  and complaints; the application will receive bounce and complaint events "through a configuration set and
  Amazon SNS"; and it will stop sending to any address that bounces or complains. AWS granted access on that
  text, and #112 holds the site to it.
- **The account already did the first part.** Read on 2026-11-10, `mvgl-prod`'s `SuppressionAttributes` name
  `BOUNCE` and `COMPLAINT`. The SES developer guide (*Using the account-level suppression list*) says this is
  the default, for both reasons, for any account that started using SES after 25 November 2019. There was no
  configuration set and no SNS topic.
- **CloudFormation cannot hold that setting.** Its SES resource types include a configuration set and its
  event destinations, but nothing for the account's suppression attributes. A person changes them, with the
  CLI or the console, and no template shows the change.
- **SES accepts a send to a suppressed address and drops it.** The same guide says SES "accepts the message,
  but doesn't send it". `SendEmail` answers with a message id, as it would for any send, so the API cannot
  tell. Such a send counts towards the daily quota, but not towards `Reputation.BounceRate` or
  `Reputation.ComplaintRate`. Only hard bounces join the list, and an address stays on it until somebody
  removes it. The event SES publishes for a dropped send is a `Permanent` bounce with the subtype
  `OnAccountSuppressionList`.
- **Every send is production's.** Dev sends as a role in `mvgl-prod`
  ([0088](0088-email-goes-through-productions-ses-and-a-deployment-with-no-sender-does-not-start.md)). So one
  list, in one account, covers both environments, and the bounces and complaints of both count against one
  reputation.
- **What SES does about a bad rate** (*Reputation dashboard messages*): it reviews the account at a 5% bounce
  rate or a 0.1% complaint rate, and may pause sending at 10% or 0.5%. The enforcement FAQ says AWS always
  tells the account's own email address when it starts a review.
- **A public sign-up form sends to whatever address is typed into it.** Bounces and complaints here come from
  typos, from bots, and from somebody typing another person's address. Registration is limited per network
  address ([0089](0089-an-account-signs-in-once-its-address-is-confirmed.md) §5). The first email to any
  address is its confirmation, so a mistyped address bounces once and is then suppressed.
- **`SendEmail` is authorized against a configuration set as well as an identity.** The Service Authorization
  Reference lists `configuration-set` beside `identity` among SES v2's resource types for `SendEmail`, with the
  same condition keys on each, `ses:FromAddress` among them.
- **Events had nowhere to go.** The identity's email feedback forwarding is on, so SES emails each bounce and
  complaint to the address the message came from, `noreply@`. That address is named for not being read.

## Decision

### 1. SES stops the mail, not the application

The promise is kept where no flow can skip it: SES's suppression list. Every send from the production account
meets it, whichever environment and whichever flow sent it. The API keeps no list of its own and checks
nothing before sending.

- **Not a list of the application's own.** It would protect only the flows that remembered to check it. And it
  would hold nothing SES does not hold already, until production's events were carried into each
  environment's database, dev's included, across two accounts.
- **Not `GetSuppressedDestination` before each send.** It would only predict what SES is about to do anyway,
  at the cost of a call and a permission on every send. And the only place that could act on its answer is
  the sign-up dialog: the resend gives the same answer whatever happened (0089 §5), and the reset (#422) will
  too.

### 2. Every send names one configuration set, which states the suppression again

The configuration set is `mvgl-email`, made by `Mvgl-prod-Email`. Its name is `EmailIdentity.ConfigurationSet`,
a constant the CDK app compiles, as it already compiles `FromAddress`, and `SesEmailTransport` names it on
every `SendEmail`. The set's suppression options name both reasons. That is what the account already does,
but now a template says it, so a change to it is a diff that somebody reviews.

- **Named on each send, not made the identity's default set.** The identity was made by hand and is in no
  template, so a default set on it would be one more setting nobody reviews.
- **The roles that send name it beside the identity**: `mvgl-dev-email` in `Mvgl-prod-Email`, and
  production's own task role in the App stack. Both are given the one statement, `EmailStack.SendFromNoReply`,
  which keeps the condition on the From address.
- **Nothing else is set on it.** It has no reputation metrics of its own, no tracking (a tracking domain would
  have to be SES's HTTPS kind, #100), and no dedicated IPs.

### 3. Each bounce and complaint goes to the owner through the Alerts topic

The set has one event destination. It publishes bounces and complaints to SNS, to the topic
`mvgl-prod-alerts`, found by its name as [0080](0080-an-alarm-watches-what-a-reader-sees-and-mails-an-address-nobody-commits.md)'s
alarms find theirs. So the owner reads each event where the alarms arrive. Each message is SES's JSON. It
names the address and the kind of bounce or complaint, and its `ses:caller-identity` tag names "the IAM
identity of the SES user who sent the email", which is how dev's sends and production's are told apart.

- **`Mvgl-prod-Alerts` is synthesised now.** It is the same Alerts stack dev has, in `eu-central-1`, which is
  production's Region (0044) and the email Region. Its topic policy admits SES for this one configuration
  set, by the set's ARN, as the SES developer guide's example does. It also admits production's alarms and
  task-stopped rule, which #98 will add. Its address is `/mvgl/prod/alarm-email`, set by hand as dev's is.
- **One message per event, not a count.** A small site expects a handful a month. Each one is somebody whose
  email did not arrive, or a bot's address, and the message says which. If they come by the hundred, the
  sign-up form is being run against, and that is worth an email per event.
- **A dropped send is reported too.** Every send to a suppressed address reaches the owner as an
  `OnAccountSuppressionList` bounce, which is how the owner learns why somebody's confirmation never came.
- **The application does not subscribe**, although the request said "the application will receive" the
  events. Nothing in the API would act on an event SES has not already acted on. If delivery is ever
  recorded per message, #420's `EmailDeliveries` is where a subscriber would go.

### 4. No alarm on the two rates

- AWS writes to the account's address when it starts a review, before any pause.
- Each bounce and complaint is already in the owner's inbox (§3). At this volume that is earlier warning than
  any rate could give.
- The metrics do not exist yet. `mvgl-prod` has sent nothing, and `AWS/SES` lists no metric there.
- If one is wanted later, it is an alarm in `EmailStack` named `mvgl-prod-…`, sent to the same topic. The
  topic's policy already admits it.

### 5. What somebody whose address is suppressed sees

They see what everybody sees: "Check your inbox" and a button to send it again, and then nothing arrives. The
API was told the email went. So that button, `ResendConfirmation`, is now followed by the support address,
`SUPPORT_EMAIL` in `@/lib/links`. It shows in the sign-up dialog and in the sign-in dialog's "confirm first",
which is where somebody who closed the first one arrives. The owner has the `OnAccountSuppressionList` bounce
for the attempt. Once the person says the mailbox works, the owner can lift it with
`aws sesv2 delete-suppressed-destination` (`infra/README.md`), and the next resend arrives.

## Consequences

- **Three steps by the owner in `mvgl-prod`, in this order:** set the parameter; deploy `Mvgl-prod-Alerts`
  and confirm its subscription; deploy `Mvgl-prod-Email`. Both stacks have to be deployed before any App
  deploy of this revision. The API now names the set, and until `Mvgl-prod-Email` makes it, every send fails
  as not sent. 0088's "order does not matter" no longer holds. Dev is parked, so the next `resume` is the
  deploy to come after these steps.
- **0088's open question is answered**: the role needs the configuration set among its resources.
- **The suppression list holds personal data outside our database.** An address stays on it until somebody
  removes it, so deleting an account does not remove it, and should not: removing it would let the next
  sign-up with that address bounce again. Each event also puts an address in the owner's inbox. The privacy
  policy should say both, on #112's line about it.
- **Not here:** an alarm on the rates (§4); a subscriber in the application (#420); the CloudFormation
  stack for production's App (#98). Email feedback forwarding to `noreply@` is left as it is. It is a setting
  on the hand-made identity, it reaches nobody, and it costs nothing.
