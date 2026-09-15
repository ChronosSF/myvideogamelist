import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FavouritesProvider } from '@/contexts/FavouritesProvider';
import { useFavourites } from '@/hooks/useFavourites';
import type { FavouriteDto } from '@/types/favourite';
import { game } from '@/test/factories';

const ALICE = { id: 'u1', email: 'alice@test.local', theme: 'dark' };
const BOB = { id: 'u2', email: 'bob@test.local', theme: 'dark' };

/** One stable object, reassigned per test — see WishlistProvider.test.tsx for why never a literal. */
const auth = {
    user: ALICE as typeof ALICE | null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateTheme: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const CELESTE = game({ id: 1, title: 'Celeste' });

function favourite(id: number, title: string, addedAt = '2026-01-01T00:00:00+00:00'): FavouriteDto {
    return { game: game({ id, title }), addedAt };
}

interface Recorded {
    method: string;
    url: string;
}

/**
 * The favourites endpoints and nothing else. The state machine behind them is `useGameAxis`, which
 * `WishlistProvider.test.tsx` covers in depth; these tests are about this provider's wiring — which
 * endpoint, which messages, and that it is a separate axis from the wishlist.
 */
function stubFetch(options: {
    /** Successive GET payloads — one per load, the last repeating. */
    loads?: FavouriteDto[][];
    mutationStatus?: number;
    deferred?: string[];
} = {}) {
    const calls: Recorded[] = [];
    const held = new Map<string, (response: Response) => void>();
    const loads = options.loads ?? [[]];
    let getCount = 0;

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ method, url });

        if (options.deferred?.includes(url)) {
            return new Promise<Response>(resolve => held.set(url, resolve));
        }
        if (method === 'GET') {
            const load = loads[Math.min(getCount++, loads.length - 1)];
            return Promise.resolve(new Response(JSON.stringify(load), { status: 200 }));
        }
        const status = options.mutationStatus ?? 204;
        return Promise.resolve(new Response(status === 204 ? null : 'nope', { status }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const release = (url: string, status: number) =>
        act(async () => {
            held.get(url)!(new Response(status === 204 ? null : 'nope', { status }));
            await Promise.resolve();
        });

    return { calls, release };
}

function Probe() {
    const favourites = useFavourites();

    return (
        <div>
            <span data-testid="titles">{favourites.items.map(i => i.game.title).join(',')}</span>
            <span data-testid="loading">{String(favourites.loading)}</span>
            <span data-testid="mutation-error">{favourites.mutationError ?? ''}</span>
            <span data-testid="is-celeste">{String(favourites.isFavourite(1))}</span>
            <button onClick={() => void favourites.add(CELESTE)}>add celeste</button>
            <button onClick={() => void favourites.remove(2)}>remove hades</button>
        </div>
    );
}

function renderProvider() {
    return render(
        <FavouritesProvider>
            <Probe />
        </FavouritesProvider>,
    );
}

const titles = () => screen.getByTestId('titles').textContent;
const click = (name: string) => userEvent.click(screen.getByRole('button', { name }));
const settled = () => waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

beforeEach(() => {
    vi.unstubAllGlobals();
    auth.user = ALICE;
});

describe('FavouritesProvider', () => {
    it('loads the favourites for a signed-in user', async () => {
        const { calls } = stubFetch({ loads: [[favourite(2, 'Hades')]] });
        renderProvider();
        await settled();

        expect(titles()).toBe('Hades');
        expect(calls).toEqual([{ method: 'GET', url: '/api/favourites' }]);
    });

    it('adds through the favourites endpoint, never the wishlist one', async () => {
        const { calls } = stubFetch();
        renderProvider();
        await settled();

        await click('add celeste');

        await waitFor(() => expect(screen.getByTestId('is-celeste')).toHaveTextContent('true'));
        expect(calls).toContainEqual({ method: 'PUT', url: '/api/favourites/1' });
        expect(calls.some(call => call.url.includes('/api/wishlist'))).toBe(false);
    });

    it('removes through the favourites endpoint', async () => {
        const { calls } = stubFetch({ loads: [[favourite(2, 'Hades')]] });
        renderProvider();
        await settled();

        await click('remove hades');

        await waitFor(() => expect(titles()).toBe(''));
        expect(calls).toContainEqual({ method: 'DELETE', url: '/api/favourites/2' });
    });

    it('rolls a failed add back and says so in its own words', async () => {
        stubFetch({ mutationStatus: 500 });
        renderProvider();
        await settled();

        await click('add celeste');

        await waitFor(() => expect(screen.getByTestId('mutation-error'))
            .toHaveTextContent('Failed to update your favourites. Please try again.'));
        expect(screen.getByTestId('is-celeste')).toHaveTextContent('false');
    });

    it('does not write a rolled-back favourite into the next account', async () => {
        // The session stamps come from the shared hook; this pins that this provider gets them too.
        const { release } = stubFetch({
            loads: [[favourite(2, 'Hades')], []],
            deferred: ['/api/favourites/2'],
        });
        const view = renderProvider();
        await settled();

        await click('remove hades');
        expect(titles()).toBe('');

        auth.user = BOB;
        view.rerender(<FavouritesProvider><Probe /></FavouritesProvider>);
        await settled();

        await release('/api/favourites/2', 500);

        // Bob has no favourites. Alice's failed removal must neither put Hades back under his name
        // nor raise its error on his screen.
        expect(titles()).toBe('');
        expect(screen.getByTestId('mutation-error').textContent).toBe('');
    });
});
