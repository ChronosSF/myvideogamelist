import { apiUrl } from '@/lib/api';
import { CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { resourceResponse, siteConfig } from '@/lib/seo';

/**
 * The two XML documents of the sitemap protocol (https://www.sitemaps.org/protocol.html).
 *
 * Each entry is a `<loc>` and nothing else, on purpose. `<priority>` and `<changefreq>` are ignored
 * by the crawler that matters, and `<lastmod>` is used only while it is verifiably right — which
 * nothing here could promise. A game's `RefreshedAt` is when we last asked IGDB, not when the page
 * changed, and a profile changes with every score, playthrough and favourite, none of which keeps
 * a single timestamp. A date that is sometimes wrong teaches a crawler to ignore all of them.
 */

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

/** The five characters XML reserves. A username's alphabet has none of them; this does not rely on that. */
export function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** A sitemap file: absolute URLs of pages. */
export function urlSet(urls: readonly string[]): string {
    const entries = urls.map(url => `<url><loc>${escapeXml(url)}</loc></url>`);
    return `${XML_DECLARATION}\n<urlset xmlns="${NAMESPACE}">\n${entries.join('\n')}\n</urlset>\n`;
}

/** The index: absolute URLs of sitemap files. */
export function sitemapIndex(urls: readonly string[]): string {
    const entries = urls.map(url => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`);
    return `${XML_DECLARATION}\n<sitemapindex xmlns="${NAMESPACE}">\n${entries.join('\n')}\n</sitemapindex>\n`;
}

/** Which file a name under `/sitemaps/` asks for, or null when it names none. */
export type SitemapFile =
    | { kind: 'pages' }
    | { kind: 'games' | 'profiles'; page: number };

/**
 * Parses `pages.xml`, `games-3.xml`, `profiles-1.xml`.
 *
 * As strict as `pageFrom` and for its reason: `games-01.xml` and `games-1.xml` would otherwise be
 * two URLs for one file, and there are unboundedly many of the first kind.
 */
export function sitemapFileFrom(name: string | undefined): SitemapFile | null {
    if (name === 'pages.xml') return { kind: 'pages' };

    const match = /^(games|profiles)-([1-9]\d{0,8})\.xml$/.exec(name ?? '');
    if (!match) return null;

    return { kind: match[1] as 'games' | 'profiles', page: Number(match[2]) };
}

/** The file names the index lists, given how much there is to list. */
export function sitemapFileNames(summary: { games: number; profiles: number; pageSize: number }): string[] {
    const numbered = (kind: string, count: number) => {
        // An empty file is not valid against the protocol's schema, so a kind with nothing in it
        // is left out of the index rather than listed as a file with no URLs.
        const files = summary.pageSize > 0 ? Math.ceil(count / summary.pageSize) : 0;
        return Array.from({ length: files }, (_, index) => `${kind}-${index + 1}.xml`);
    };

    return ['pages.xml', ...numbered('games', summary.games), ...numbered('profiles', summary.profiles)];
}

/** Mirrors `SitemapSummaryDto`. The page size comes from the server so the two cannot drift. */
export interface SitemapSummary {
    games: number;
    profiles: number;
    pageSize: number;
}

/**
 * The origin every `<loc>` starts with. The protocol requires absolute URLs.
 *
 * The configured one wherever there is one. The request's own is the fallback for a machine with
 * no `SITE_URL`, which is a developer's: a deployment without one is not indexable either, so the
 * internal hostname this would produce there is never offered to a crawler.
 */
export function sitemapOrigin(request: Request): string {
    return siteConfig().siteUrl ?? new URL(request.url).origin;
}

/** One of the API's sitemap feeds, or null when it could not be read. */
export async function sitemapFeed<T>(path: string): Promise<T | null> {
    try {
        const response = await fetch(apiUrl(path));
        return response.ok ? await response.json() as T : null;
    } catch {
        // fetch rejects rather than returning !ok when the API is unreachable.
        return null;
    }
}

export function sitemapXml(body: string, cacheControl: string): Response {
    return resourceResponse(body, 'application/xml; charset=utf-8', cacheControl);
}

/**
 * When the API behind the sitemap did not answer. An error, and uncached, rather than a valid
 * sitemap with nothing in it: a crawler retries a failure, whereas an empty list is an answer, and
 * the answer would be that the site has no pages.
 */
export function sitemapUnavailable(): Response {
    return resourceResponse('Sitemap unavailable.', 'text/plain; charset=utf-8', PRIVATE_NO_STORE, 502);
}

export function sitemapNotFound(): Response {
    return resourceResponse('Not Found', 'text/plain; charset=utf-8', CACHE_NOT_FOUND, 404);
}
