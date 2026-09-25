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
([0041](0041-what-the-roadmap-decided-on-its-own.md)), so the free/paid line it drew is recorded
here, where the decision is. These are the limits the last consequence above says to set before
launch. Two rows have been overtaken since the table was drawn and are stated as they now stand:
export, which [0024](0024-the-ownership-contract.md) made free in its JSON form; and import, which
`specs/csv-list-import.md` §8 argues belongs on the free side for tracker files, with the recurring
platform re-sync as the paid half. One row changed sign: the plan sold a private profile as paid,
and [0027](0027-usernames-and-public-profiles.md) has since made private the default for everyone,
so keeping a profile private is free.

| | Free | Paid |
|---|---|---|
| Games tracked, all lists, wishlist | Unlimited | Unlimited |
| Upcoming calendar, game pages, browse, search | ✅ | ✅ |
| **Ads** | Shown | **Removed** |
| Custom lists | Up to 3 | Unlimited |
| Profile statistics | Counts — games tracked, per status, the wishlist's size, favourites, reviews | Everything derived beyond a count: completion rate, mean score and distribution, the monthly chart, streaks, time to finish, hours, the platform and genre breakdowns. Shown to visitors too, when the profile is public — the owner's entitlement decides, never the viewer's |
| Private profile | ✅ — the default, for everyone (0027) | ✅ |
| Yearly wrapped / recap | — | ✅ |
| Price-drop alerts | 5 tracked games | Unlimited |
| Price history | Current + best price | Full history charts and all-time low |
| Bundle & giveaway alerts | — | ✅ |
| Import | Tracker files, capped — the spec proposes three jobs a month | Platform re-sync, unlimited |
| Export | **JSON, free** — portability is a right (0024) | CSV, re-importable, column selection, scheduled |
| Release notifications | In-app | In-app + email |
| Early access to new features | — | ✅ |
| Supporter badge on profile | — | ✅ |

The statistics row was drawn on 2026-09-24, figure by figure, in `specs/profile-statistics-tiers.md`;
#149 builds it. It is the one row that takes something away — the full page shipped free for
everyone ([0023](0023-profile-statistics-derived-at-read-time.md)) — and it is drawn before launch
precisely so that it is not the retroactive tightening the last consequence warns against: nobody
but the owner has an account yet.

Two rules the plan stated beside the table, to read with the consequences above.

**The ad provider is Google AdSense, and there is no plan for a second one.** The plan said "one
provider to start"; the owner's decision (2026-09-24) is one provider full stop. More providers
would mean more scripts, more consent surface and worse performance, and a second one is not
worth any of that on this site. So nothing is built to abstract over providers — an ad slot is an
AdSense slot — and the consent banner in M9 has to satisfy Google's requirements for visitors in
the EEA and the UK, not a generic notion of consent.

**Free-tier limits behind feature flags**, so they can be tuned without a deploy.
