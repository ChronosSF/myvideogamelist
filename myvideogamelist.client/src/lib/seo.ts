import type { MetaDescriptor } from 'react-router';
import { applySecurityHeaders } from '@/lib/securityHeaders';

/**
 * What a crawler or a link unfurler is told about this site, and by which deployment.
 *
 * Two facts decide nearly everything here, and both come from the environment rather than the
 * build, because one image is built once and deployed to dev and then to production
 * (ROADMAP §6): where this deployment is publicly reachable, and whether it wants to be indexed.
 * See `docs/decisions/0036-what-a-crawler-is-told.md`.
 */

export const SITE_NAME = 'MyVideoGameList';

export interface SiteConfig {
    /** The public origin with no trailing slash, or null when `SITE_URL` is unset or unusable. */
    siteUrl: string | null;
    /** Whether this deployment asks to be indexed. */
    indexable: boolean;
}

let warnedAboutOrigin = false;

/**
 * Reads the two variables. **Server only** — it is called from loaders, resource routes and
 * `entry.server.tsx`, and travels to the browser as loader data, the way `apiUrl()`'s base never
 * has to.
 *
 * `SITE_URL` is the origin the public sees, such as `https://myvideogamelist.net`. It is
 * configuration and never the request's own origin, because behind a CDN and a load balancer the
 * request names whichever of them spoke to this process last, and a canonical URL pointing at an
 * internal hostname is worse than none.
 *
 * `SITE_INDEXABLE` must be exactly `true`, and needs `SITE_URL` beside it. **Forgetting fails
 * closed**, the way a route that forgets its `Cache-Control` does: a production deployment that
 * is missing either one goes unindexed, which is visible in one `curl -I` and costs days, whereas
 * a staging deployment indexed by accident competes with production for every page it has.
 */
export function siteConfig(env: Record<string, string | undefined> = process.env): SiteConfig {
    const siteUrl = originFrom(env.SITE_URL);
    const wantsIndexing = env.SITE_INDEXABLE === 'true';

    if (wantsIndexing && siteUrl === null && !warnedAboutOrigin) {
        warnedAboutOrigin = true;
        console.warn('SITE_INDEXABLE is true but SITE_URL is missing or not a URL; staying unindexed.');
    }

    return { siteUrl, indexable: wantsIndexing && siteUrl !== null };
}

/** The origin of a configured URL. A path or a trailing slash on it is dropped rather than kept. */
function originFrom(raw: string | undefined): string | null {
    if (!raw) return null;

    try {
        const url = new URL(raw);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
    } catch {
        return null;
    }
}

/**
 * Says `noindex` on a response from a deployment that is not for indexing.
 *
 * A header rather than a `Disallow` in robots.txt, and deliberately not both. A crawler that is
 * refused by robots.txt never requests the page, so it never sees a `noindex` on it, and the bare
 * URL can still be listed if anything links to it. Letting it crawl and telling it no is the only
 * one of the two that keeps a staging site out of an index (ROADMAP D3).
 */
export function applyIndexingHeaders(headers: Headers, site: SiteConfig = siteConfig()): Headers {
    if (!site.indexable) headers.set('X-Robots-Tag', 'noindex, nofollow');
    return headers;
}

/**
 * A response that is not a document: robots.txt and the sitemaps.
 *
 * These are resource routes, which return their own `Response` and so never pass through
 * `entry.server.tsx`. Whatever that file adds to every document has to be added here by hand.
 */
export function resourceResponse(
    body: string,
    contentType: string,
    cacheControl: string,
    status = 200,
): Response {
    const headers = new Headers({ 'Content-Type': contentType, 'Cache-Control': cacheControl });
    applySecurityHeaders(headers);
    applyIndexingHeaders(headers);

    return new Response(body, { status, headers });
}

/**
 * robots.txt, for either kind of deployment.
 *
 * Nothing is disallowed in either. The per-user pages are kept out of an index by a `noindex` of
 * their own, and `/api/` by a header the API sends, for the reason above — and because a crawler
 * that renders a page has to be able to fetch what the page fetches.
 */
export function robotsTxt(site: SiteConfig): string {
    if (!site.indexable) {
        return [
            '# This deployment is not for indexing, and says so in an X-Robots-Tag header on every',
            '# response. Crawling is allowed on purpose: a crawler refused here never sees that header.',
            'User-agent: *',
            'Disallow:',
            '',
        ].join('\n');
    }

    return [
        'User-agent: *',
        'Disallow:',
        '',
        `Sitemap: ${site.siteUrl}/sitemap.xml`,
        '',
    ].join('\n');
}

/** For a page that is one person's own view of their account. Nothing on it is for a stranger. */
export const NOINDEX: MetaDescriptor = { name: 'robots', content: 'noindex' };

export interface PageImage {
    url: string;
    alt: string;
    /**
     * Whether the image is landscape. A large card crops to roughly two to one, which suits key art
     * and cuts a portrait cover down to a strip across its middle.
     */
    wide: boolean;
}

export interface PageMeta {
    site: SiteConfig;
    /** The document title, in full. */
    title: string;
    description: string;
    /**
     * The one address this page answers to, from the site root and including any query string that
     * picks a different document. **Built from the data, never from the request**: `/games/0012`
     * and `/u/ALICE` both render, and the canonical URL is what says they are `/games/12` and
     * `/u/alice`. Omit it on a page that is `noindex` — the two together are mixed signals.
     */
    path?: string;
    /** Open Graph's own list, which has no type for a game: https://ogp.me/#types */
    type?: 'website' | 'profile';
    image?: PageImage | null;
}

/**
 * The tags every indexable page carries, so that no page states half of them.
 *
 * A leaf route's `meta` replaces its parents' rather than merging with them, so the site-wide
 * tags cannot live on the root and have to be returned by each page.
 */
export function pageMeta({ site, title, description, path, type = 'website', image }: PageMeta): MetaDescriptor[] {
    const url = path !== undefined && site.siteUrl !== null ? `${site.siteUrl}${path}` : null;

    return [
        { title },
        { name: 'description', content: description },
        ...(url ? [{ tagName: 'link', rel: 'canonical', href: url } as const] : []),
        { property: 'og:site_name', content: SITE_NAME },
        { property: 'og:type', content: type },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(url ? [{ property: 'og:url', content: url }] : []),
        ...(image
            ? [
                { property: 'og:image', content: image.url },
                { property: 'og:image:alt', content: image.alt },
            ]
            : []),
        { name: 'twitter:card', content: image?.wide ? 'summary_large_image' : 'summary' },
    ];
}
