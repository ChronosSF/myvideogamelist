# 0066. A holding page at the domain until production takes it, and the apex is canonical

**Status:** Implemented; deployed by hand to the production account on 2026-10-23 and checked from
outside: the apex answers with every header in §6, `www` and plain HTTP redirect to it, and a
missing page is a 404 with the same headers. Destroyed when production takes the domain
([#98](https://github.com/ChronosSF/myvideogamelist/issues/98)). Answers #98's open question, apex or
`www`, and with it D7, the cookie's domain. Builds on [0036](0036-what-a-crawler-is-told.md) and
[0044](0044-what-the-deployment-walkthrough-settled.md).

## Context

`myvideogamelist.net` answers nothing. Its zone is in Route 53 in `mvgl-prod` (0044), with the mail
records and the delegation of `dev.` in it and no address record at the apex or at `www`, and
production is #98, which is not paid for yet. Four things want an address that answers before then:

- **The Discord server and the repository**, which want somewhere to send people that says what this
  is.
- **A first crawl.** A search engine takes weeks to come round to a new domain, and the visit is
  better spent on a page than on nothing.
- **A Search Console property**, which 0036 left to the infrastructure and #98 owned, as the last of
  D8, until this record. A Domain property is verified by a TXT record in the zone, and is then the
  place to submit a sitemap and to see what the crawl made of it.
- **The condition 0044 put on asking SES for production access**: something live at the domain.

## Decision

### 1. A static page, not the application

One HTML page and its 404, a stylesheet, a favicon, a share image, `robots.txt` and a sitemap, in
`holding/site`, from a private S3 bucket through CloudFront. No server, no script, no cookie, no
analytics, and nothing from another origin.

The application was the alternative, and it is the wrong size. Production's own list in #98 —
private subnets behind NAT, Multi-AZ, an approval gate — comes before it serves anybody, and dev,
always on, is about $74 a month (0044). This costs cents.

### 2. The apex is canonical, and `www` redirects to it

This is #98's open question, which D1 put as "pick one and be consistent". It is answered now,
because the holding page is the first thing to answer at either name, and a browser keeps a 301 for
good.

- **The domain is the name people say and type**, and every environment is already named off it:
  `dev.myvideogamelist.net`, from `Site.Host`.
- **The usual reason for `www` does not apply.** A zone apex cannot be a CNAME, but a Route 53
  alias record points the apex at CloudFront as a CNAME would point `www`.
- **The cost accepted:** the apex is tied to a DNS host that can alias it, Route 53 today.

So `www` answers with a 301 to the same path and query on the apex. Every other name the
distribution can be reached by gets the same, its own `cloudfront.net` name included, so the page
has one address. **When production takes the domain, its App stack keeps that redirect.**

**This also answers D7, against its wording.** D7 asked for the Identity cookie's domain to be set
explicitly, which it said mattered once `www` and the apex both resolve to the app. With `www` only
redirecting, that never happens, so the cookie keeps no `Domain` attribute, as today, and stays
host-only. `Domain=myvideogamelist.net` would now be the mistake: browsers would send production's
session cookie to `dev.` as well.

### 3. One stack, whole in us-east-1, in the production account

`Mvgl-prod-Holding` holds:

- the certificate, validated by DNS, for the apex and `www`;
- the bucket, read through origin access control, which the stack empties before it deletes it;
- the distribution, its function and its response headers policy;
- the four alias records;
- the deployment of `holding/site`.

CloudFront takes its certificate from us-east-1 only, so the stack lives there whole. That means
no cross-region reference, no order to deploy in, and one CDK bootstrap — in the Region production's
own certificate stack will need anyway. None of 0044's reasons for Frankfurt reach the bucket: it
holds a public page and nothing about anybody, and the edge serves it.

`env=prod` synthesises this stack and nothing else until #98. In particular no `Dns` stack is ever
synthesised for production. It would create a second zone named for the domain instead of looking
up the real one, which is what 0044 says production does.

### 4. What the distribution does with a request

- **A viewer-request function** sends the redirect of §2, and appends `index.html` to a URI that
  ends in `/`.
- **The bucket can be read but not listed.** S3 then answers a missing key with a 403, so the
  distribution turns both 403 and 404 into `/404.html` with a 404, kept for a minute as the app's own
  404 is. Granting list would let S3 say 404 itself, and would also serve the bucket's listing to
  anybody who asked for its root, should the function ever stop rewriting `/`.
- **Every file is sent `public, max-age=300, s-maxage=86400`.** Each deploy replaces the bucket's
  contents, then invalidates `/*` and waits for the invalidation to finish.
- Price class 100, TLS 1.2 (2021) at least, HTTP/2 and 3, and IPv6, as dev's distribution has.

### 5. What a crawler is told

Everything 0036 says, as an indexable deployment says it:

- `robots.txt` disallows nothing and names the sitemap.
- The sitemap lists the one URL, as a `<loc>` alone, at `/sitemap.xml`. That is the address the
  app's sitemap index will take over, so the address submitted to Search Console never changes.
- The page's head is `pageMeta`'s set — title, description, canonical, Open Graph and the large
  card — plus the share image's size.
- The 404 is a real 404. `/404.html` itself is an object, so it answers 200, and says `noindex`.

The share image is the holding page's own, rendered from `holding/share`. The app's default share
image is still [#139](https://github.com/ChronosSF/myvideogamelist/issues/139).

### 6. The headers

The app's document set, from `entry.server.tsx` and 0033 §5: `nosniff`,
`strict-origin-when-cross-origin`, and `DENY` on framing. To it, two things:

- **A stricter content policy than an app document can carry**, because this page has no script:
  `default-src 'none'`, with the page's own stylesheet and favicon allowed, `base-uri` and
  `form-action` closed, and `frame-ancestors 'none'`.
- **HSTS as 0033 states it**: a year, subdomains included, preload off. The app's documents do not
  send it yet (#109), so this is the first response at the apex that does, and it commits the
  domain to more than "use HTTPS":
  - **Every name under the domain, at any depth** — `www.`, `dev.`, anything under `dev.`, and any
    name added later — from a browser's first HTTPS response from the apex, a stylesheet included.
  - **A certificate error on any of them is a wall.** A browser holding the policy refuses an
    invalid, expired or mismatched certificate with no way to click past it (RFC 6797 §8.4, §12.1).
  - **Each response restarts the year** (§6.1.1), so the commitment outlives this stack: destroying
    it withdraws nothing. Only `max-age=0` sent from the apex would, and only to browsers that come
    back for it. Production's apex goes on sending the policy, which #109 asks of the app anyway.
  - **Mail is unaffected**: MX, SPF, DKIM, DMARC and a MAIL FROM name are DNS, never fetched over
    HTTP. A custom open and click tracking domain for SES is the exception. On the plain-HTTP setup
    SES documents first, a CNAME to its tracking host, every tracked link fails for anybody who has
    seen this page, so #100 has to use the HTTPS setup, with `HttpsPolicy: REQUIRE`.

### 7. The Search Console record belongs to the zone, not the stack

Verification is a TXT record at the apex, added by hand. Google re-checks it now and then and asks
for it never to be removed, and this stack is destroyed at #98, so the record must not be one of its
resources. The same holds for anything else the domain needs beyond the page.

### 8. When it retires

At #98, when the App stack takes the domain. A CloudFront alternate domain name belongs to one
distribution at a time — a second is refused with `CNAMEAlreadyExists` — and the four records would
collide in the same way. So the order is:

1. destroy `Mvgl-prod-Holding`, which empties its bucket on the way;
2. deploy production's App stack with both names, keeping §2's redirect.

The minutes between are the domain with no answer, which before launch costs nothing. AWS documents
a same-account move of a name from one distribution to another, `aws cloudfront
update-domain-association` (the CloudFront guide's "Move an alternate domain name"), one name per
call. The records still change hands with the stacks, so it would shorten the gap rather than remove
the order.

What stays behind is meant to, or is harmless:

- the Search Console record (§7) and the sitemap's address, which production takes over as they are;
- the CDK bootstrap, which production's certificate stack reuses;
- the certificate's two validation records, which CloudFormation does not remove, and the log group
  of the hook that empties the bucket, which Lambda makes and nothing deletes;
- in browsers, HSTS (§6) and the 301 from `www` (§2), neither of which is retired with the stack.

## Consequences

- **The production account gets its first CDK bootstrap**, in us-east-1, before this deploys.
  Production's certificate stack will use the same one; Frankfurt's is still #98's.
- **The cost is cents.** The zone was already paid for, and ACM certificates and alias queries to
  CloudFront are free. CloudFront's Always Free tier — a terabyte, ten million requests and two
  million function invocations a month — is the Organization's, shared with dev and the other
  application, and a holding page barely touches it; at list price it would still be cents. The
  deployment's Lambda runs only when the page is deployed.
- **It is deployed by hand**, as the other long-lived stacks are, and no pipeline reaches the
  production account. A change to the page is a change to `holding/site` and the same deploy.
- **The first synthesis with production's credentials writes the zone lookup into
  `cdk.context.json`**, which is committed, as dev's lookups are.
- **The tokens are copied from `theme.css` by value**, and the Discord invite from
  `DISCORD_INVITE_URL`. A change to either does not reach the page by itself.
- **Not here:** analytics of any kind — Search Console's reports are the measure — a contact
  address, and a mailing list.
