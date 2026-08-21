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
