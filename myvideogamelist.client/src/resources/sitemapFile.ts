import { CACHE_PROFILE, CACHE_SITEMAP } from '@/lib/cache';
import {
    sitemapFeed,
    sitemapFileFrom,
    sitemapNotFound,
    sitemapOrigin,
    sitemapUnavailable,
    sitemapXml,
    urlSet,
} from '@/lib/sitemap';
import type { Route } from './+types/sitemapFile';

/**
 * The pages that are the same for everybody and worth arriving at from a search. The per-user
 * routes are not here and are `noindex`; a searched or filtered `/games` is too.
 */
const STATIC_PATHS = ['/', '/games'];

/**
 * `/sitemaps/pages.xml`, `/sitemaps/games-N.xml` and `/sitemaps/profiles-N.xml`.
 *
 * Every URL written here has to be the one the page itself gives as canonical, character for
 * character, or the two disagree about what the page is called. For a game that is the id as a
 * plain integer; for a profile it is the name as its owner capitalised it, which is what the API
 * returns and what `ProfilePage` builds its canonical URL from.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
    const file = sitemapFileFrom(params.file);
    if (file === null) return sitemapNotFound();

    const origin = sitemapOrigin(request);

    if (file.kind === 'pages') {
        return sitemapXml(urlSet(STATIC_PATHS.map(path => `${origin}${path}`)), CACHE_SITEMAP);
    }

    if (file.kind === 'games') {
        const ids = await sitemapFeed<number[]>(`/api/sitemap/games?page=${file.page}`);
        if (ids === null) return sitemapUnavailable();

        // Past the last file. The index never names one, so this is a URL somebody made up.
        if (ids.length === 0) return sitemapNotFound();

        return sitemapXml(urlSet(ids.map(id => `${origin}/games/${id}`)), CACHE_SITEMAP);
    }

    const names = await sitemapFeed<string[]>(`/api/sitemap/profiles?page=${file.page}`);
    if (names === null) return sitemapUnavailable();
    if (names.length === 0) return sitemapNotFound();

    // The profile page's own window rather than the sitemap's, so that this file cannot go on
    // naming a profile for longer than the profile itself could have been served. See `cache.ts`.
    return sitemapXml(
        urlSet(names.map(name => `${origin}/u/${encodeURIComponent(name)}`)),
        CACHE_PROFILE,
    );
}
