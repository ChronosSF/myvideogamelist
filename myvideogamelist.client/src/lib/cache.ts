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
 * Whether a shared cache may store a response sent with this `Cache-Control`.
 *
 * True unless it says `private` or `no-store` in so many words, so that a missing header counts as
 * shared: `entry.server.tsx` sends such a document whole rather than streaming it (ADR 0053), and
 * the direction to be wrong in is the one that costs a slower first byte. `private="Set-Cookie"`
 * names fields rather than the response, which stays storable, so it counts as shared too.
 */
export function mayBeShared(cacheControl: string | null): boolean {
    return !(cacheControl ?? '')
        .split(',')
        .some((directive) => /^(?:private|no-store)$/i.test(directive.trim()));
}

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
 * The home page. Short, because the news and the release panels are the reason to visit.
 *
 * Total staleness is this plus the server's own 15-minute `/api/home` cache: fifteen minutes in
 * the API, five fresh at the edge and up to ten more served stale while the edge revalidates, so
 * roughly half an hour worst case. Shortening this alone would not make the page fresher — the API
 * cache is the binding constraint and would have to come down with it.
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
 * string. **The CloudFront cache policy must include `search`, `sort`, `platform`, `genre`, `year`,
 * `minScore` and `esrb` in the cache key**, or every visitor is served whichever listing happened to
 * populate the edge first — and a parameter left out of it is not even sent to the origin, so the
 * filter is dropped from every render rather than only from the shared copy. `@/lib/gameBrowse` is
 * the list of what the page reads, and `infra/src/Infra/Edge.cs` is the policy.
 */
export const CACHE_GAMES_LIST = sharedCache(600, 3600);

/**
 * Public profile pages.
 *
 * Shared-cacheable at all, which is worth stating because the page is about one person: it is
 * identical for every reader, signed in or not, because the API behind it varies on nothing but
 * the username in the URL. The owner's own private figures are a different route.
 *
 * It also varies on `?page=`, which pages the reviews. **The CloudFront cache policy must include
 * `page` in the cache key** for this route, exactly as `search` for the listing above.
 *
 * Shorter than a game page, longer than the home page. A profile changes whenever its owner
 * finishes something, and the first person to notice a stale one is its owner — but they are also
 * the one person for whom a five-minute wait is explicable, and the acquisition case (ROADMAP D8)
 * wants crawlers hitting the edge rather than the origin.
 *
 * **A withdrawal does not wait for this window.** A profile switched back to private, renamed or
 * deleted, and a review its author makes private, edits or deletes, would otherwise stay servable
 * from the edge for all of it, since the page renders review bodies and the old text sits in the
 * cached HTML and its `.data` URL. The API invalidates `/u/{name}*` after each of those writes,
 * and the profile sitemap files on the first three (ADR 0058). This policy is the window only when
 * that fails, and the API's retry stops at the end of it — **so lengthening this has to lengthen
 * `CloudFrontEdgeInvalidator.Horizon` on the server too**, or a long CloudFront outage gives up while
 * a withdrawn page is still being served. Shortening it would narrow the window without closing
 * it — see ADR 0027.
 *
 * **`stale-if-error=0` is what makes it a window.** Without it, CloudFront answers a 5xx from the
 * origin by serving the expired copy it still holds, for as long as the cache policy's maximum TTL
 * allows — a year here — so a page whose invalidation failed could come back during any later
 * outage, long after its owner withdrew it. With it, an outage shows the error instead.
 */
export const CACHE_PROFILE = `${sharedCache(300, 3600)}, stale-if-error=0`;

/**
 * Pages whose words change only with a deploy: the terms. A game page's window, since a changed page
 * that takes an hour to be believed costs nobody anything.
 */
export const CACHE_STATIC_PAGE = sharedCache(3600, 86_400);

/**
 * Not-found responses. Cached briefly so a crawler hammering dead URLs does not reach the
 * origin every time, but not so long that a newly valid URL stays 404 at the edge.
 */
export const CACHE_NOT_FOUND = sharedCache(60, 300);

/**
 * robots.txt. It is a function of the deployment's configuration and nothing else, so it changes
 * only with a deploy — and an hour is how long a changed one may take to be believed.
 */
export const CACHE_ROBOTS = sharedCache(3600, 86_400);

/**
 * The sitemap index, the static pages and the game files. A game page's own window, because a
 * crawler learning of a new game an hour late loses nothing.
 *
 * **The profile files do not use this.** They use `CACHE_PROFILE`, so that a sitemap never goes on
 * naming a profile for longer than the profile's own page could have been served — a profile
 * switched back to private is a withdrawal of consent, and the API invalidates the files beside the
 * page for that reason (ADR 0058).
 */
export const CACHE_SITEMAP = sharedCache(3600, 86_400);
