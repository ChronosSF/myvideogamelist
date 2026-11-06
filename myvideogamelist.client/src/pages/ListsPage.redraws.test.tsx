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
import type { ViewMode } from '@/types/list';
import { entry, userProfile } from '@/test/factories';

/**
 * What a sort and a save on the lists page draw again, with the real `ListsProvider` behind the page —
 * which is the point: `ListsPage.test.tsx` mocks the lists, and a mock hands the page the same functions
 * whatever happens, so it cannot see the provider handing out new ones (`docs/decisions/0086-*`).
 *
 * A card is counted by the wishlist it reads, once a render and by its own game; a table row by its score
 * control, stubbed. Everything else the page reads is mocked, as `ListsPage.test.tsx` mocks it, and every
 * object handed back is hoisted, never a fresh literal per call.
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

// Named so that the title order is the number order, and each joined the list a day after the one before.
const title = (n: number) => `Game ${String(n).padStart(2, '0')}`;
const games = (count: number) => Array.from({ length: count }, (_, index) => index + 1).map(n => entry({
    game: { id: n, title: title(n) },
    addedAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00+00:00`,
}));

/** Every request the page made, as `METHOD path`. */
let requests: string[] = [];

/**
 * The API: the playing list and the reader's preferences — this layout, by title — and every write saved.
 */
function serve(view: ViewMode, count: number) {
    requests = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push(`${method} ${url}`);
        if (method === 'GET' && url === '/api/lists') {
            return new Response(JSON.stringify({ lists: { playing: games(count) } }), { status: 200 });
        }
        if (method === 'GET' && url === '/api/user/list-preferences') {
            const sorts = { playing: { sortKey: 'title', descending: false } };
            return new Response(JSON.stringify({ view, sorts, names: {} }), { status: 200 });
        }
        return new Response(null, { status: 204 });
    }));
}

async function renderPage(view: ViewMode, count: number) {
    serve(view, count);
    render(<MemoryRouter><ListsProvider><ListsPage /></ListsProvider></MemoryRouter>);
    await screen.findByRole('button', { name: 'Sorted ascending. Switch to descending' });
    cardsDrawn.length = 0;
    rowsDrawn.clear();
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
        await renderPage('table', 30);

        await userEvent.click(screen.getByRole('button', { name: 'Sorted ascending. Switch to descending' }));

        expect(screen.getAllByRole('link', { name: /^Game / }).map(link => link.textContent)[0]).toBe(title(30));
        expect([...rowsDrawn.keys()]).toEqual([]);
    });

    it('draws again only the cards whose cover joins or leaves the first row, which loads with the page', async () => {
        await renderPage('tiles', 8);

        await userEvent.click(screen.getByRole('button', { name: 'Sorted ascending. Switch to descending' }));

        // Six to a row at the widest: 1 to 6 were the first row, and 8 to 3 are.
        expect(titles()).toEqual([8, 7, 6, 5, 4, 3, 2, 1].map(title));
        expect([...cardsDrawn].sort((a, b) => a - b)).toEqual([1, 2, 7, 8]);
    });
});

describe('ListsPage, with the real provider, through a save', () => {
    it('draws only the row of the game scored, as the score is given and as it is saved', async () => {
        await renderPage('table', 30);

        await userEvent.click(screen.getByRole('button', { name: `Score ${title(5)} 8` }));
        await settle();

        expect(requests).toContain('PUT /api/entries/5/score');
        expect(screen.getByRole('link', { name: title(5) }).closest('tr')).not.toHaveClass('pending');
        expect([...rowsDrawn.keys()]).toEqual([title(5)]);
    });

    it('draws only the row of the game taken off the list: none, since it is gone', async () => {
        await renderPage('table', 30);

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
        // The last of eight, so that no other card moves into or out of the first row.
        await renderPage('tiles', 8);

        await userEvent.click(within(card(8)).getByRole('button', { name: button }));
        await settle();

        expect(requests).toContain(request);
        expect(titles()).toEqual([1, 2, 3, 4, 5, 6, 7].map(title));
        expect(cardsDrawn).toEqual([]);
    });
});
