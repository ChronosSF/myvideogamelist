# 0101. Dev's basic auth comes off for the trial, by one line the stack reports

**Status:** Implemented; proved only by a deploy. Amends
[0046](0046-the-balancer-answers-its-own-distribution.md) §4, "health is proved through the door": the
proof now reads which way the stack was deployed. It also sets aside
[0044](0044-what-the-deployment-walkthrough-settled.md)'s basic auth on every behaviour, for as long as
`Site.BehindBasicAuth` is false for an environment. What "true for any other environment" means for
production is [0103](0103-production-is-the-same-stacks-behind-an-approval.md) §5, and since that record
the door and the redirect of `www` are one function.

## Context

Dev has sat behind HTTP basic auth since 0044: a CloudFront function on every behaviour, with three public
aggregate paths exempt (D-8). It is what made a development site safe to leave on the internet. No
stranger signs up, no crawler reads it, and no scraper spends the IGDB budget.

In November 2026 dev opens to testers for about two weeks, recruited by a link in public posts. Nobody
can be handed the pair in a post, so the door has to come off for that time.

Nothing in the repository could take it off. The function was unconditional, and three things assert
that it is there:

- the Deploy dev smoke test fails a run whose `/healthz` is not a 401 without credentials;
- `dev-env.mjs resume` leaves the pipeline's gate off for the same reason;
- `dev-check.mjs` fails its first three checks.

Taking the function off the behaviours by hand, in the console, would have failed the next deploy's
smoke test and been undone by that deploy.

What stands in for the door while it is off was built first, each in its own record: Turnstile before a
sign-up ([0092](0092-sign-up-asks-cloudflare-whether-a-person-sent-it-before-anything-else.md)), an
address confirmed before a sign-in
([0089](0089-an-account-signs-in-once-its-address-is-confirmed.md)), one rate rule at the edge
([0098](0098-one-rate-rule-at-the-edge.md)), `noindex, nofollow` on every response of a deployment that
is not indexable ([0036](0036-what-a-crawler-is-told.md)), and the moderation of what members publish
([0076](0076-a-reader-reports-and-an-admin-withdraws.md)).

## Decision

### 1. One line in `Site.cs` says whether an environment is behind basic auth

`Site.BehindBasicAuth`: false for dev, true for any other environment, and changed by a pull request.

Where it is false, `Edge.cs` gives no behaviour the function. The function itself is still made, and
still reads the store, for two reasons:

- **Putting the door back is then the one line and a deploy.** Nothing is recreated, and the pair is
  where it was.
- **The Data stack's output that carries the store goes on being read.** Cross-stack references are weak
  here (`cdk.json`), and the Data stack drops an output nothing reads at its next deploy, as the comment
  in `Program.cs` records. A later deploy with the door back would then find no store.

**Not a context value given to `cdk deploy`, and not a variable on the GitHub environment**, as the
deploy gate is. Two things deploy the App stack, the pipeline and `dev-env.mjs resume`, from two
machines. A switch each has to be handed is open from one and shut from the other on the day one of them
is not handed it, and shut means every tester meets a browser's password prompt. A line in the code is
the same from both, and a change to it is reviewed.

### 2. The stack says which it was deployed as, and every check reads that

The App stack has an output, `BasicAuth`, `on` or `off`.

- **The Deploy dev smoke test** reads it after the deploy. For `on` it is as before: a 401 without the
  pair, then `/readyz` and `/` with it. For `off`, `/healthz`, `/readyz` and `/` each answer 200 with no
  pair, and the pair is not sent. Anything else in the output fails the run.
- **`dev-env.mjs resume`** reads it the same way before it turns the gate on, and `status` prints it.
- **`dev-check.mjs`** asks the site first: `/healthz` with no credentials is a 401 with a Basic challenge,
  or a 200. Signed in to AWS, it holds that against the output, so a site found open that was deployed
  shut fails, which is the failure it most exists to catch. Of an open site it runs its whole list
  without the pair, and does not send one that is set.

A stack deployed before the output existed has none, and is read as `on`, which it was.

The alternative was for each check to try both and accept either. A smoke test that accepts an open door
cannot tell one opened on purpose from one left open by a mistake in `Edge.cs`.

### 3. What stays as it is

- **The balancer's lock.** It admits CloudFront's prefix list and answers only the distribution that
  sends the origin-verify header (0046). Open means open through the distribution and through its web
  ACL, never around them.
- **`noindex`.** Dev's SSR server is given no `SITE_INDEXABLE`, so every response says
  `noindex, nofollow` (0036), and `dev-check` goes on checking that it does. That check matters more
  with the door off than it did behind it.
- **The three exempt paths** (D-8). The exemption is the function's, so it is idle while no behaviour
  names the function, and back with it.
- **The pair.** It stays in the store and in the `DEV_BASIC_AUTH` secret, unused while the site is open.

### 4. Putting it back

Change the line, merge, run Deploy dev. That takes a pull request's time: CI, then a deploy.

For something that cannot wait that long, `dev-env.mjs park` takes the site away in minutes, and the
rate rule is already refusing an address that floods it.

## Consequences

- **Anybody can reach dev, and sign up on it.** Its database is real data from the first tester on,
  since their lists are promised a place on production, and every email it sends counts against
  production's SES reputation
  ([0088](0088-email-goes-through-productions-ses-and-a-deployment-with-no-sender-does-not-start.md)).
- **The run of Deploy dev that follows this change's merge is the one that opens the site.** There is no
  separate step, and no way to merge it and stay shut but to leave the pipeline unrun.
- **`dev-check.mjs` needs no pair to run in full** while the site is open, and counts one request more
  against the rate rule behind a door: the one that asks which it is.
- **The pipeline cannot be exercised by a pull request**, since it runs only when dispatched on master.
  What was checked before the merge is in the pull request that built this record.
