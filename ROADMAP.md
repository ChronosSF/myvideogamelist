# Where the plan lives

MyVideoGameList's plan is its GitHub issues, not this file. This file is the index: how the
issues are organised, what deliberately is not an issue, and where each identifier the old plan
handed out now points — because code comments and decision records still cite them. Why the plan
moved is [0040](docs/decisions/0040-what-the-roadmap-decided-on-its-own.md).

## The issues

- **`feature`** — product work that is not built yet. `.github/ISSUE_TEMPLATE/feature.md` says
  what one contains: what, why now, what is already decided (with links), what blocks it, and the
  open questions.
- **`platform`** — deployment, operations, resilience and quality gates.
- **`question`** — a decision still open, with no feature attached to it.
- **`needs: aws`**, **`needs: email`**, **`needs: itad`** — the gate the issue waits behind: an
  environment on AWS, a transactional email sender, an IsThereAnyDeal key. Each gate is an issue
  of its own, and the pinned issue names the ones only the owner can open.
- The pinned **What's next** issue (#147) holds the order.

`gh issue list --label feature` from a checkout, or the Issues tab. A follow-up noticed mid-task
goes into an issue — a new one, or a checklist line on the feature's — never into this file.

## What is not an issue

- **Why the code is the way it is** — [`docs/decisions/`](docs/decisions/README.md).
- **What a feature must do** — [`specs/`](specs/), living documents amended when the
  implementation changes the rule.
- **The schema the open issues imply**, by table — [`docs/data-model-plan.md`](docs/data-model-plan.md).
- **The product's shape** — the free/paid line is drawn in
  [0010](docs/decisions/0010-monetization-model.md), IsThereAnyDeal in
  [0009](docs/decisions/0009-itad-without-affiliate-revenue.md), the AWS target in
  [0007](docs/decisions/0007-aws-target-architecture.md),
  [0014](docs/decisions/0014-rds-postgresql-over-aurora.md) and
  [0015](docs/decisions/0015-fargate-confirmed-and-nat-less-networking.md).
- **The route to the first deployment** — `docs/deployment/dev-environment.md`, a step-by-step
  guide with decisions of its own, numbered `D-1`…`D-8` with a hyphen: not the `D` identifiers
  below.

## The old identifiers

The plan this file replaced numbered its items, and the citations survive in code comments and
records. This table keeps them resolvable. A retired identifier is never reused; the plan itself
is in the history (`git log -p -- ROADMAP.md`).

### Home page (H), Steam news (N) and the §3 sections

| ID | Was | Now |
|---|---|---|
| H1 | Fork the home page on auth | Done — [0027](docs/decisions/0027-usernames-and-public-profiles.md) §11 |
| H2 | Drop the "Rate" feature card | Done, with the home page redesign |
| H3 | Continue Playing rail | Done — 0027 §11; `ContinuePlayingRail.tsx` |
| H4 | "Your week", built as the Releasing soon rail | Done — `releasingSoon.ts` and `ReleasingSoonRail.tsx` say why it covers the whole window |
| H5 | Play-next picker | Done — `PlayNextPicker.tsx` |
| H6 | Stats strip | Done — `HomeStatsStrip.tsx` |
| H7 | Trending rail | Done — [0012](docs/decisions/0012-steam-news-without-a-database.md) |
| H8 | Events banner from IGDB `events` | #128 |
| H9 | News for your games | Done — N5 |
| N1 | IGDB → Steam AppID map | Done — 0012; `CLAUDE.md` on `external_game_source` |
| N2 | Steam news fetch | Done — 0012 |
| N3 | Background refresh into the cache | #102 |
| N4 | Game-page news panel | Done — `GameNewsPanel.tsx` |
| N5 | Home-page news rail | Done — `HomeService.cs`, two items per game |
| N6 | The `/news` page | Done — `TrackedNewsService.cs` says why the order is the feature |
| N7 | Degrade for games with no Steam presence | Done — `GameNewsPanel.tsx` |
| §3.2 | Signed-out landing | Done, less the sign-up call to action on the rails — #127 |
| §3.3 | Calendar accuracy | Done — [0004](docs/decisions/0004-release-dates-for-calendar.md); the month view is #129 |
| §3.4 | Steam news | N1–N7 above; RSS was considered and parked — 0040 |
| §3.5 | `/api/home` as one endpoint | Done — 0012's Result; `IHomeService.cs` on what stays out of it |

### Domain, email and SEO (D)

| ID | Was | Now |
|---|---|---|
| D0 | AWS account setup, before anything | #97 — Phases 0 and 1 of the guide |
| D1 | Route 53 zone | #97 |
| D2 | ACM certificate in `us-east-1` | #97 |
| D3 | `dev.` subdomain with `noindex` and basic auth | `noindex` done — [0036](docs/decisions/0036-what-a-crawler-is-told.md); basic auth #97 |
| D4 | SES on a verified domain | #100 |
| D5 | SES production access, requested early | #100 |
| D6 | OAuth redirect URIs on the real domain | #111 |
| D7 | Identity cookie domain | #98 |
| D8 | `robots.txt`, sitemap, canonical URLs | Done — 0036; the search console registration is #98 |
| D9 | Open Graph and Twitter cards | Done — 0036; the default share image is #139 |
| D10 | Server-side rendering | Done — [0002](docs/decisions/0002-server-side-rendering.md) |
| D11 | Bounce and complaint handling | #100 |
| D12 | CloudFront behaviours matching the per-route `Cache-Control` | #97 — Phase 10 of the guide |
| D13 | Behaviours written against React Router 8's `.data` URLs | #97 — Phase 10; [0011](docs/decisions/0011-react-router-8-upgrade.md) |
| D14 | CloudFront invalidation when a profile is withdrawn | #99 |

### Price tracking (P), monetisation (M) and ads (A)

| ID | Was | Now |
|---|---|---|
| P1 | An ITAD app and key | #110 |
| P2, P3, P4, P9, P10, P11 | Where to buy: mapping, current price, all-time low, cached refresh, attribution, console-only degrade | #131 |
| P5, P6 | Wishlist price-drop alerts, per-user threshold and region | #132 |
| P7, P8 | Deals page, bundle and giveaway alerts | #133 |
| M1–M7 | Stripe, webhooks, entitlement policy, dunning, tax, portal, flags | #142 |
| M8, M9 | Legal pages, attribution and cookie consent | #141 |
| A1–A6 | Ad placement discipline | #143; the rules themselves are in 0010 |

### Sections and phases

| ID | Was | Now |
|---|---|---|
| §1 | Eleven structural issues | All fixed but the half-wired social login — #111 |
| §2 | Tiers 1–3 | The `feature` issues |
| §4 | Monetisation | The table is in 0010; the work is M and A above |
| §5 Data & state | PostgreSQL, migrations, keys, cache | PostgreSQL and the migration gate are done — [0008](docs/decisions/0008-postgresql-over-sqlite.md), `CLAUDE.md`; the keys and the migration step are #97; #101; #102 |
| §5 Resilience | Retry, breaker, limits, lockout, CSRF, headers, errors | Done — [0033](docs/decisions/0033-what-the-api-refuses.md), [0034](docs/decisions/0034-failing-in-one-shape.md); `script-src` is #108; edge rate limiting is #109 |
| §5 Observability | Health, logs, traces, alarms, `/version` | Health endpoints done; the rest is #103 |
| §5 Quality gates | Tests, CI, scanning, branch protection | Unit tests and CI on push are done; #104, #105, #106, #107 |
| §6 | AWS deployment | 0007, 0014, 0015 and the guide; #97, #98, #109 |
| §7 | Sequencing | The pinned issue #147 |
| Phase 0 | Clean the foundation | Done |
| Phase 1 | Make it deployable | #97 |
| Phase 2 | Make it a real tracker | Done, less the email flows — #112 |
| Phase 3 | The home page | Done, less H8 |
| Phase 4 | Make it cool | The `feature` issues |
| Phase 5 | Monetise | #141 first, then #142, then #143 |
