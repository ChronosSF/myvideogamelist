import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { GamesPage, meta } from '@/pages/GamesPage';
import { EMPTY_BROWSE, type GameBrowse } from '@/lib/gameBrowse';
import type { GenreDto, PlatformDto } from '@/types/game';
import { platform } from '@/test/factories';
import type { Route } from './+types/GamesPage';

type Tag = Partial<Record<'title' | 'name' | 'content' | 'rel' | 'href', string>>;

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

/** The tags for a URL whose query string is `query`, with the browse the loader parsed out of it. */
function tagsFor(query: string, browse: Partial<GameBrowse> = {}): Tag[] {
    const args = {
        loaderData: { browse: { ...EMPTY_BROWSE, ...browse }, site: SITE },
        location: { search: query },
    };
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

    it('gives the catalogue a canonical URL, and a listing kept out of the index none', () => {
        // `noindex` beside a canonical URL pointing elsewhere says two different things about the
        // page, and a crawler given both may act on either.
        const canonical = (tags: Tag[]) => tags.find(tag => tag.rel === 'canonical')?.href;

        expect(canonical(tagsFor(''))).toBe('https://myvideogamelist.net/games');
        expect(canonical(tagsFor('?sort=newest', { sort: 'newest' }))).toBeUndefined();
    });

    it('names the search in the title', () => {
        expect(tagsFor('?search=zelda', { search: 'zelda' }))
            .toContainEqual({ title: 'zelda - Browse games - MyVideoGameList' });
    });
});

const PLATFORMS: PlatformDto[] = [platform(6, 'PC (Windows)', 'PC'), platform(130, 'Nintendo Switch', 'Switch')];
const GENRES: GenreDto[] = [{ id: 12, name: 'Role-playing (RPG)', description: null }];

/**
 * The page in a data router whose loader can be held open, which is the only way to have one
 * navigation still in flight while the next filter is chosen. The component is handed the plain
 * catalogue throughout, because that is what a loader that has not answered yet leaves on screen.
 */
function renderBrowsePage() {
    const requested: string[] = [];
    let release: (() => void) | null = null;

    const router = createMemoryRouter(
        [{
            path: '/games',
            loader: ({ request }) => {
                requested.push(new URL(request.url).search);
                // The first load lands, so the page renders; every navigation after it waits.
                if (requested.length === 1) return null;
                return new Promise(resolve => { release = () => resolve(null); });
            },
            Component: () => (
                <GamesPage
                    {...({
                        loaderData: {
                            page: { items: [], hasMore: false },
                            browse: EMPTY_BROWSE,
                            genres: GENRES,
                            platforms: PLATFORMS,
                            currentYear: 2026,
                        },
                    } as unknown as Route.ComponentProps)}
                />
            ),
        }],
        { initialEntries: ['/games'] },
    );

    render(<RouterProvider router={router} />);
    return { requested, release: () => release?.() };
}

describe('GamesPage filters', () => {
    beforeEach(() => {
        // The infinite-scroll sentinel is observed on mount, and jsdom has no observer to do it.
        vi.stubGlobal('IntersectionObserver', class {
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() { return []; }
        });
    });

    it('keeps a filter whose page is still loading when the next one is chosen', async () => {
        // The reader has already watched the page start loading the platform they picked. Built on
        // the last loader result that landed, the genre they pick next would go out on its own and
        // the platform would silently come off.
        const actor = userEvent.setup();
        const { requested } = renderBrowsePage();

        await actor.selectOptions(await screen.findByLabelText('Platform'), 'PC (Windows)');
        await actor.selectOptions(screen.getByLabelText('Genre'), 'Role-playing (RPG)');

        expect(requested).toEqual(['', '?platform=6', '?platform=6&genre=12']);
    });
});
