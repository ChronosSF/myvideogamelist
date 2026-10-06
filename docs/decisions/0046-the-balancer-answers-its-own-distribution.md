# 0046. The balancer answers its own distribution, and what else the CloudFront phase settled

**Status:** Implemented; verified against the environment on 2026-10-06 by `scripts/dev-check.mjs`, all checks passing
**Amends:** [0044](0044-what-the-deployment-walkthrough-settled.md), the CloudFront section

## Context

0044 settled what CloudFront may believe: one cache policy with a minimum TTL of 0, the
behaviours and their `*`-without-a-slash shape, basic auth as a function on every behaviour with
three paths exempt (D-8), the balancer admitting CloudFront's prefix list and then standing aside
on the viewer's address (D-7). Building it left one question open on #97 and found five things the
record did not decide.

The open question: the managed prefix list `com.amazonaws.global.cloudfront.origin-facing` proves
that a request came through *some* CloudFront distribution. Anybody's distribution can name our
balancer as its origin, and D-7's `preserve` mode then believes whatever `X-Forwarded-For` that
distribution sends. The balancer has to know the request came through *ours*.

The five: where the distribution lives, given that its origin is a balancer the application stack
creates and destroys; two routes added since 0044 was written, `/import` and `/admin`, which render
for one person and had no behaviour of their own; how `resume` and the pipeline prove the site
answers when every path is behind basic auth; how the pipeline learns a distribution id that
changes on every resume; and that the `us-east-1` certificate crosses Regions the same weak way as
every other reference in this app, which puts an order on the first deploy.

## Decision

1. **The distribution sends `X-Origin-Verify`, and the balancer's listener requires it.** The
   value is a Secrets Manager secret the Data stack generates, `mvgl/<env>/origin-verify`, forty
   letters and digits. The distribution attaches it to every origin request as a custom header;
   the listener's default action is a fixed 403, and each of its three forwarding rules carries
   the header condition beside its path condition. The value reaches both sides as a CloudFormation
   dynamic reference, resolved at deploy time, so it is in no template, no output and no log. The
   prefix list stays: it is what refuses the TCP connection before TLS, and two independent gates
   are cheaper than one perfect one. Rotation is a Data deploy with a new generated value, then an
   App deploy; the site is a 403 in between. #109's VPC origin retires all of this by making the
   balancer internal, and nothing here stands in its way.

2. **The distribution lives in the application stack.** Its origin is the balancer that stack
   creates, its alias is the record that stack owns, and a distribution with no origin is not
   worth paying to keep. The alternative, a long-lived edge stack re-pointed at each new balancer,
   would wait on the same CloudFront propagation on every resume and add a second deploy to it,
   while holding a distribution with a dead origin whenever the environment is parked. The cost
   accepted: a park and a resume each take several minutes longer, and a resume produces a new
   distribution with a new id and domain, so nothing is cached across one.

3. **A route that renders for one person gets a behaviour of its own, in 0044's shape.** `/import*`
   and `/admin*` join `/lists*`, `/wishlist*`, `/user*` and `/news*` on the managed
   `CachingDisabled` policy with every viewer header forwarded. The origin says `private, no-store`
   for all of them already; 0013 asks for the explicit behaviour so that safety rests on two things.
   The list in 0044 was the route table of its day, and this is the rule it stood for.

4. **Health is proved through the door, with and without the key to it.** Without credentials,
   `/healthz` through the distribution must answer 401 - the function is on the door, and a
   function error instead of a 401 means the store has no key. With the basic-auth pair, from
   `MVGL_DEV_BASIC_AUTH` for `resume` and from the `DEV_BASIC_AUTH` environment secret for the
   pipeline, `/readyz` and `/` must answer 200: the API and the SSR server each answering through
   CloudFront, the balancer and its origin-verify rule. Target health stays the first check, and
   `resume` turns the gate on without the pair, because `ecs wait services-stable` has already
   proved the targets; the pair is the stronger proof, not the only one. The pipeline skips the
   authenticated checks with a warning until the secret exists, rather than failing a deploy over a
   secret nobody has set yet.

5. **The pipeline reads the distribution id from the application stack's outputs** and invalidates
   `/*` after every deploy, waiting for the invalidation to finish before the smoke test. A copied
   variable would be stale after the first resume. The deploy role may invalidate any distribution
   of the account for the same reason: the one that exists is recreated with a new id each time.

6. **The certificate crosses Regions as a weak reference, and the first deploy has an order.**
   `Fn::GetStackOutput` works across Regions as it does across stacks, so the `EdgeCert` stack
   publishes its certificate as an output and the application stack reads it from `us-east-1`
   directly - no custom resource, no parameter in between. The consequence is the one 0044's
   fix for weak references already taught: the producer must be deployed with the consumer in the
   synthesis before the consumer deploys. So this phase deploys `EdgeCert`, then `Data`, then the
   credential by hand, then `App`; afterwards `resume` and the pipeline deploy `App` alone.

7. **`allowedCidr` and `dev-env.mjs allow` are gone.** The balancer admits CloudFront only, and no
   context value can reopen it to an address. The way in, for a developer as for anybody, is the
   distribution and the basic-auth pair.

## Consequences

- **The balancer is still public, with two addresses** - the prefix list and the header decide
  who gets an answer, not who can connect. Removing the addresses is #109's internal balancer
  behind a VPC origin, which this phase has made the natural next step rather than a prerequisite.
- **D-7's `preserve` is safe because of decision 1, and only because of it.** Opening the security
  group or dropping the header condition from a rule would let a caller choose the address the
  login limiter partitions on.
- **The credential is set by hand and rotated by hand.** The function fails closed while the key
  is missing, which is the right failure, and is also the first thing to suspect when every path
  answers an error rather than a 401.
- **Not here:** HSTS on documents through a response headers policy, a WAF, the VPC origin (#109),
  and invalidating a withdrawn profile from the API (ROADMAP D14).
