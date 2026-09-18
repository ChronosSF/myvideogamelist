import { describe, expect, it } from 'vitest';
import { meta } from '@/pages/GamesPage';
import { EMPTY_BROWSE, type GameBrowse } from '@/lib/gameBrowse';
import type { Route } from './+types/GamesPage';

type Tag = Partial<Record<'title' | 'name' | 'content', string>>;

/** The tags for a URL whose query string is `query`, with the browse the loader parsed out of it. */
function tagsFor(query: string, browse: Partial<GameBrowse> = {}): Tag[] {
    const args = { loaderData: { browse: { ...EMPTY_BROWSE, ...browse } }, location: { search: query } };
    return meta(args as unknown as Route.MetaArgs) as Tag[];
}

const noindex = (tags: Tag[]) => tags.some(tag => tag.name === 'robots' && tag.content?.includes('noindex'));

describe('GamesPage meta', () => {
    it('lets the catalogue with no query string be indexed', () => {
        expect(noindex(tagsFor(''))).toBe(false);
    });

    it('keeps a searched, sorted or filtered listing out of the index', () => {
        expect(noindex(tagsFor('?search=zelda', { search: 'zelda' }))).toBe(true);
        expect(noindex(tagsFor('?sort=newest', { sort: 'newest' }))).toBe(true);
        expect(noindex(tagsFor('?platform=6', { platform: 6 }))).toBe(true);
    });

    it('keeps out a query the loader could not use, which it reads as the plain catalogue', () => {
        // Every one of these parses to the default browse, so a decision made on the browse would
        // index each of them as another copy of the catalogue.
        for (const query of ['?sort=bogus', '?platform=0', '?sort=rating']) {
            expect(noindex(tagsFor(query)), query).toBe(true);
        }
    });

    it('names the search in the title', () => {
        expect(tagsFor('?search=zelda', { search: 'zelda' }))
            .toContainEqual({ title: 'zelda - Browse games - MyVideoGameList' });
    });
});
