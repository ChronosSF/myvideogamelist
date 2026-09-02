import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WishlistProvider } from '@/contexts/WishlistProvider';
import { useWishlist } from '@/hooks/useWishlist';
import type { WishlistItemDto } from '@/types/wishlist';
import { game } from '@/test/factories';

// A module-level constant, not a fresh literal per call. The fetch effect in the provider depends
// on `user`, so returning a new object each render would re-run it on every render it caused — an
// unbounded loop that ends in an out-of-memory crash rather than a failed assertion.
vi.mock('@/hooks/useAuth', () => {
    const value = {
        user: { id: 'u1', email: 'alice@test.local', theme: 'dark' },
        loading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        updateTheme: vi.fn(),
    };
    return { useAuth: () => value };
});

const CELESTE = game({ id: 1, title: 'Celeste' });
const HADES = game({ id: 2, title: 'Hades' });

interface Recorded {
    method: string;
    url: string;
}

function item(id: number, title: string, addedAt: string): WishlistItemDto {
    return { game: game({ id, title }), addedAt };
}

function stubFetch(options: {
    initial?: WishlistItemDto[];
    /** Status for the initial GET, so a load failure can be asserted. */
    loadStatus?: number;
    /** Status for mutations, so rollback can be asserted. */
    mutationStatus?: number;
} = {}) {
    const calls: Recorded[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ method, url });

        if (method === 'GET') {
            const status = options.loadStatus ?? 200;
            return status === 200
                ? new Response(JSON.stringify(options.initial ?? []), { status })
                : new Response('nope', { status });
        }
        return new Response(null, { status: options.mutationStatus ?? 204 });
    });

    vi.stubGlobal('fetch', fetchMock);
    return calls;
}

/** Surfaces the context as text and buttons, so assertions read off the rendered output. */
function Probe() {
    const wishlist = useWishlist();

    return (
        <div>
            <span data-testid="titles">{wishlist.items.map(i => i.game.title).join(',')}</span>
            <span data-testid="loading">{String(wishlist.loading)}</span>
            <span data-testid="error">{wishlist.error ?? ''}</span>
            <span data-testid="has-celeste">{String(wishlist.isWishlisted(1))}</span>
            <button onClick={() => void wishlist.add(CELESTE)}>add celeste</button>
            <button onClick={() => void wishlist.add(HADES)}>add hades</button>
            <button onClick={() => void wishlist.remove(1)}>remove celeste</button>
        </div>
    );
}

function renderProvider() {
    render(
        <WishlistProvider>
            <Probe />
        </WishlistProvider>,
    );
}

const titles = () => screen.getByTestId('titles').textContent;
const settled = () => waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('WishlistProvider loading', () => {
    it('fetches the wishlist for a signed-in user', async () => {
        const calls = stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')] });
        renderProvider();

        await settled();
        expect(calls).toContainEqual({ method: 'GET', url: '/api/wishlist' });
        expect(titles()).toBe('Celeste');
    });

    it('keeps the order the server sent, rather than re-sorting', async () => {
        // The server orders by when the user started wanting each game, and nothing else on the
        // payload lets the client reconstruct that.
        stubFetch({
            initial: [
                item(2, 'Hades', '2026-03-01T00:00:00+00:00'),
                item(1, 'Celeste', '2026-01-01T00:00:00+00:00'),
            ],
        });
        renderProvider();

        await settled();
        expect(titles()).toBe('Hades,Celeste');
    });

    it('surfaces a load failure instead of showing an empty wishlist', async () => {
        // An empty wishlist and one that failed to load look identical on screen, and the second
        // must not read as the first.
        stubFetch({ loadStatus: 500 });
        renderProvider();

        await settled();
        expect(screen.getByTestId('error')).toHaveTextContent(/failed to load your wishlist/i);
        expect(titles()).toBe('');
    });
});

describe('WishlistProvider adding', () => {
    it('puts the game on the wishlist through the wishlist endpoint', async () => {
        const calls = stubFetch();
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'add celeste' }));

        expect(calls).toContainEqual({ method: 'PUT', url: '/api/wishlist/1' });
    });

    it('never routes a wishlist add through the lists or entries endpoints', async () => {
        // Three axes, three endpoints. Crossing them would move a game between status lists, or
        // overwrite an entry, as a side effect of wanting it.
        const calls = stubFetch();
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'add celeste' }));

        expect(calls.some(c => c.url.startsWith('/api/lists'))).toBe(false);
        expect(calls.some(c => c.url.startsWith('/api/entries'))).toBe(false);
    });

    it('shows the game at once, newest first, before the save lands', async () => {
        stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')] });
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'add hades' }));

        expect(titles()).toBe('Hades,Celeste');
    });

    it('rolls back when the save fails', async () => {
        stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')], mutationStatus: 500 });
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'add hades' }));

        await waitFor(() => expect(titles()).toBe('Celeste'));
        expect(screen.getByTestId('error')).toHaveTextContent(/failed to update your wishlist/i);
    });

    it('does nothing for a game already on the wishlist', async () => {
        // Re-adding must not duplicate the row and must not reorder the list by bumping it to the
        // top: the server keeps the original timestamp, so the client has to agree.
        const calls = stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')] });
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'add celeste' }));

        expect(titles()).toBe('Celeste');
        expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
    });
});

describe('WishlistProvider removing', () => {
    it('deletes through the wishlist endpoint and drops the game', async () => {
        const calls = stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')] });
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'remove celeste' }));

        expect(calls).toContainEqual({ method: 'DELETE', url: '/api/wishlist/1' });
        expect(titles()).toBe('');
    });

    it('treats a 404 as success, since the game is already off the list', async () => {
        stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')], mutationStatus: 404 });
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'remove celeste' }));

        await waitFor(() => expect(titles()).toBe(''));
        expect(screen.getByTestId('error')).toHaveTextContent('');
    });

    it('rolls back a failed removal', async () => {
        stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')], mutationStatus: 500 });
        renderProvider();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'remove celeste' }));

        await waitFor(() => expect(titles()).toBe('Celeste'));
    });

    it('reports membership for the game it was asked about', async () => {
        stubFetch({ initial: [item(1, 'Celeste', '2026-01-01T00:00:00+00:00')] });
        renderProvider();
        await settled();

        expect(screen.getByTestId('has-celeste')).toHaveTextContent('true');

        await userEvent.click(screen.getByRole('button', { name: 'remove celeste' }));

        expect(screen.getByTestId('has-celeste')).toHaveTextContent('false');
    });
});
