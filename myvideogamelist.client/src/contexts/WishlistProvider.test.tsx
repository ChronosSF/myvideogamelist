import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WishlistProvider } from '@/contexts/WishlistProvider';
import { useWishlist } from '@/hooks/useWishlist';
import type { WishlistItemDto } from '@/types/wishlist';
import { game } from '@/test/factories';

const ALICE = { id: 'u1', email: 'alice@test.local', theme: 'dark' };
const BOB = { id: 'u2', email: 'bob@test.local', theme: 'dark' };

/**
 * Mutable so a test can switch accounts, but handed back as one stable object.
 *
 * The fetch effect in the provider depends on `user`, so returning a fresh literal per call would
 * re-run it on every render it caused — an unbounded loop that ends in an out-of-memory crash
 * rather than a failed assertion. Reassigning `auth.user` changes that dependency deliberately.
 */
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
const HADES = game({ id: 2, title: 'Hades' });

const JANUARY = '2026-01-01T00:00:00+00:00';
const MARCH = '2026-03-01T00:00:00+00:00';
/** Later than any clock this test could be running under. */
const FAR_FUTURE = '2099-01-01T00:00:00+00:00';

interface Recorded {
    method: string;
    url: string;
}

function item(id: number, title: string, addedAt: string): WishlistItemDto {
    return { game: game({ id, title }), addedAt };
}

interface StubOptions {
    initial?: WishlistItemDto[];
    /** Successive GET payloads, for tests that reload or switch accounts. */
    loads?: WishlistItemDto[][];
    /** Status for the initial GET, so a load failure can be asserted. */
    loadStatus?: number;
    /** Status for every mutation, so rollback can be asserted. */
    mutationStatus?: number;
    /** URLs that fail while the rest succeed, so one mutation can fail among several. */
    failing?: string[];
    /** URLs held open until the test releases them, so two requests can genuinely overlap. */
    deferred?: string[];
}

function stubFetch(options: StubOptions = {}) {
    const calls: Recorded[] = [];
    const held = new Map<string, (response: Response) => void>();
    const loads = [...(options.loads ?? [])];
    let getCount = 0;

    const nextLoad = (): WishlistItemDto[] => {
        if (loads.length === 0) return options.initial ?? [];
        return loads[Math.min(getCount++, loads.length - 1)];
    };

    const respond = (url: string, method: string, statusOverride?: number): Response => {
        if (method === 'GET') {
            const status = statusOverride ?? options.loadStatus ?? 200;
            return status === 200
                ? new Response(JSON.stringify(nextLoad()), { status })
                : new Response('nope', { status });
        }
        const status = statusOverride
            ?? (options.failing?.includes(url) ? 500 : options.mutationStatus ?? 204);
        return new Response(status === 204 ? null : 'nope', { status });
    };

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ method, url });

        if (options.deferred?.includes(url)) {
            return new Promise<Response>(resolve => held.set(url, resolve));
        }
        return Promise.resolve(respond(url, method));
    });

    vi.stubGlobal('fetch', fetchMock);

    /** Releases a held request with the given status, flushing the resulting state updates. */
    const release = (url: string, status: number) =>
        act(async () => {
            const method = url === '/api/wishlist' ? 'GET' : 'PUT';
            held.get(url)!(respond(url, method, status));
            await Promise.resolve();
        });

    return { calls, release };
}

/** Surfaces the context as text and buttons, so assertions read off the rendered output. */
function Probe() {
    const wishlist = useWishlist();

    return (
        <div>
            <span data-testid="titles">{wishlist.items.map(i => i.game.title).join(',')}</span>
            <span data-testid="loading">{String(wishlist.loading)}</span>
            <span data-testid="error">{wishlist.error ?? ''}</span>
            <span data-testid="mutation-error">{wishlist.mutationError ?? ''}</span>
            <span data-testid="has-celeste">{String(wishlist.isWishlisted(1))}</span>
            <span data-testid="pending-celeste">{String(wishlist.isPending(1))}</span>
            <button onClick={() => void wishlist.add(CELESTE)}>add celeste</button>
            <button onClick={() => void wishlist.add(HADES)}>add hades</button>
            <button onClick={() => void wishlist.remove(1)}>remove celeste</button>
            <button onClick={() => void wishlist.remove(2)}>remove hades</button>
            <button onClick={() => wishlist.reload()}>reload</button>
        </div>
    );
}

function renderProvider() {
    return render(
        <WishlistProvider>
            <Probe />
        </WishlistProvider>,
    );
}

const titles = () => screen.getByTestId('titles').textContent;
const click = (name: string) => userEvent.click(screen.getByRole('button', { name }));
const settled = () => waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

beforeEach(() => {
    vi.unstubAllGlobals();
    auth.user = ALICE;
});

describe('WishlistProvider loading', () => {
    it('fetches the wishlist for a signed-in user', async () => {
        const { calls } = stubFetch({ initial: [item(1, 'Celeste', JANUARY)] });
        renderProvider();

        await settled();
        expect(calls).toContainEqual({ method: 'GET', url: '/api/wishlist' });
        expect(titles()).toBe('Celeste');
    });

    it('keeps the order the server sent, rather than re-sorting', async () => {
        // The server orders by when the user started wanting each game, and nothing else on the
        // payload lets the client reconstruct that.
        stubFetch({ initial: [item(2, 'Hades', MARCH), item(1, 'Celeste', JANUARY)] });
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

    it('reports every game as pending until the first load lands', async () => {
        // Membership is unknown until then. Leaving the toggle live lets a write that succeeds
        // during the fetch be silently overwritten when the older response replaces the list.
        const { release } = stubFetch({ deferred: ['/api/wishlist'] });
        renderProvider();

        expect(screen.getByTestId('pending-celeste')).toHaveTextContent('true');

        await release('/api/wishlist', 200);

        expect(screen.getByTestId('pending-celeste')).toHaveTextContent('false');
    });

    it('keeps every game pending after a load failure, rather than claiming none are wishlisted', async () => {
        // The dangerous case: loading goes false, so without this every card would offer "Add"
        // for games that are already on the wishlist, on the strength of a list that never
        // arrived.
        stubFetch({ loadStatus: 500 });
        renderProvider();

        await settled();

        expect(screen.getByTestId('pending-celeste')).toHaveTextContent('true');
        expect(screen.getByTestId('has-celeste')).toHaveTextContent('false');
    });

    it('recovers on retry, which is the only way out of that state', async () => {
        // Every control stays disabled while the load error stands, so without a retry the user
        // would have to reload the page.
        let failed = false;
        const fetchMock = vi.fn(async () => {
            if (!failed) { failed = true; return new Response('nope', { status: 500 }); }
            return new Response(JSON.stringify([item(1, 'Celeste', JANUARY)]), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        renderProvider();

        await settled();
        expect(screen.getByTestId('error')).toHaveTextContent(/failed to load/i);

        await click('reload');

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(''));
        expect(titles()).toBe('Celeste');
        expect(screen.getByTestId('pending-celeste')).toHaveTextContent('false');
    });
});

describe('WishlistProvider adding', () => {
    it('puts the game on the wishlist through the wishlist endpoint', async () => {
        const { calls } = stubFetch();
        renderProvider();
        await settled();

        await click('add celeste');

        expect(calls).toContainEqual({ method: 'PUT', url: '/api/wishlist/1' });
    });

    it('never routes a wishlist add through the lists or entries endpoints', async () => {
        // Three axes, three endpoints. Crossing them would move a game between status lists, or
        // overwrite an entry, as a side effect of wanting it.
        const { calls } = stubFetch();
        renderProvider();
        await settled();

        await click('add celeste');

        expect(calls.some(c => c.url.startsWith('/api/lists'))).toBe(false);
        expect(calls.some(c => c.url.startsWith('/api/entries'))).toBe(false);
    });

    it('shows the game at once, newest first, before the save lands', async () => {
        stubFetch({ initial: [item(1, 'Celeste', JANUARY)] });
        renderProvider();
        await settled();

        await click('add hades');

        expect(titles()).toBe('Hades,Celeste');
    });

    it('puts a new game first even when this browser clock is behind the server', async () => {
        // The optimistic timestamp comes from the browser and the rest come from the server, so
        // sorting the two together lets clock skew file a brand-new game below old ones. A new
        // add is the newest by definition, so it is placed rather than sorted.
        stubFetch({ initial: [item(1, 'Celeste', FAR_FUTURE)] });
        renderProvider();
        await settled();

        await click('add hades');

        expect(titles()).toBe('Hades,Celeste');
    });

    it('rolls back when the save fails', async () => {
        stubFetch({ initial: [item(1, 'Celeste', JANUARY)], mutationStatus: 500 });
        renderProvider();
        await settled();

        await click('add hades');

        await waitFor(() => expect(titles()).toBe('Celeste'));
        expect(screen.getByTestId('mutation-error')).toHaveTextContent(/failed to update your wishlist/i);
    });

    it('does nothing for a game already on the wishlist', async () => {
        // Re-adding must not duplicate the row and must not reorder the list by bumping it to the
        // top: the server keeps the original timestamp, so the client has to agree.
        const { calls } = stubFetch({ initial: [item(1, 'Celeste', JANUARY)] });
        renderProvider();
        await settled();

        await click('add celeste');

        expect(titles()).toBe('Celeste');
        expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
    });
});

describe('WishlistProvider removing', () => {
    it('deletes through the wishlist endpoint and drops the game', async () => {
        const { calls } = stubFetch({ initial: [item(1, 'Celeste', JANUARY)] });
        renderProvider();
        await settled();

        await click('remove celeste');

        expect(calls).toContainEqual({ method: 'DELETE', url: '/api/wishlist/1' });
        expect(titles()).toBe('');
    });

    it('treats a 404 as success, since the game is already off the list', async () => {
        stubFetch({ initial: [item(1, 'Celeste', JANUARY)], mutationStatus: 404 });
        renderProvider();
        await settled();

        await click('remove celeste');

        await waitFor(() => expect(titles()).toBe(''));
        expect(screen.getByTestId('mutation-error')).toHaveTextContent('');
    });

    it('puts a failed removal back where it was, not at the top', async () => {
        // A restore is the opposite of an add: the row has a server timestamp and a place it came
        // from, so prepending it would quietly reorder the list until the next page load.
        stubFetch({
            initial: [item(2, 'Hades', MARCH), item(1, 'Celeste', JANUARY)],
            mutationStatus: 500,
        });
        renderProvider();
        await settled();

        await click('remove celeste');

        await waitFor(() => expect(titles()).toBe('Hades,Celeste'));
    });

    it('reports membership for the game it was asked about', async () => {
        stubFetch({ initial: [item(1, 'Celeste', JANUARY)] });
        renderProvider();
        await settled();

        expect(screen.getByTestId('has-celeste')).toHaveTextContent('true');

        await click('remove celeste');

        expect(screen.getByTestId('has-celeste')).toHaveTextContent('false');
    });
});

describe('WishlistProvider concurrent mutations', () => {
    it('rolls back only its own game, leaving another mutation alone', async () => {
        // Mutations for different games run concurrently by design — that is what the per-game
        // pending set is for. Rolling back by restoring a snapshot taken before the request would
        // undo whichever other mutation succeeded in the meantime, resurrecting a removed game.
        const { release } = stubFetch({
            initial: [item(1, 'Celeste', JANUARY)],
            deferred: ['/api/wishlist/2'],
        });
        renderProvider();
        await settled();

        await click('add hades');
        expect(titles()).toBe('Hades,Celeste');

        // Succeeds while the add is still in flight.
        await click('remove celeste');
        expect(titles()).toBe('Hades');

        // The add now fails and must take only Hades with it.
        await release('/api/wishlist/2', 500);

        expect(titles()).toBe('');
    });

    it('does not resurrect a game when a concurrent removal fails', async () => {
        const { release } = stubFetch({
            initial: [item(1, 'Celeste', JANUARY), item(2, 'Hades', MARCH)],
            deferred: ['/api/wishlist/2'],
        });
        renderProvider();
        await settled();

        await click('remove hades');
        await click('remove celeste');
        expect(titles()).toBe('');

        // Only Hades comes back; Celeste was genuinely removed.
        await release('/api/wishlist/2', 500);

        expect(titles()).toBe('Hades');
    });

    it('clears a mutation error once a later mutation succeeds', async () => {
        // Otherwise the banner outlives the problem and the user has no way to dismiss it.
        stubFetch({ failing: ['/api/wishlist/2'] });
        renderProvider();
        await settled();

        await click('add hades');
        await waitFor(() =>
            expect(screen.getByTestId('mutation-error')).toHaveTextContent(/failed to update/i));

        await click('add celeste');

        await waitFor(() => expect(screen.getByTestId('mutation-error')).toHaveTextContent(''));
    });

    it('keeps a failed mutation out of the load error, so the page still shows the wishlist', async () => {
        // The two are separate fields precisely so a failed toggle cannot make a wishlist that
        // loaded perfectly well render as "failed to load".
        stubFetch({ initial: [item(1, 'Celeste', JANUARY)], mutationStatus: 500 });
        renderProvider();
        await settled();

        await click('add hades');

        await waitFor(() =>
            expect(screen.getByTestId('mutation-error')).toHaveTextContent(/failed to update/i));
        expect(screen.getByTestId('error')).toHaveTextContent('');
        expect(titles()).toBe('Celeste');
    });
});

describe('WishlistProvider across a session change', () => {
    it('does not write a rolled-back item into the next account', async () => {
        // The worst of the rollback cases: a mutation still in flight when somebody logs out and
        // somebody else logs in. Restoring the captured row then puts one user's game into
        // another user's wishlist, which is a leak rather than a glitch.
        const { release } = stubFetch({
            loads: [[item(1, 'Celeste', JANUARY)], [item(2, 'Hades', MARCH)]],
            deferred: ['/api/wishlist/1'],
        });
        const view = renderProvider();
        await settled();
        expect(titles()).toBe('Celeste');

        await click('remove celeste');
        expect(titles()).toBe('');

        // Alice leaves, Bob arrives, and Bob's wishlist loads.
        auth.user = BOB;
        await act(async () => {
            view.rerender(
                <WishlistProvider>
                    <Probe />
                </WishlistProvider>,
            );
        });
        await waitFor(() => expect(titles()).toBe('Hades'));

        // Alice's removal now fails. Her row must not come back into Bob's list.
        await release('/api/wishlist/1', 500);

        expect(titles()).toBe('Hades');
    });

    it('clears the wishlist on sign-out', async () => {
        stubFetch({ initial: [item(1, 'Celeste', JANUARY)] });
        const view = renderProvider();
        await settled();
        expect(titles()).toBe('Celeste');

        auth.user = null;
        await act(async () => {
            view.rerender(
                <WishlistProvider>
                    <Probe />
                </WishlistProvider>,
            );
        });

        expect(titles()).toBe('');
    });
});
