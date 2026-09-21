import { describe, expect, it } from 'vitest';
import { meta } from '@/pages/ProfilePage';
import type { Route } from './+types/ProfilePage';

type Tag = Partial<Record<'title' | 'name' | 'property' | 'content' | 'rel' | 'href', string>>;

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

/**
 * The tags for a profile, given only the figures `meta` reads. The rest of the document is the
 * component's business and is left out, which is what the cast is for.
 */
function tagsFor({ userName = 'AliceInChains', page = 1, recorded = 12, favourites = 0 } = {}): Tag[] {
    const profile = {
        userName,
        favourites,
        library: { tracked: recorded, recorded, byStatus: { finished: 3 } },
    };

    return meta({ loaderData: { profile, page, site: SITE } } as unknown as Route.MetaArgs) as Tag[];
}

const canonical = (tags: Tag[]) => tags.find(tag => tag.rel === 'canonical')?.href;
const noindex = (tags: Tag[]) => tags.some(tag => tag.name === 'robots' && tag.content?.includes('noindex'));

describe('ProfilePage meta', () => {
    it('calls itself by the name as its owner wrote it, not as the URL was typed', () => {
        // The lookup ignores case, so `/u/aliceinchains` and `/u/ALICEINCHAINS` both render. The
        // name here is the API's answer, and it is the spelling the sitemap lists too.
        expect(canonical(tagsFor())).toBe('https://myvideogamelist.net/u/AliceInChains');
    });

    it('gives each page of reviews its own canonical URL, and the first page none of the query', () => {
        expect(canonical(tagsFor({ page: 3 }))).toBe('https://myvideogamelist.net/u/AliceInChains?page=3');
        expect(canonical(tagsFor({ page: 1 }))).toBe('https://myvideogamelist.net/u/AliceInChains');
    });

    it('says whose profile it is in Open Graph terms', () => {
        const tags = tagsFor();

        expect(tags).toContainEqual({ property: 'og:type', content: 'profile' });
        expect(tags).toContainEqual({ property: 'profile:username', content: 'AliceInChains' });
    });

    it('keeps a published profile with nothing on it out of the index', () => {
        // The same test `SitemapService.ListedProfiles` applies on the server. A page listed in the
        // sitemap and marked noindex is reported as an error, so the two must not disagree.
        const empty = tagsFor({ recorded: 0, favourites: 0 });

        expect(noindex(empty)).toBe(true);
        expect(canonical(empty)).toBeUndefined();
    });

    it('indexes a profile whose only content is a shelf of favourites', () => {
        // A favourite needs no entry (ADR 0029), so nothing recorded is not the same as nothing here.
        expect(noindex(tagsFor({ recorded: 0, favourites: 4 }))).toBe(false);
    });
});
