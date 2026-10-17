import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, useLoaderData } from 'react-router';
import { GamesPage } from '@/pages/GamesPage';
import { browseFrom } from '@/lib/gameBrowse';
import type { GameDto, GenreDto, PagedGamesResponse, PlatformDto } from '@/types/game';
import { game, platform } from '@/test/factories';
import type { Route } from './+types/GamesPage';

/*
 * The browse page while a navigation is still out: a page of the infinite scroll that answers as the
 * next browse renders. The loader is the test's, answering by the URL, so the page reads its loader
 * data as it does in the app.
 */

// A signed-out reader, the shared page's audience. Every hook a card may ask is answered here, for
// nobody, so the test holds whatever the card draws; going through the real providers would mean
// answering their fetches too. Stable objects, since a fresh one per render re-runs every effect that
// depends on it.
const signedOut = { user: null, loading: false };
const noLists = { isInList: () => false, isPending: () => false, nameFor: (id: string) => id, addToList: vi.fn(), removeFromList: vi.fn() };
const noWishlist = { isWishlisted: () => false, isPending: () => false, add: vi.fn(), remove: vi.fn() };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => signedOut }));
vi.mock('@/hooks/useLists', () => ({ useLists: () => noLists }));
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => noWishlist }));
const noFavourites = { isFavourite: () => false, isPending: () => false, add: vi.fn(), remove: vi.fn() };
vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => noFavourites }));

const PLATFORMS: PlatformDto[] = [platform(6, 'PC (Windows)', 'PC'), platform(130, 'Nintendo Switch', 'Switch')];
const GENRES: GenreDto[] = [{ id: 12, name: 'Role-playing (RPG)', description: null }];
const PAGE_SIZE = 20;

function games(count: number, firstId: number): GameDto[] {
    return Array.from({ length: count }, (_, index) => game({ id: firstId + index, title: `Game ${firstId + index}` }));
}

/** An answer the test gives when it chooses to. */
function held<T>() {
    let release!: (value: T) => void;
    const answer = new Promise<T>(resolve => { release = resolve; });
    return { answer, release };
}

/**
 * Whether the foot of the listing is in view. jsdom lays nothing out, so this stands in for the
 * reader's scroll position, and the observer reports it on `observe()`, as a browser's does.
 */
let atTheFoot = false;

class FootObserver {
    constructor(private readonly report: IntersectionObserverCallback) {}
    observe(target: Element) {
        queueMicrotask(() => this.report(
            [{ target, isIntersecting: atTheFoot } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        ));
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
}

/** The browse page in a data router, with its first page answered by `firstPage` for each URL. */
function renderBrowse(firstPage: (params: URLSearchParams) => PagedGamesResponse | Promise<PagedGamesResponse>) {
    const router = createMemoryRouter(
        [{
            path: '/games',
            loader: async ({ request }) => {
                const params = new URL(request.url).searchParams;
                return {
                    page: await firstPage(params),
                    browse: browseFrom(params),
                    genres: GENRES,
                    platforms: PLATFORMS,
                    currentYear: 2026,
                };
            },
            Component: () => <GamesPage {...({ loaderData: useLoaderData() } as unknown as Route.ComponentProps)} />,
        }],
        { initialEntries: ['/games'] },
    );
    render(<RouterProvider router={router} />);
    return router;
}

beforeEach(() => {
    atTheFoot = false;
    vi.stubGlobal('IntersectionObserver', FootObserver);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GamesPage paging into the next browse', () => {
    it('drops a page of the previous browse that answers as the next one renders', async () => {
        // The page still out was abandoned from an effect, which runs after the commit, so for that
        // moment it could still land and be added to the new listing.
        const late = held<Response>();
        vi.stubGlobal('fetch', vi.fn(() => late.answer));
        atTheFoot = true;
        renderBrowse(params => params.get('platform') === '6'
            ? { items: games(2, 500), hasMore: false }
            : { items: games(PAGE_SIZE, 1), hasMore: true });
        const actor = userEvent.setup();

        // The foot is in view, so the second page of the plain catalogue is asked for; then the reader
        // goes back up to the filters, so the next browse does not page on its own.
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        atTheFoot = false;

        // Answered the moment the new listing is in the document, before React has run its effects.
        const watcher = new MutationObserver(() => {
            if (document.body.textContent?.includes('Game 500')) {
                watcher.disconnect();
                late.release(new Response(JSON.stringify({ items: games(PAGE_SIZE, PAGE_SIZE + 1), hasMore: true })));
            }
        });
        watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
        await actor.selectOptions(screen.getByLabelText('Platform'), 'PC (Windows)');
        await screen.findByText('Game 500');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

        expect(screen.getAllByRole('article')).toHaveLength(2);
    });
});
