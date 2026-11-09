import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ListsPage } from '@/pages/ListsPage';
import { ListsProvider } from '@/contexts/ListsProvider';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { TagsContextValue } from '@/contexts/TagsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import type { ListId, ViewMode } from '@/types/list';
import { GAME_GRID_FIRST_ROW } from '@/lib/gameGrid';
import { entry, userProfile } from '@/test/factories';

/**
 * What a sort and a save on the lists page draw again, with the real `ListsProvider` behind the page —
 * which is the point: `ListsPage.test.tsx` mocks the lists, and a mock hands the page the same functions
 * whatever happens, so it cannot see the provider handing out new ones (`docs/decisions/0086-*`).
 *
 * A card is counted by the wishlist it reads, once a render and by its own game; a table row by its score
 * control, stubbed; a hand order's handle by its name; and the page by its toolbar. Everything else the
 * page reads is mocked, as `ListsPage.test.tsx` mocks it, and every object handed back is hoisted, never a
 * fresh literal per call.
 */
const auth: AuthContextValue = {
    user: userProfile(),
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    updateLook: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

/** The game of every card drawn, in the order they were drawn. */
const cardsDrawn: number[] = [];
const wishlist: WishlistContextValue = {
    items: [],
    loading: false,
    error: null,
    mutationError: null,
    isWishlisted: gameId => {
        cardsDrawn.push(gameId);
        return false;
    },
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    reload: vi.fn(),
};
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

const favourites = { isFavourite: () => false } as unknown as FavouritesContextValue;
vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

const tags: TagsContextValue = {
    tags: [],
    status: 'ready',
    reload: vi.fn(),
    tagFor: () => undefined,
    byId: new Map(),
    createTag: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
    renameTag: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
    deleteTag: vi.fn(async () => true),
    adjustCounts: vi.fn(),
};
vi.mock('@/hooks/useTags', () => ({ useTags: () => tags }));

/** The title of every row drawn, as often as each was; and a button that gives the game an 8. */
const rowsDrawn = new Map<string, number>();
vi.mock('@/components/ScoreInput', () => ({
    ScoreInput: ({ gameTitle, onChange }: { gameTitle: string; onChange: (score: number | null) => void }) => {
        rowsDrawn.set(gameTitle, (rowsDrawn.get(gameTitle) ?? 0) + 1);
        return <button type="button" onClick={() => onChange(8)}>{`Score ${gameTitle} 8`}</button>;
    },
}));

/** How often the page was drawn, counted by its toolbar, which it draws every time. */
let pageDrawn = 0;
vi.mock('@/components/ListToolbar', async importOriginal => {
    const real = await importOriginal<typeof import('@/components/ListToolbar')>();
    return {
        ListToolbar: (props: Parameters<typeof real.ListToolbar>[0]) => {
            pageDrawn += 1;
            return <real.ListToolbar {...props} />;
        },
    };
});

/** The name of every hand order's handle drawn, as often as each was. */
const handlesDrawn = new Map<string, number>();
vi.mock('@/components/ReorderHandle', async importOriginal => {
    const real = await importOriginal<typeof import('@/components/ReorderHandle')>();
    return {
        ReorderHandle: (props: Parameters<typeof real.ReorderHandle>[0]) => {
            const name = props.handle['aria-label'];
            handlesDrawn.set(name, (handlesDrawn.get(name) ?? 0) + 1);
            return <real.ReorderHandle {...props} />;
        },
    };
});

// Named so that the title order is the number order, and each joined the list a day after the one before.
const title = (n: number) => `Game ${String(n).padStart(2, '0')}`;
const games = (count: number) => Array.from({ length: count }, (_, index) => index + 1).map(n => entry({
    game: { id: n, title: title(n) },
    addedAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00+00:00`,
}));

/** Every request the page made, as `METHOD path`. */
let requests: string[] = [];

interface Shown {
    view: ViewMode;
    count: number;
    /** The list the games are in, and the tab opened. Playing unless said. */
    list?: ListId;
    /** Its saved order, ascending. By title unless said. */
    sortKey?: 'title' | 'manual';
}

/**
 * The API: one list and the reader's preferences — this layout, in this order — and every write saved.
 */
function serve({ view, count, list = 'playing', sortKey = 'title' }: Shown) {
    requests = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push(`${method} ${url}`);
        if (method === 'GET' && url === '/api/lists') {
            return new Response(JSON.stringify({ lists: { [list]: games(count) } }), { status: 200 });
        }
        if (method === 'GET' && url === '/api/user/list-preferences') {
            const sorts = { [list]: { sortKey, descending: false } };
            return new Response(JSON.stringify({ view, sorts, names: {} }), { status: 200 });
        }
        return new Response(null, { status: 204 });
    }));
}

async function renderPage(shown: Shown) {
    serve(shown);
    render(<MemoryRouter><ListsProvider><ListsPage /></ListsProvider></MemoryRouter>);
    if (shown.list === 'backlog') await userEvent.click(await screen.findByRole('tab', { name: /Backlog/ }));
    if (shown.sortKey === 'manual') await screen.findByRole('button', { name: `Move ${title(1)}` });
    else await screen.findByRole('button', { name: 'Sorted ascending. Switch to descending' });
    cardsDrawn.length = 0;
    rowsDrawn.clear();
    handlesDrawn.clear();
    pageDrawn = 0;
}

/** Every answer the save is waiting on, and every render they cause. */
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

const titles = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
const card = (n: number) => screen.getByRole('heading', { name: title(n) }).closest('article')!;

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('ListsPage, with the real provider, after a change of order', () => {
    it('draws no row of the table again: each is in a new place, and nothing in it changed', async () => {
        await renderPage({ view: 'table', count: 30 });

        await userEvent.click(screen.getByRole('button', { name: 'Sorted ascending. Switch to descending' }));

        expect(screen.getAllByRole('link', { name: /^Game / }).map(link => link.textContent)[0]).toBe(title(30));
        expect([...rowsDrawn.keys()]).toEqual([]);
    });

    it('draws again only the cards whose cover joins or leaves the first row, which loads with the page', async () => {
        // Two more than the first row holds, so that reversing them moves two into it and two out.
        const row = GAME_GRID_FIRST_ROW;
        const count = row + 2;
        await renderPage({ view: 'tiles', count });

        await userEvent.click(screen.getByRole('button', { name: 'Sorted ascending. Switch to descending' }));

        // 1 to `row` were the first row; `count` down to 3 are.
        const numbers = Array.from({ length: count }, (_, index) => index + 1);
        expect(titles()).toEqual([...numbers].reverse().map(title));
        expect([...cardsDrawn].sort((a, b) => a - b)).toEqual([1, 2, row + 1, row + 2]);
    });
});

describe('ListsPage, with the real provider, through a save', () => {
    it('draws only the row of the game scored, as the score is given and as it is saved', async () => {
        await renderPage({ view: 'table', count: 30 });

        await userEvent.click(screen.getByRole('button', { name: `Score ${title(5)} 8` }));
        await settle();

        expect(requests).toContain('PUT /api/entries/5/score');
        expect(screen.getByRole('link', { name: title(5) }).closest('tr')).not.toHaveClass('pending');
        expect([...rowsDrawn.keys()]).toEqual([title(5)]);
        // Once, for the score; the lock taken and released reach the row and nothing else.
        expect(pageDrawn).toBe(1);
    });

    it('draws only the row of the game taken off the list: none, since it is gone', async () => {
        await renderPage({ view: 'table', count: 30 });

        await userEvent.click(screen.getByRole('button', { name: `Take ${title(5)} out of this list` }));
        await settle();

        expect(requests).toContain('DELETE /api/lists/5');
        expect(screen.queryByRole('link', { name: title(5) })).not.toBeInTheDocument();
        expect([...rowsDrawn.keys()]).toEqual([]);
    });

    it.each([
        ['taken off the list', 'Playing', 'DELETE /api/lists/8'],
        ['moved to another list', 'Finished', 'PUT /api/lists/8'],
    ])('draws no other card when a game is %s from its card', async (_, button, request) => {
        // The last of the list, past the first row, so that no other card moves into or out of it.
        const count = GAME_GRID_FIRST_ROW + 2;
        await renderPage({ view: 'tiles', count });

        await userEvent.click(within(card(count)).getByRole('button', { name: button }));
        await settle();

        expect(requests).toContain(request.replace('8', String(count)));
        expect(titles()).toEqual(Array.from({ length: count - 1 }, (_, index) => title(index + 1)));
        expect(cardsDrawn).toEqual([]);
        expect(pageDrawn).toBe(1);
    });
});

describe('ListsPage, with the real provider, in a hand order', () => {
    it('draws only the row of the game scored, its handle included', async () => {
        await renderPage({ view: 'table', count: 30, list: 'backlog', sortKey: 'manual' });

        await userEvent.click(screen.getByRole('button', { name: `Score ${title(5)} 8` }));
        await settle();

        expect(requests).toContain('PUT /api/entries/5/score');
        expect([...rowsDrawn.keys()]).toEqual([title(5)]);
        expect([...handlesDrawn.keys()]).toEqual([`Move ${title(5)}`]);
    });

    it('draws no other tile, nor its handle, when a game is taken off the list from its card', async () => {
        const count = GAME_GRID_FIRST_ROW + 2;
        await renderPage({ view: 'tiles', count, list: 'backlog', sortKey: 'manual' });

        await userEvent.click(within(card(count)).getByRole('button', { name: 'Backlog' }));
        await settle();

        expect(requests).toContain(`DELETE /api/lists/${count}`);
        expect(cardsDrawn).toEqual([]);
        expect([...handlesDrawn.keys()]).toEqual([]);
    });
});
