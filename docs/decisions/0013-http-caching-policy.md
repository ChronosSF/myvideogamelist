# 0013. Every route declares its own `Cache-Control`

**Status:** Implemented

## Context

SSR in this app is per-request: React Router runs the loader and rebuilds the HTML on every
hit, so a server-rendered page cannot go stale the way a build-time snapshot can. Verified —
three requests to `/` produced three `/api/home` calls. Nothing is prerendered; the config is
only `ssr: true`.

Staleness therefore lives entirely in the server-side data caches, not the render. That stops
being true the moment CloudFront ([0007](0007-aws-target-architecture.md)) sits in front of the
SSR server: cached HTML *is* a timed snapshot, and the question "what is the TTL" becomes real.

The responses carried **no `Cache-Control` header at all**. When an origin sends none, a CDN
falls back to its own default TTL, so the default outcome after deployment would have been the
edge caching pages for hours — including `/lists` and `/user`, which are per-user. That is a
decision worth making deliberately rather than inheriting.

## Decision

Every route declares a policy, defined together in `src/lib/cache.ts`:

| Route | Policy | Why |
|---|---|---|
| `/` | `s-maxage=300, swr=600` | News and trending are the reason to visit |
| `/games` | `s-maxage=600, swr=3600` | Varies by query string |
| `/games/:id` | `s-maxage=3600, swr=86400` | IGDB metadata changes rarely; these are the organic landing pages |
| `/lists`, `/user` | `private, no-store` | Per-user |
| 404s | `s-maxage=60, swr=300` | Cheap protection from crawlers hammering dead URLs |
| 502s, degraded renders | `private, no-store` | See below |

Every shared policy is `max-age=0, s-maxage=N`: browsers revalidate on each navigation while
the CDN holds one copy for everyone. A visitor should never be served their own stale copy of a
page whose point is being current, but a thousand visitors can share one render.

**The root's policy is `private, no-store`,** so a route that declares nothing fails closed. The
cost of forgetting is a slow page, not one user seeing another's.

`stale-while-revalidate` matters more than the TTL at this traffic level: without it most
requests would arrive after expiry and pay full origin latency, which is the cost the tiering
exists to avoid.

## Consequences

- **The CloudFront cache policy must include `search` in the cache key for `/games`,** or
  visitors get whichever search populated the edge first.
- `/lists` and `/user` need a CloudFront behaviour that forwards the auth cookie and does not
  cache — the origin says `no-store`, but relying on that alone is one misconfiguration away
  from serving one user's lists to another.
- Search-result pages carry `noindex, follow`. They are near-infinite in number and thin in
  content; the unfiltered `/games` stays indexable.
- Total home-page staleness is the CDN TTL *plus* the server's 15-minute `/api/home` cache —
  about 20 minutes. Shortening the CDN TTL alone will not make it fresher.

### Three things only the failure path revealed

Testing with the API stopped, rather than only while healthy, found all three:

1. **A thrown `Response`'s headers are discarded.** A 404 asking for a short TTL came back
   `no-store`: the boundary route's `headers` replace the leaf's. The root now reads
   `errorHeaders` and honours a `Cache-Control` the thrown response set.
2. **`fetch` rejects rather than returning `!ok` when the API is unreachable,** so the `502`
   branches never ran and the failure surfaced as an unhandled `500` — misreporting whose fault
   it was. Both game routes now catch and throw a deliberate 502.
3. **The home page degraded to 200 with a five-minute CDN policy.** Its graceful degradation
   ([0012](0012-steam-news-without-a-database.md)) returns an empty payload rather than
   throwing, which meant an IGDB outage would have been pinned at the edge and served long
   after recovery. The loader now attaches `no-store` via `data()` when it degrades, and the
   `headers` export honours it. **Caching a failure outlives the failure.**

## Result

All eight routes verified on the wire, healthy and with the API stopped. Degraded and error
responses are `no-store` in every case.
