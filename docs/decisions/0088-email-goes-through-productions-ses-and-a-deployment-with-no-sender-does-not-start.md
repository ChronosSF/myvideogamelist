# 0088. Email goes through production's SES, as a role dev assumes, and a deployment with no sender does not start

**Status:** Implemented in the sender. Nothing calls it yet: the first email is
[#421](https://github.com/ChronosSF/myvideogamelist/issues/421)'s confirmation. Proved only by a deploy, which
waits for the owner (`infra/README.md`, "Production's SES, for dev's email"). Part of
[#100](https://github.com/ChronosSF/myvideogamelist/issues/100). The configuration set #419 adds is
[0091](0091-a-bounce-or-a-complaint-stops-all-mail-to-that-address.md): the role needs it among its resources,
and the owner's deploys now have an order.

## Context

[#112](https://github.com/ChronosSF/myvideogamelist/issues/112) (sign-up confirmation, password reset and change
of address) waits on a sender. Before this change the API sent no email at all.

What was already there, and what changed on 2026-11-09:

- **The domain is an SES identity in the production account**, in `eu-central-1`, with Easy DKIM, made by hand
  when `mvgl-prod` was created ([0044](0044-what-the-deployment-walkthrough-settled.md)). `mvgl-dev` has no
  identity at all.
- **Production access was granted to `mvgl-prod` the day it was asked for**
  ([#418](https://github.com/ChronosSF/myvideogamelist/issues/418)): 50,000 a day, 14 a second. `mvgl-dev` is
  still in the sandbox, where only verified addresses receive mail.
- **The owner means to open the dev environment to the public before production exists**
  ([#98](https://github.com/ChronosSF/myvideogamelist/issues/98)), and decided that dev should use production's
  SES rather than get an identity and a production access request of its own.
- **The request made promises** to AWS, which are now #112's: transactional mail only; no sign-in before the
  address is confirmed; bounces and complaints handled
  ([#419](https://github.com/ChronosSF/myvideogamelist/issues/419)); at most one reset email per address every
  few minutes; From `noreply@myvideogamelist.net`, Reply-To `support@myvideogamelist.net`.
- **SES's refusal text names the recipient.** A sandboxed send to an unverified address fails with "the
  following identities failed the check in region EU-CENTRAL-1: someone@example.com", and the exception
  handler logs an exception with everything inside it. No log line here may carry an address
  ([0059](0059-a-request-is-known-by-its-trace-and-a-build-by-its-commit.md)).
- **Many things build the host, and not all of them are Development**: `dotnet run`, the browser smoke test
  and the Lighthouse audit are; the integration suite, the pipeline tests, the build's migration bundle and the
  deployed migration task are not.

## Decision

### 1. One seam: `IEmailTransport`

`IEmailTransport.SendAsync(EmailMessage)` delivers a message that is already composed: a purpose for the log,
one recipient, a subject, a text body and an optional HTML body. Composing the three account emails is
#421's, #422's and #423's, beside the flows that send them. Who every message is from, and where a reply
goes, is configuration (`Email:From`, `Email:ReplyTo`), so that nothing composing a message can choose it.
The sender defaults to `EmailIdentity`'s `noreply@`, a constant the CDK app compiles too (§3).

### 2. SES's v2 API, simple content

One `SendEmail` per message, with SES building the MIME and signing it with the domain's DKIM key. Each HTTP
request has ten seconds, not the SDK's hundred, and the whole send, the SDK's retries and backoff included,
fifteen, because somebody is waiting on a sign-up. A display name outside ASCII goes as an RFC 2047 encoded
word, which SES requires.

### 3. Dev sends as a role in the production account

The dev API's task role assumes `mvgl-dev-email` in `mvgl-prod`, and SES sees production sending. The SDK's
`AssumeRoleAWSCredentials` renews the session before it expires.

- **Not SES's sending authorization.** It lets one account send with another's identity, but the sends are the
  delegate's, and the SES developer guide says that "the AWS account of the delegate sender has to be removed
  from the sandbox before it can be used to send email to non-verified addresses" (*Sending authorization
  overview*). That would need a second production access request, which the owner decided against.
- **Trusted by one role, by its name.** The trust policy names the dev account as its principal, with a
  condition that the caller's ARN is `role/mvgl-dev-api-task`. A role principal would be saved as the role's
  unique id, and a park and a resume recreate the task role under the same name with a new id, which would
  leave production trusting a role that no longer exists. So the dev API's task role now has that fixed name,
  where CloudFormation used to make one up.
- **Allowed one thing:** `ses:SendEmail` on the domain's identity, with `ses:FromAddress` equal to
  `noreply@myvideogamelist.net` (the SES developer guide's *Controlling access* lists that key for
  `SendEmail`). The address is `EmailIdentity.FromAddress`, a file of the API's that the CDK app compiles, as
  it does `SessionLimits.cs`, and the API's default `Email:From`: the role and the sender cannot drift.
- **Production will send as its own task role** when #98 builds it, with no role to assume. The App stack
  already grants that role `ses:SendEmail` on the same terms when it is synthesised for production.
- **Deployed by hand, as `Mvgl-prod-Email`**, because no pipeline reaches the production account (0066). It is
  long-lived and outlives the holding page. It is pinned to `Site.EmailRegion`, `eu-central-1`, never the
  deploying profile's Region, and so is every API's `Email:Ses:Region`: an identity and its production access
  belong to one Region, and a grant on the identity in any other would refuse every send.
- **Both account ids are named in `Site.cs`**, because each side of a cross-account trust has to say which
  account the other is. An id grants nothing by itself, and `cdk.context.json` has named both since its first
  lookups. A parameter set by hand in each account, as the alarm address is
  ([0080](0080-an-alarm-watches-what-a-reader-sees-and-mails-an-address-nobody-commits.md)), was the alternative:
  it costs a hand step in each account, and in the App stack it would be read at deploy time under the
  pipeline's role, which nothing has shown may read it.

### 4. A deployment with no sender does not start

`AddEmail` registers SES where `Email:Ses:Region` is set, and an outbox folder where `Email:OutboxPath` is set
or the environment is Development. Anywhere else it throws, and the host does not start. An account that cannot
be sent its confirmation can never be confirmed, so a deployment missing this would take sign-ups it could
never finish, with a clean log until somebody wrote in. The key ring refuses the same way, for the same kind of
reason ([0043](0043-where-the-key-ring-lives.md)). For the same reason a deployment whose `Email:From` names an
address other than `EmailIdentity.FromAddress` does not start where SES sends: the role would refuse every
send. And the outbox, when its folder cannot be written, fails as SES does, with an `EmailNotSentException`.

So everything that builds the host outside Development names an outbox it never writes to: the Dockerfile's
bundle step, the migration task, the pipeline tests and the integration suite. Running the production image on
a developer machine means setting `Email__OutboxPath` beside `DataProtection__AllowEphemeralKeys`. A Region and
a folder together send through SES, so that a folder left in configuration never quietly outranks a deployment.

### 5. The outbox writes `.eml` files

Development's sender writes each message to a folder, `mvgl-outbox` in the system's temp folder unless
`Email:OutboxPath` says otherwise, and logs the file's path. Any mail program opens one, and so does an editor,
since the text body is written as it is. The file is named by the time and a random suffix, never the
recipient. The browser smoke test will read #421's link from these files, with no AWS and no inbox.

### 6. No address in any log line or exception

- A sent message is logged by its purpose and the id SES gave it, which a bounce or a complaint names later.
- A refusal is logged once, by the transport, with SES's error code, status and message, every address
  masked, and up to a thousand characters, since an `AccessDenied` names its resource last. It then leaves as
  an `EmailNotSentException` carrying that text as `Reason`, not in its message, so a handler that logs it
  does not say it twice, and with **no inner exception**, because the handler would log that one whole.
- `EmailMessage.ToString()` is the purpose alone, because a record's own would print the address, and a link's
  token, into any log line it is interpolated into by mistake.

### 7. What a failure is

Anything SES answers with, and anything that keeps it from answering (the network, a timeout, credentials
that could not be had), is an `EmailNotSentException`. The client is made on the first send, inside the
transport's handling, because making it resolves credentials. The caller's cancellation passes through as
itself, and so does any other exception, which is a bug of ours. What a flow does when its email was not sent
is that flow's decision, not the transport's.

## Consequences

- **Two steps by the owner before dev can send**, in `infra/README.md`: a CDK bootstrap of `mvgl-prod` in
  `eu-central-1`, which #98 needs anyway, and a deploy of `Mvgl-prod-Email`. Their order against an App deploy
  does not matter: the role is assumed on the first send, and until it exists a send fails as not sent.
- **The first App deploy after this replaces the dev API's task role** with the named one.
- **Every email dev sends counts against production's reputation**, its bounces and complaints included. Test
  with addresses you own, or SES's mailbox simulator.
- **#419 adds a configuration set** for bounce and complaint events. Check then whether the role needs it among
  its resources.
- **`EmailDeliveries` (#420) is not needed for this.** The data-model plan ties it to release and price emails.
  Whether #422's limit of one reset email per address is kept there is #422's call.
- **Not here:** the three emails' wording, the confirmation flow (#421), the reset limit (#422), bounce handling
  (#419), and the privacy policy's sentence that the site sends no email, which #112 lists.
