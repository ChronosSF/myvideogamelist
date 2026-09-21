import { CACHE_SITEMAP } from '@/lib/cache';
import {
    type SitemapSummary,
    sitemapFeed,
    sitemapFileNames,
    sitemapIndex,
    sitemapOrigin,
    sitemapUnavailable,
    sitemapXml,
} from '@/lib/sitemap';
import type { Route } from './+types/sitemapIndex';

/**
 * `/sitemap.xml` — the index, naming one file of static pages and as many files of games and of
 * profiles as there are games and profiles to fill.
 *
 * An index from the first day, though one file would hold everything for a long while yet: the
 * address a search console is given, and the one robots.txt names, should not have to change on
 * the day the list outgrows a single file.
 *
 * Served here rather than by the API because a sitemap belongs at the site's root and the API
 * serves `/api/*` and nothing else (ADR 0003). The API supplies the counts; see
 * `SitemapController`.
 */
export async function loader({ request }: Route.LoaderArgs) {
    const summary = await sitemapFeed<SitemapSummary>('/api/sitemap');
    if (summary === null) return sitemapUnavailable();

    const origin = sitemapOrigin(request);
    const files = sitemapFileNames(summary).map(name => `${origin}/sitemaps/${name}`);

    return sitemapXml(sitemapIndex(files), CACHE_SITEMAP);
}
