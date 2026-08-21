# 0009. Integrate IsThereAnyDeal and forgo the affiliate revenue

**Status:** Accepted — not yet built

## Context

Price comparison and wishlist price-drop alerts are among the most valuable features a
backlog tracker can offer. IsThereAnyDeal's API covers 50+ stores with price history,
bundles and giveaways, and is the obvious way to build them.

Their terms require store URLs to be passed through unmodified — and the affiliate tags in
those URLs are **ITAD's**. Using their API therefore means handing them the commission on
every outbound purchase.

Building the same feature without ITAD would mean integrating each store individually and
signing separate affiliate agreements.

## Decision

Integrate ITAD and accept that we earn nothing from outbound store clicks. Pass their URLs
through verbatim, tags intact, and attribute them as their terms require.

**No affiliate programme of our own.** Revenue comes from subscriptions and ads (0010).

## Rationale

The feature is worth more to users than the commission would be to us. Realistically, a
5–10% cut of a ~$30 game at a 1–3% click-to-purchase rate needs serious traffic to matter:
ten thousand outbound clicks a month is roughly $150–900. Trakt, the closest analogue in
this space, runs entirely on subscriptions.

Worth knowing for completeness: **Steam has no affiliate programme at all** — Valve runs no
public referral scheme, and anything claiming otherwise is a third-party key reseller.
Programmes that do exist are Fanatical (~12%), Humble (~10%), Epic's Support-A-Creator (5%)
and Green Man Gaming (~5%).

## Consequences

- Zero revenue from a feature that drives purchases. Accepted deliberately.
- Price alerts and bundle/giveaway alerts become paid-tier hooks instead (0010) — they run
  per-user background jobs, so charging for them is honest rather than artificial.
- ITAD is **PC-centric**. Console-exclusive titles will have no store coverage, and the
  panel must hide rather than error.
- Matching is by Steam AppID via IGDB's `external_games` endpoint, which is far more
  reliable than title matching.
