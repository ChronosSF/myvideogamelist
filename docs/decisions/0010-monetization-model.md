# 0010. Ad-supported free tier plus a paid subscription

**Status:** Accepted — not yet built

## Context

The project needs a revenue model. Affiliate income was considered and rejected as a
primary source (0009): the arithmetic only works at traffic volumes a new tracker will not
have for a long time.

Trakt, the closest analogue in the tracking space, runs **entirely** on subscriptions and
recently moved from $30 to $60 a year. A few hundred paying users is a more realistic
business than a lot of outbound clicks.

## Decision

Freemium at roughly **$3/month or $25–30/year**. The free tier is ad-supported; the paid
tier removes ads and unlocks depth.

**The core tracking loop stays unlimited and free** — unlimited games, all lists, wishlist,
calendar. Capping the core loop is what kills trackers. Sell depth, convenience and quiet,
not access.

Paid tier: no ads, unlimited custom lists, full stats and yearly recap, unlimited price and
bundle alerts, import re-sync, export, private profile, email notifications.

The strongest paid hooks are the ones with real recurring cost behind them — price alerts,
bundle alerts and import re-sync all run per-user background jobs — so the pricing reflects
actual cost rather than artificial gating.

## Consequences

- Ads only for signed-out and free users. **The cache key must include entitlement**, or a
  paying user eventually receives an edge-cached page with ads baked in.
- Ad slots must reserve height and lazy-load. Ads are the fastest way to wreck LCP and CLS,
  which is precisely the SEO that 0002 exists to earn.
- Never inside the Continue Playing rail, never interstitial, never above the fold on a game
  page. Fall back to a house ad for the paid tier when consent is refused.
- Entitlement should be an authorization policy (`[Authorize(Policy = "Pro")]`), not
  scattered conditionals, and persisted locally rather than inferred from Stripe per request.
- **Never delete data when a subscription lapses** — downgrade to free and keep everything.
- Requires legal pages, cookie consent, and Stripe Tax for EU VAT.
- **Set the free-tier limits before launch.** Trakt took sustained backlash for retroactively
  repricing legacy subscribers and tightening free limits after the fact. If pricing must
  change later, grandfather existing subscribers.

## The line, as drawn — added 2026-09-24

The plan that carried this table has moved to GitHub issues
([0040](0040-what-the-roadmap-decided-on-its-own.md)), so the free/paid line it drew is recorded
here, where the decision is. These are the limits the last consequence above says to set before
launch. Two rows have been overtaken since the table was drawn and are stated as they now stand:
export, which [0024](0024-the-ownership-contract.md) made free in its JSON form; and import, which
`specs/csv-list-import.md` §8 argues belongs on the free side for tracker files, with the recurring
platform re-sync as the paid half. One row is gone: the plan sold a private profile as paid, and
[0027](0027-usernames-and-public-profiles.md) has since made private the default for everyone.

| | Free | Paid |
|---|---|---|
| Games tracked, all lists, wishlist | Unlimited | Unlimited |
| Upcoming calendar, game pages, browse, search | ✅ | ✅ |
| **Ads** | Shown | **Removed** |
| Custom lists | Up to 3 | Unlimited |
| Profile stats | Basic counts | Full charts, score distribution, trends over time |
| Yearly wrapped / recap | — | ✅ |
| Price-drop alerts | 5 tracked games | Unlimited |
| Price history | Current + best price | Full history charts and all-time low |
| Bundle & giveaway alerts | — | ✅ |
| Import | Tracker files, capped — the spec proposes three jobs a month | Platform re-sync, unlimited |
| Export | **JSON, free** — portability is a right (0024) | CSV, re-importable, column selection, scheduled |
| Release notifications | In-app | In-app + email |
| Early access to new features | — | ✅ |
| Supporter badge on profile | — | ✅ |

One caution the table carries now that it did not when it was drawn: the full profile statistics
shipped for everyone ([0023](0023-profile-statistics-derived-at-read-time.md)), so the "basic
counts" split has to be decided before launch or not at all — drawing it afterwards is the
retroactive tightening the last consequence warns against.

Two rules the plan stated beside the table, to read with the consequences above: **one ad
provider to start** — more providers means more scripts, more consent surface and worse
performance — and **free-tier limits behind feature flags**, so they can be tuned without a deploy.
