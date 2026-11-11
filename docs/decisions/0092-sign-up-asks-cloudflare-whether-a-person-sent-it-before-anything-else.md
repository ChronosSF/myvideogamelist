# 0092. Sign-up asks Cloudflare's Turnstile whether a person sent it, before anything else

**Status:** Implemented. [#467](https://github.com/ChronosSF/myvideogamelist/issues/467). Amends
[0053](0053-a-documents-scripts-carry-its-renders-nonce.md) with the first host its `script-src` names. Proved
on dev only once the owner has made the widget and set its pair (`infra/README.md`, "Turnstile, for sign-up").

## Context

- **Sign-up is the one form that mails an address a stranger typed.** It sends the confirmation to whatever
  address it is given ([0089](0089-an-account-signs-in-once-its-address-is-confirmed.md)), from production's SES
  account ([0088](0088-email-goes-through-productions-ses-and-a-deployment-with-no-sender-does-not-start.md)).
  Resending a confirmation and asking for a reset mail only accounts that exist, paced per account
  ([0089](0089-an-account-signs-in-once-its-address-is-confirmed.md) §5,
  [0090](0090-a-password-reset-works-once-for-an-hour-and-ends-every-session.md)).
- **That account's reputation is production's.** AWS reviews an account at a 5% bounce rate or 0.1% complaints
  ([#466](https://github.com/ChronosSF/myvideogamelist/issues/466)). A made-up address bounces, and a stranger's
  can draw a complaint. At dev's volume a handful of either is a large share.
- **Dev's basic auth is coming off** for testers recruited by link
  ([#465](https://github.com/ChronosSF/myvideogamelist/issues/465)). Without it, two things stand in front of
  sign-up:
  - **The write guard's header** ([0033](0033-what-the-api-refuses.md)) stops a bot that posts HTML forms. A
    script written for this site sets it in one line.
  - **Ten attempts per network address every five minutes** stops one machine, not a bot spread over many.
- **The candidates:**
  - **Cloudflare Turnstile** is free and usually asks nothing of a person. It works on a site Cloudflare does
    not host.
  - **reCAPTCHA** brings Google's tracking.
  - **hCaptcha** shows puzzles more often.
  - **AWS WAF's CAPTCHA and Bot Control** cost a fee a month plus a charge per request and per challenge. For
    an API called from the page they need AWS's own script anyway.
  - **A self-hosted proof of work** only makes each attempt cost the browser some time. It slows a bulk sign-up
    rather than telling a bot from a person.
- **What Cloudflare's siteverify answers**, seen live on 2026-11-11 with its published test secrets:
  - **`1x…AA`** passes any token that is not empty.
  - **`2x…AA`** answers `invalid-input-response`.
  - **`3x…AA`** answers `timeout-or-duplicate`.
  - **All three** carry `"metadata": {"result_with_testing_key": true}`.
  - **A secret it does not know** answers `invalid-input-secret`.
  - **An empty token** answers `missing-input-response`.

## Decision

### 1. Turnstile, on the sign-up form and nowhere else

Signing in, resending a confirmation and asking for a reset reach only accounts that exist, at a pace per
account, and signing in has the lockout. A check there would cost every person a wait for nothing.

### 2. The API asks first, before anything else is looked at

`POST /api/auth/register` takes `turnstileToken` and asks Cloudflare about it before anything else.
- **A refusal** is a 400 with one sentence. No account is made, no email goes, and the name stays free. A bot
  learns nothing, not even whether a name is taken.
- **Asking spends the token, whatever the answer.** So the form draws the widget again after any failed
  attempt, and the server never retries: a second question about a token Cloudflare already answered would be
  told it is spent, and refuse a person.
- **The reader's address** goes to Cloudflare as `remoteip`. Cloudflare has it already: the browser fetched the
  widget from it.

### 3. Cloudflare unreachable is a 502, and nobody signs up unchecked

- **The call has eight seconds.** A failure is `UpstreamFailureHandler`'s 502
  ([0034](0034-failing-in-one-shape.md)).
- **The page says its own sentence for it.** The 502's detail is written about IGDB, for game pages.

### 4. One widget per environment, its pair set by hand, and the API hands the page the site key

- **One widget per environment,** so dev's secret never passes a check on production.
- **The pair lives in Secrets Manager** at `mvgl/<env>/turnstile`, made by the Data stack with a placeholder and
  set by hand, as IGDB's is ([0005](0005-secrets-handling.md)). The App stack gives both halves to the API.
- **The page asks for the site key when the sign-up form opens**, from `GET /api/auth/turnstile`, sent
  `no-store`. Not built into the page, because one build serves every environment. Kept beside the secret, so
  that one widget's pair is set in one place.

### 5. No keys takes no sign-ups; a test key in a deployment does not start

- **A deployment with no keys still starts.** It answers 503 to the site-key request and to every sign-up, and
  logs an error each time.
  - **Not a startup failure**, unlike a missing email sender, because the migration task and the bundle's build
    boot the same host and would each need a secret they never use.
  - **Development with no keys uses Cloudflare's always-passing test keys**, so a fresh checkout signs up with no
    setup.
- **Configuration that would let every token through refuses to start:**
  - **A test secret outside Development.** It answers the same whoever asks, and the log would stay clean.
  - **`Turnstile:SiteVerifyUrl` anywhere but a loopback address in Development.** It exists for the smoke test's
    stand-in.
- **Half a pair refuses to start too.**

### 6. The script loads when the form opens, and the page policy names its host

- **`script-src` names `https://challenges.cloudflare.com`, by host.** This is the first host the document policy
  admits, and it amends 0053.
- **No `'strict-dynamic'`**, which would make every named host meaningless.
- **The widget's frame needs nothing,** because the policy restricts no frame.
- **Loaded only when the form opens.** Nobody who never opens sign-up is sent to Cloudflare, and every other
  page loads exactly what it did.

### 7. Every test signs up without reaching Cloudflare

- **The integration suite** replaces `ITurnstile` with `JudgingTurnstile`, which refuses one token and passes any
  other, and keeps the controller's handling of each answer.
- **The client's tests** mount a stand-in widget that hands over a numbered token.
- **The smoke test and the Lighthouse audit** keep their rule of reaching no third party
  ([0060](0060-one-browser-test-over-the-production-shape.md)):
  - **In the browser,** Turnstile's script is served by a stand-in that passes at once.
  - **Behind the API,** siteverify is a stand-in on the IGDB stand-in's port, which passes Cloudflare's test
    token with Cloudflare's test secret and nothing else.

## Consequences

- **The owner's steps**, before the change reaches a deployment:
  1. Make the dev widget in Cloudflare's dashboard.
  2. Deploy the Data stack, which makes the placeholder.
  3. Set the pair.
  
  Merging deploys the App stack, which needs the Data stack's new export, so a merge before step 2 fails the
  release, and one before step 3 refuses every sign-up until it is done. Production needs its own widget for
  `myvideogamelist.net` when [#98](https://github.com/ChronosSF/myvideogamelist/issues/98) builds its Data stack.
- **The privacy policy names Cloudflare.** The browser of anybody who opens the sign-up form fetches from it, and
  the API sends it the token and the reader's address. That is on the policy's pull request,
  [#408](https://github.com/ChronosSF/myvideogamelist/pull/408).
- **Somebody who blocks `challenges.cloudflare.com` cannot sign up.** The form says so, and offers to try again.
- **Not here:**
  - **Checking siteverify's `hostname` against the site's.** The widget's own hostname list stops a token being
    made elsewhere with this site key.
  - **Turnstile's `action` and `cdata`**, which say which form a token came from. There is one form.
