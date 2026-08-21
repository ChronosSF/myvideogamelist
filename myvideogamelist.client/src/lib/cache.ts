/**
 * `Cache-Control` values for server-rendered documents.
 *
 * These exist because of what happens *after* deployment. SSR itself is per-request and cannot
 * go stale, but CloudFront (ADR 0007) sits in front of it, and when an origin sends no
 * `Cache-Control` the CDN falls back to its own default TTL. The default outcome is therefore
 * the edge freezing pages for hours — including per-user ones — by accident rather than by
 * decision. Every route states its policy instead.
 *
 * The split throughout is `max-age=0, s-maxage=N`: browsers revalidate on every navigation
 * while the shared cache holds a copy for N seconds. A visitor should never be served their own
 * stale copy of a page whose whole point is that it is current, but a thousand visitors can
 * share one render.
 */

/**
 * Never store: the response is specific to the signed-in user.
 *
 * This is the default at the root, so a route that forgets to declare a policy fails closed
 * into "do not cache" rather than leaking one user's page to the next visitor. `private` alone
 * would still permit browser-level storage on a shared machine; `no-store` also covers the
 * back button after sign-out.
 */
export const PRIVATE_NO_STORE = 'private, no-store';

/**
 * Cacheable by shared caches for `sMaxAge` seconds, then servable stale for `staleWhileRevalidate`
 * more while the CDN refreshes in the background.
 *
 * `stale-while-revalidate` matters more than the TTL for a site this size: at low traffic most
 * requests would otherwise arrive after expiry and pay full origin latency, which is exactly the
 * cold-start cost the tiering is meant to avoid.
 */
export function sharedCache(sMaxAge: number, staleWhileRevalidate: number): string {
    return `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}

/**
 * The home page. Short, because the news and trending rails are the reason to visit.
 *
 * Total staleness is this plus the server's own 15-minute `/api/home` cache, so roughly 20
 * minutes worst case. Shortening this alone would not make the page fresher — the API cache is
 * the binding constraint and would have to come down with it.
 */
export const CACHE_HOME = sharedCache(300, 600);

/**
 * Game detail pages. The content is IGDB metadata that changes rarely, and these are the pages
 * organic search actually lands on, so they get the longest window.
 */
export const CACHE_GAME = sharedCache(3600, 86_400);

/**
 * The browse and search listing.
 *
 * Shorter than a game page despite similar content, because the response varies by query
 * string. **The CloudFront cache policy must include `search` in the cache key**, or every
 * visitor is served whichever search happened to populate the edge first.
 */
export const CACHE_GAMES_LIST = sharedCache(600, 3600);

/**
 * Not-found responses. Cached briefly so a crawler hammering dead URLs does not reach the
 * origin every time, but not so long that a newly valid URL stays 404 at the edge.
 */
export const CACHE_NOT_FOUND = sharedCache(60, 300);
