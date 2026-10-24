import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { GamesPage, meta } from '@/pages/GamesPage';
import { EMPTY_BROWSE, type GameBrowse } from '@/lib/gameBrowse';
import type { GameDto, GenreDto, PlatformDto } from '@/types/game';
import { LIST_NAMES, type ListId } from '@/types/list';
import { game, platform } from '@/test/factories';
import type { Route } from './+types/GamesPage';

type Tag = Partial<Record<'title' | 'name' | 'content' | 'rel' | 'href', string>>;

/**
 * A signed-out reader, for the cards a result set renders: each reads auth, the lists, the wishlist
 * and the favourites, whose real providers would fetch. One object each, handed back on every call,
 * because a fresh literal per render re-runs every effect that depends on it.
 */
const signedOut = { user: null, loading: false };
const noLists = {
    addToList: vi.fn(async () => {}),
    removeFromList: vi.fn(async () => {}),
    isInList: () => false,
    isPending: () => false,
    nameFor: (id: ListId) => LIST_NAMES[id],
};
const noWishlist = {
    isWishlisted: () => false,
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
};
const noFavourites = { isFavourite: () => false };

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => signedOut }));
vi.mock('@/hooks/useLists', () => ({ useLists: () => noLists }));
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => noWishlist }));
vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => noFavourites }));

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
        expect(noindex(tagsFor('?esrb=m', { esrb: 'm' }))).toBe(true);
    });

    it('keeps out a query the loader could not use, which it reads as the plain catalogue', () => {
        // Every one of these parses to the default browse, so a decision made on the browse would
        // index each of them as another copy of the catalogue.
        for (const query of ['?sort=bogus', '?platform=0', '?sort=rating', '?esrb=rp']) {
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
 * navigation still in flight while the next filter is chosen. The component is handed the browse it
 * opened on throughout — the plain catalogue unless told otherwise — because that is what a loader
 * that has not answered yet leaves on screen.
 */
function renderBrowsePage(opened: { url: string; browse: Partial<GameBrowse> } = { url: '/games', browse: {} }) {
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
                            browse: { ...EMPTY_BROWSE, ...opened.browse },
                            genres: GENRES,
                            platforms: PLATFORMS,
                            currentYear: 2026,
                        },
                    } as unknown as Route.ComponentProps)}
                />
            ),
        }],
        { initialEntries: [opened.url] },
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

    it('puts an ESRB rating in the URL beside a platform', async () => {
        const actor = userEvent.setup();
        const { requested } = renderBrowsePage();

        await actor.selectOptions(await screen.findByLabelText('Platform'), 'PC (Windows)');
        await actor.selectOptions(screen.getByLabelText('ESRB rating'), 'Mature 17+');

        expect(requested).toEqual(['', '?platform=6', '?platform=6&esrb=m']);
    });

    it('clears an ESRB rating with the other filters', async () => {
        const actor = userEvent.setup();
        const { requested } = renderBrowsePage({ url: '/games?platform=6&esrb=m', browse: { platform: 6, esrb: 'm' } });

        // The one beside the selects; the empty page offers the same.
        const [clear] = await screen.findAllByRole('button', { name: 'Clear filters' });
        await actor.click(clear);

        expect(requested).toEqual(['?platform=6&esrb=m', '']);
    });

    it('draws a page of card shapes, and says so in words, while another result set loads', async () => {
        const actor = userEvent.setup();
        renderBrowsePage();

        await actor.selectOptions(await screen.findByLabelText('Platform'), 'PC (Windows)');

        const loading = screen.getByText('Loading games…').parentElement;
        expect(loading?.querySelectorAll('.grid > .skeleton-sheen')).toHaveLength(20);
    });
});

/** `count` games with covers, numbered from `from`. */
const covered = (count: number, from = 1) => Array.from({ length: count }, (_, index) => game({
    id: from + index,
    title: `Game ${from + index}`,
    coverImageUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/co${from + index}.jpg`,
}));

describe('GamesPage results', () => {
    /** The observer's latest callback, so a test can bring the sentinel into view. */
    let intersect: IntersectionObserverCallback = () => {};

    beforeEach(() => {
        vi.stubGlobal('IntersectionObserver', class {
            constructor(callback: IntersectionObserverCallback) { intersect = callback; }
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() { return []; }
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    function renderResults(items: GameDto[], hasMore: boolean) {
        const router = createMemoryRouter(
            [{
                path: '/games',
                loader: () => null,
                Component: () => (
                    <GamesPage
                        {...({
                            loaderData: {
                                page: { items, hasMore },
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
    }

    it('loads the first row of covers with the page, and the rest as they are scrolled near', async () => {
        // The first row is the largest first paint, and is in the server-rendered HTML.
        renderResults(covered(8), false);

        const covers = await screen.findAllByRole('img');
        expect(covers.map(cover => cover.getAttribute('loading')))
            .toEqual([...Array<string>(6).fill('eager'), 'lazy', 'lazy']);
    });

    it("continues the grid with the next page's shapes while it loads, and says so in words", async () => {
        let answer: (response: Response) => void = () => {};
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
        renderResults(covered(20), true);

        // Present and empty from the start: a live region is announced when its words change.
        const status = await screen.findByRole('status');
        expect(status).toBeEmptyDOMElement();

        const sentinel = status.parentElement;
        act(() => intersect(
            [{ target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
        ));

        const grid = screen.getAllByRole('img')[0].closest('[aria-busy]');
        expect(grid).toHaveAttribute('aria-busy', 'true');
        expect(grid?.querySelectorAll('.skeleton-sheen')).toHaveLength(6);
        expect(status).toHaveTextContent('Loading more games…');

        await act(async () => answer(new Response(JSON.stringify({ items: covered(20, 21), hasMore: false }))));

        expect(screen.getAllByRole('img')).toHaveLength(40);
        expect(grid).not.toHaveAttribute('aria-busy');
        expect(grid?.querySelectorAll('.skeleton-sheen')).toHaveLength(0);
        expect(status).toBeEmptyDOMElement();
    });
});
