# 0098. One rate rule at the edge: an address past 300 requests in five minutes is answered 429

**Status:** Implemented on dev; proved only by a resume (`infra/README.md`, "The rate rule"). Part of
[#438](https://github.com/ChronosSF/myvideogamelist/issues/438), which keeps AWS's managed rule groups and
production's ACL. Gives [0033](0033-what-the-api-refuses.md) §2 the edge it left volume control to, and
takes the WAF off the deferred lists of [0044](0044-what-the-deployment-walkthrough-settled.md) and
[0046](0046-the-balancer-answers-its-own-distribution.md).

## Context

- **Nothing has limited reads.** 0033 §2 limits sign-in and sign-up per address, joined since by the two
  requests that send an email ([0089](0089-an-account-signs-in-once-its-address-is-confirmed.md),
  [0090](0090-a-password-reset-works-once-for-an-hour-and-ends-every-session.md)), and says volume control
  for everything else "belongs at the edge, with the CDN and its WAF".
  No WAF was built ([0044](0044-what-the-deployment-walkthrough-settled.md)'s deferred list, #109).
- **What volume spends is IGDB's budget.** The API calls IGDB at four a second, for the whole site, with a
  queue sixty-four deep behind that; past the queue, everybody's browse and search is a 503
  ([0034](0034-failing-in-one-shape.md)). A request the edge has not cached costs one IGDB call (a browse or
  a search page) or two (a game page: the game and its related games), each kept in the API's memory
  afterwards. One address sending distinct pages can spend the budget alone.
- **Basic auth has been the limit so far, and it is coming off** for testers recruited by link
  ([#465](https://github.com/ChronosSF/myvideogamelist/issues/465)).
- **The distribution lives in the `App` stack, which a park destroys** (0046 §2), and a park must leave
  nothing billing but the idle floor (0044).
- **What a page sends**, counted in the browser on 2026-11-15 against the worktree's dev server, signed in
  as a test account, with React's development double-run of effects taken out. Counted means everything
  but the hashed bundles under `/assets/`:

  | What | Counted requests |
  |---|---|
  | The home page loaded afresh, signed in: the document, nine API calls, the route manifest, the icon | about 14 |
  | `/games` loaded afresh, signed in | about 10 |
  | Any page loaded afresh, signed out: the document, `/api/auth/me`, the manifest, the icon | about 4 |
  | A move to a game page inside the site: its `.data`, five API calls, the manifest | about 7 |
  | A move to `/games`, `/lists` or `/wishlist` inside the site | 0 to 2 |
  | A search typed into the navbar | 1 to 4, by how the typing pauses |

- **What AWS says**, each read in its documentation on 2026-11-15 unless marked:
  - A web ACL for CloudFront is made in `us-east-1`, and the distribution names it by ARN in `WebACLId`;
    `AWS::WAFv2::WebACLAssociation` is not for CloudFront (the CloudFormation reference for
    `AWS::WAFv2::WebACL`, `AWS::WAFv2::WebACLAssociation` and the distribution's `DistributionConfig`).
  - `DeleteWebACL` refuses an ACL that is still associated, with `WAFAssociatedItemException`, and says to
    disassociate it first (the WAF API reference).
  - A rate-based rule counts over 60, 120, 300 or 600 seconds, takes a limit of 10 or more, "checks the
    rate about every 10 seconds", starts blocking after a delay that is "usually below 30 seconds", and
    acts near the limit rather than exactly at it. Changing a rule's rate settings resets its counts and
    "can pause the rule's rate limiting activities for up to a minute" (the WAF guide's rate-based rule
    pages and `RateBasedStatement`).
  - A rule's block can answer with a status of our choice, 429 among them, and a body of up to 4 KB that is
    `TEXT_PLAIN`, `TEXT_HTML` or `APPLICATION_JSON` (the WAF guide's custom responses and quotas).
  - A log in CloudWatch Logs goes to a group named `aws-waf-logs-…` in the ACL's Region; a redacted field is
    written as `xxx`; `httpRequest.clientIp` is the address (the WAF guide's logging pages).
  - **The order at the edge.** The CloudFront guide says "the Lambda@Edge viewer request is executed after
    any AWS WAF rules are applied". For CloudFront Functions, and for the cache, its pages say nothing; an
    AWS post, "Charting the life of an Amazon CloudFront request" (17 October 2025), says WAF "always
    executes before any content-handling rules", naming cache behaviours and CloudFront Functions, and it
    places the cache lookup after the viewer-request function.
  - **The address.** `IP` aggregates on "the IP address from the web request origin", which behind a proxy
    "will contain the address of the last proxy". No page says in as many words what that is for an ACL on
    a distribution. AWS's own example of forwarded addresses is an ACL *behind* a CDN.
  - **The price:** $5 a month a web ACL, $1 a month a rule, $0.60 a million requests, prorated by the hour
    (the WAF pricing page's examples); a rate-based rule "costs the same as a regular AWS WAF Rule" (the WAF
    FAQ); WAF includes 500 MB of CloudWatch Logs for each million requests it inspects, beyond which logs
    are vended-log prices (the pricing page).

## Decision

### 1. One rule: past 300 requests in five minutes, an address is answered 429

**It counts every request but `/assets/`.** The pages are rendered on the server, and their loaders call
IGDB, so a document and its `.data` count as much as an `/api/` call. One page load fetches dozens of hashed
bundles, which never reach the API, so they do not count. Nothing else is singled out: the route manifest,
the icon, `robots.txt` and the health paths are a handful a page, and counting them keeps the rule one
negative match rather than a list of paths to keep up to date.

**The limit is 300 in a window of 300 seconds**, `WafStack.RequestsPerFiveMinutes`, with the arithmetic
beside it. From the table above:

- **One person browsing briskly**, a game page every ten seconds inside the site, sends about 210.
- **Twenty search results opened in tabs at once** are about 280, all documents.
- **Two people behind one address** at an ordinary pace, a page every twenty to thirty seconds, send about
  200 to 250 between them.
- **On the other side**, 300 requests can spend at most 600 IGDB calls, half of the 1,200 the site has in
  five minutes, so anybody else always has the other half.

An office or a school behind one address does not fit, and on dev nobody is expected to browse from one.
That is production's question. **#447's load check is what tunes the number**, by measuring where IGDB's
budget actually runs out; until then 300 is arithmetic, not measurement.

**Keyed on the address that connected, never on `X-Forwarded-For`.** The viewer writes that header, so a
rule keyed on it would let every request choose its own bucket, and AWS adds that a request without the
header is not counted at all.

### 2. A stack of its own in `us-east-1`, made and destroyed with the environment

`Mvgl-<env>-Waf` holds the ACL, its log group and the logging configuration, in the one Region a
CloudFront ACL can be made in. Not inside `EdgeCert`: that stack is long-lived, and the ACL bills by the hour
whether anything reaches it or not. Not inside `App` either, which is in the environment's own Region.

`scripts/dev-env.mjs` deploys it on `resume` just before `App`, and destroys it on `park` **after** `App`,
because the distribution holds the ACL and WAF refuses to delete one something still uses, and after the
database is stopped, so that a failure here cannot leave the dearer thing billing. Its destroy is
`--exclusively`: `App` depends on it, and without the flag `cdk destroy` adds every stack that depends on
the one named ("Including depending stacks", read in the CLI's source, `aws-cdk` 2.1148.0). `status` reports
it, and says when it has outlived `App`. Not termination-protected, for the same reason `App` is not.

### 3. The ARN reaches the distribution the way the certificate does

`App` reads the ACL's ARN as a weak cross-region reference: `Fn::GetStackOutput` on the `Waf` stack in
`us-east-1`, resolved when `App` deploys, exactly as it reads `EdgeCert`'s certificate (0046 §6). Chosen over
a parameter because of three facts:

- **The pipeline deploys `App --exclusively` on every merge, and keeps working unchanged.** The reference is
  resolved by CloudFormation with the access the certificate's already has; the workflow needs no new step,
  role or permission. A parameter would have to be written in `us-east-1`, beside the ACL, and CloudFormation's
  way of reading one, `{{resolve:ssm:…}}`, has no field for a Region in its syntax: `App` would need a custom
  resource, a function of its own, to fetch it.
- **The order a cross-region reference puts on a destroy is the order WAF puts on it anyway.** `App` depends
  on `Waf`, so `Waf` can only go once `App` has; that is also when the distribution has let go of the ACL.
- **Both per-release stacks are in every synthesis, with or without `imageTag`** (`Program.cs`). The weak
  reference's output exists in `Waf`'s template only while `App` is in the synthesis that deployed it, and
  `App` always is, so a `Waf` deploy without a tag keeps the output `App` reads. The same fault in `Data`
  is the reason `Program.cs` is written that way.

**The pipeline never deploys `Waf`.** A change to the rule is deployed by hand, or on the next resume (§8).

### 4. The refusal is a page for a person, and the client knows a 429 by its status

The rule answers 429, not WAF's 403. A 403 says "you may not", which is not true, and a 429 is what every
client means by "slow down".

**Its body is a small HTML page**: a heading, "Too many requests", and two sentences, one saying the site has
had more requests from this network address than one person browsing would send and to wait a few minutes,
the other that several people sharing one connection can do it between them. Inline, loading nothing,
`noindex`. HTML, because the reader most likely to meet it is a person, and a person meets it as a document:
twenty tabs opened at once are twenty page loads, and a reader whose page failed reloads it.

**The client does not read the body. It reads the status.** Inside the site a refused request is a `.data`
or an `/api/` call, and the client now knows a 429 that is not the API's for what it is:

- **A move to another page.** React Router throws a 4xx that its own server did not send as a route error
  carrying the status and the body as text. Before this, the root's boundary printed "429 " (HTTP/2 has no
  status text) over the page's raw HTML, and the game page's and the profile's boundaries said "Something went
  wrong on our side". Now each says `RATE_LIMITED` from `@/lib/api`: "Too many requests have come from your
  network address in the last few minutes. Wait a few minutes, then try again."
- **A write.** `bodyOf` reads a 429 that is not JSON as a `ProblemDetails` carrying that sentence, so every
  write that reports its refusal through it says so. The API's own 429, the login limiter's, is a
  `ProblemDetails` with its own sentence, and still wins. The lists', the wishlist's and the favourites'
  optimistic writes keep their fixed sentences ("Failed to update list. Please try again."), which blame
  nobody.
- **The navbar's search**, which held for a 429 already, says the same sentence instead of "Search is
  unavailable right now".

Seen in the browser on 2026-11-15, behind a stand-in that answered with the synthesised ACL's own page: a
game page's `.data`, the games page's `.data` at the root's boundary, a profile-visibility write that changed
nothing, and a page loaded afresh. `ProblemDetails` JSON was the other choice. It suits the API's readers
with no change to the client, but the boundaries needed one anyway, and a person reloading a refused page
would have read a JSON object.

### 5. The address, and the door: a 401 counts

**The rule sees the address that connected to CloudFront**, the viewer's or their network's. Nothing stands
between the viewer and an ACL on the distribution, and the only proxy a request can come through is the
viewer's own. AWS does not say so in as many words for this case, so the next resume shows it (§8): the log
names the address a burst came from.

**WAF runs before the basic-auth function, and before the cache.** So while dev's door is on, a request
without the pair is counted and then answered 401, and a page served from the edge is counted like any
other. Neither matters much: a browser that is asked once sends the pair from then on, and a page from the
edge costs IGDB nothing but still counts against the address that asked for it. What it does mean is that
**a burst without credentials proves the rule**: its answers turn from 401 to 429 at the limit, and that is
also the proof of the order, which AWS states only in a post for CloudFront Functions.

### 6. What it refused is logged, without anybody's credentials

To `aws-waf-logs-mvgl-<env>-edge` in `us-east-1`, for two weeks or until the next park, whichever comes
first. Only what a rule blocked or counted: an allowed request is the site working. `Authorization` (the
basic-auth pair, while the door is on) and `Cookie` (the session) are redacted. WAF keeps its own sampled
requests three hours, so the log is where an address is read the next morning.

### 7. The acceptance test checks it, and cannot trip it

`scripts/dev-check.mjs` asks AWS, read only, through the environment's profile, whether the distribution's
`WebACLId` is the `Waf` stack's ACL, whether that ACL allows everything but one rule keyed on the address that
answers 429, and whether it logs to the group above with both headers redacted. A request the ACL allows
looks the same with it as without it, so the site cannot say. Without the profile those checks are skipped,
and the summary says how many were.

It also counts what it sends through the distribution: 8 without the basic-auth pair, 43 with it, 54 with
`--limiter`. Its last check fails if a run used more than half the rule's limit, which leaves the person
running it room to browse from the same address. `resume`'s own probe of `/healthz` sends at most 18, ten
seconds apart, and Deploy dev's smoke test sends three.

### 8. What it costs, and what is not here

**About $6 a month awake**: $5 for the ACL and $1 for the rule, by the hour, and $0.60 a million requests,
which at dev's traffic is cents. The log is within the 500 MB a million requests that WAF includes. Parked,
nothing: the stack is gone. `dev-env.mjs` now puts the awake environment at about $80 a month, from 0044's
$74.

**Not here**, by #438's scope: AWS's managed rule groups and IP lists, Bot Control, CAPTCHA, a second ACL,
and production's ACL, which waits for production ([#98](https://github.com/ChronosSF/myvideogamelist/issues/98)).
**No alarm**: an alarm on a CloudFront ACL's metrics sits in `us-east-1` and needs a topic there, which is
[#434](https://github.com/ChronosSF/myvideogamelist/issues/434)'s to build.

## Consequences

- **A change to the rule reaches dev by hand**, `cdk deploy Mvgl-dev-Waf --exclusively`, or with the next
  resume; the pipeline deploys `App` and `Migrate` only. A change that renamed what `App` reads would fail the
  next merge's `App` deploy until `Waf` was deployed, and CloudFormation would keep the release before.
- **If dev is awake when this merges, deploy `Waf` by hand first.** The merge's `App` deploy reads its output,
  and fails without it.
- **Destroying `Waf` by hand while `App` stands fails**, and should: the distribution still names the ACL.
  `park` is the way down.
- **#447's load check, run from one address, trips the rule at 300.** Run it from several, or raise the limit
  for its duration and say so, and remember that a change of the rate resets its counts.
- **An office or a school behind one address is refused while its people browse at once.** Production
  decides that, with #447's figures, and perhaps with a key that is not the address alone.
- **The 429 page is English**, as the site is.
- **What a refused reader is told inside the site is the client's sentence, not the page's**, so the two can
  drift; both say it was this address's volume and to wait.
