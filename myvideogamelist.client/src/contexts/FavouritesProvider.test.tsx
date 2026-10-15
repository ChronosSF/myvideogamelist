import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FavouritesProvider } from '@/contexts/FavouritesProvider';
import { useFavourites } from '@/hooks/useFavourites';
import type { FavouriteDto } from '@/types/favourite';
import { game } from '@/test/factories';

const ALICE = { id: 'u1', email: 'alice@test.local' };
const BOB = { id: 'u2', email: 'bob@test.local' };

/** One stable object, reassigned per test — see WishlistProvider.test.tsx for why never a literal. */
const auth = {
    user: ALICE as typeof ALICE | null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const CELESTE = game({ id: 1, title: 'Celeste' });
const TUNIC = game({ id: 5, title: 'Tunic' });

function favourite(
    id: number,
    title: string,
    addedAt = '2026-01-01T00:00:00+00:00',
    position: number | null = null,
): FavouriteDto {
    return { game: game({ id, title }), addedAt, position };
}

interface Recorded {
    method: string;
    url: string;
    /** The body a write sent, parsed, for a move's positions. */
    body?: unknown;
}

const POSITIONS = '/api/favourites/positions';

/**
 * The favourites endpoints and nothing else. The state machine behind them is `useGameAxis`, which
 * `WishlistProvider.test.tsx` covers in depth; these tests are about this provider's wiring — which
 * endpoint, which messages, and that it is a separate axis from the wishlist.
 */
function stubFetch(options: {
    /** Successive GET payloads — one per load, the last repeating. */
    loads?: FavouriteDto[][];
    mutationStatus?: number;
    /** Successive statuses for one URL's writes, the last repeating, ahead of `mutationStatus`. */
    statuses?: Record<string, number[]>;
    /** What a successful `PUT` to a URL answers with, as the server does. Otherwise it answers 204. */
    added?: Record<string, { addedAt: string; position: number | null }>;
    deferred?: string[];
    /** URLs whose request never arrives: `fetch` rejects, as it does when the API is unreachable. */
    unreachable?: string[];
} = {}) {
    const calls: Recorded[] = [];
    const held = new Map<string, (response: Response) => void>();
    const loads = options.loads ?? [[]];
    const statuses = Object.fromEntries(
        Object.entries(options.statuses ?? {}).map(([url, list]) => [url, [...list]]));
    let getCount = 0;

    const statusFor = (url: string): number => {
        const queue = statuses[url];
        if (queue === undefined) return options.mutationStatus ?? 204;
        return queue.length > 1 ? queue.shift()! : queue[0];
    };

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push(typeof init?.body === 'string'
            ? { method, url, body: JSON.parse(init.body) }
            : { method, url });

        if (options.unreachable?.includes(url)) {
            return Promise.reject(new TypeError('Failed to fetch'));
        }
        if (options.deferred?.includes(url)) {
            return new Promise<Response>(resolve => held.set(url, resolve));
        }
        if (method === 'GET') {
            const load = loads[Math.min(getCount++, loads.length - 1)];
            return Promise.resolve(new Response(JSON.stringify(load), { status: 200 }));
        }
        const status = statusFor(url);
        const answer = method === 'PUT' ? options.added?.[url] : undefined;
        if (answer !== undefined && status < 300) {
            return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
        }
        return Promise.resolve(new Response(status === 204 ? null : 'nope', { status }));
    });

    vi.stubGlobal('fetch', fetchMock);

    /** Answers a held request: with `body` as JSON when there is one, else empty or a refusal. */
    const release = (url: string, status: number, body?: unknown) =>
        act(async () => {
            held.get(url)!(new Response(
                body !== undefined ? JSON.stringify(body) : status === 204 ? null : 'nope',
                { status }));
            await Promise.resolve();
        });

    return { calls, release };
}

/** What the last move answered, so a test can read a refusal as well as see it. */
let moved: boolean | null = null;

function Probe() {
    const favourites = useFavourites();
    const move = (gameId: number, afterGameId: number | null) =>
        void favourites.moveInOrder(gameId, afterGameId).then(result => { moved = result; });

    return (
        <div>
            <span data-testid="titles">{favourites.items.map(i => i.game.title).join(',')}</span>
            <span data-testid="loading">{String(favourites.loading)}</span>
            <span data-testid="mutation-error">{favourites.mutationError ?? ''}</span>
            <span data-testid="order-error">{favourites.orderError ?? ''}</span>
            <span data-testid="is-celeste">{String(favourites.isFavourite(1))}</span>
            <span data-testid="pending">
                {favourites.items.filter(i => favourites.isPending(i.game.id)).map(i => i.game.title).join(',')}
            </span>
            <button onClick={() => void favourites.add(CELESTE)}>add celeste</button>
            <button onClick={() => void favourites.add(TUNIC)}>add tunic</button>
            <button onClick={() => void favourites.remove(2)}>remove hades</button>
            <button onClick={() => move(4, null)}>move inside first</button>
            <button onClick={() => move(4, 2)}>move inside after hades</button>
            <button onClick={() => move(2, 4)}>move hades after inside</button>
            <button onClick={() => favourites.reload()}>reload</button>
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
    moved = null;
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

/** Three favourites nobody has arranged, newest first: Hades, Outer Wilds, Inside. */
const UNARRANGED = [
    favourite(2, 'Hades', '2026-03-01T00:00:00+00:00'),
    favourite(3, 'Outer Wilds', '2026-02-01T00:00:00+00:00'),
    favourite(4, 'Inside', '2026-01-01T00:00:00+00:00'),
];

describe('FavouritesProvider hand order', () => {
    it('shows the favourites in the order the server sends, without sorting them again', async () => {
        stubFetch({ loads: [[
            favourite(4, 'Inside', '2026-01-01T00:00:00+00:00', -1024),
            favourite(2, 'Hades', '2026-03-01T00:00:00+00:00', 0),
            favourite(3, 'Outer Wilds', '2026-02-01T00:00:00+00:00'),
        ]] });
        renderProvider();
        await settled();

        expect(titles()).toBe('Inside,Hades,Outer Wilds');
    });

    it('moves a favourite through the order endpoint, writing only the positions it needs', async () => {
        // Nothing placed yet, so pulling Inside to the front places Inside and nothing else.
        const { calls } = stubFetch({ loads: [UNARRANGED] });
        renderProvider();
        await settled();

        await click('move inside first');

        await waitFor(() => expect(moved).toBe(true));
        expect(titles()).toBe('Inside,Hades,Outer Wilds');
        expect(calls).toContainEqual({
            method: 'PATCH',
            url: POSITIONS,
            body: { positions: [{ gameId: 4, position: 0 }] },
        });
        expect(calls.some(call => call.url.includes('/api/wishlist'))).toBe(false);
    });

    it('places the unplaced favourites a move passes, in the order they were shown', async () => {
        // Inside goes after Hades, and nobody is placed: Hades has to be placed for Inside to follow
        // it, and Outer Wilds, behind them, stays unplaced.
        const { calls } = stubFetch({ loads: [UNARRANGED] });
        renderProvider();
        await settled();

        await click('move inside after hades');

        await waitFor(() => expect(moved).toBe(true));
        expect(titles()).toBe('Hades,Inside,Outer Wilds');
        expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({
            positions: [{ gameId: 2, position: 0 }, { gameId: 4, position: 1024 }],
        });
    });

    it('puts back the positions it wrote when the save is refused, and says so in its own words', async () => {
        stubFetch({ loads: [UNARRANGED], mutationStatus: 500 });
        renderProvider();
        await settled();

        await click('move inside after hades');

        await waitFor(() => expect(moved).toBe(false));
        expect(titles()).toBe('Hades,Outer Wilds,Inside');
        expect(screen.getByTestId('order-error'))
            .toHaveTextContent('Failed to save the order of your favourites. Please try again.');
        // The order's own field: the add's and the remove's error, which every game page's favourite
        // toggle shows, says nothing about a move made on the showcase.
        expect(screen.getByTestId('mutation-error').textContent).toBe('');
        // Every lock it took is released, or the favourites it wrote could never move again.
        expect(screen.getByTestId('pending').textContent).toBe('');
    });

    it('puts them back when the save never arrives', async () => {
        stubFetch({ loads: [UNARRANGED], unreachable: [POSITIONS] });
        renderProvider();
        await settled();

        await click('move inside after hades');

        await waitFor(() => expect(moved).toBe(false));
        expect(titles()).toBe('Hades,Outer Wilds,Inside');
        expect(screen.getByTestId('order-error'))
            .toHaveTextContent('Failed to save the order of your favourites. Please try again.');
        expect(screen.getByTestId('pending').textContent).toBe('');
    });

    it('locks every favourite a move writes until it lands', async () => {
        const { release } = stubFetch({ loads: [UNARRANGED], deferred: [POSITIONS] });
        renderProvider();
        await settled();

        await click('move inside after hades');

        expect(titles()).toBe('Hades,Inside,Outer Wilds');
        expect(screen.getByTestId('pending').textContent).toBe('Hades,Inside');

        await release(POSITIONS, 204);

        await waitFor(() => expect(moved).toBe(true));
        expect(screen.getByTestId('pending').textContent).toBe('');
    });

    it('refuses, with a reason, a move that needs a favourite whose own save is out', async () => {
        // Tunic is being added, so it sits first among the unplaced. A move landing past it would have
        // to place it, and with two writes out for one row the first to fail would undo the second.
        const { calls } = stubFetch({ loads: [UNARRANGED], deferred: ['/api/favourites/5'] });
        renderProvider();
        await settled();

        await click('add tunic');
        expect(titles()).toBe('Tunic,Hades,Outer Wilds,Inside');

        await click('move inside after hades');

        await waitFor(() => expect(moved).toBe(false));
        expect(titles()).toBe('Tunic,Hades,Outer Wilds,Inside');
        expect(screen.getByTestId('order-error')).toHaveTextContent(/still saving/i);
        expect(calls.some(call => call.method === 'PATCH')).toBe(false);
        // Refused before a lock is taken: only the add's own is held, or Hades would stay locked.
        expect(screen.getByTestId('pending').textContent).toBe('Tunic');
    });

    it('puts a favourite made now after the ones placed by hand, first among the rest', async () => {
        stubFetch({ loads: [[
            favourite(2, 'Hades', '2026-03-01T00:00:00+00:00', 0),
            favourite(3, 'Outer Wilds', '2026-02-01T00:00:00+00:00'),
        ]] });
        renderProvider();
        await settled();

        await click('add tunic');

        await waitFor(() => expect(titles()).toBe('Hades,Tunic,Outer Wilds'));
    });

    it('keeps a move that a refetch lands in the middle of', async () => {
        // The reload's answer was composed before the move's write, so it still has Inside last.
        // Taken as it stands it would put Inside back, and the save landing after it would leave the
        // screen disagreeing with the server until the next load.
        const { release } = stubFetch({ loads: [UNARRANGED, UNARRANGED], deferred: [POSITIONS] });
        renderProvider();
        await settled();

        await click('move inside after hades');
        await click('reload');
        await settled();

        expect(titles()).toBe('Hades,Inside,Outer Wilds');

        await release(POSITIONS, 204);

        await waitFor(() => expect(moved).toBe(true));
        expect(titles()).toBe('Hades,Inside,Outer Wilds');
    });

    it("does not put a failed move back into the next account's favourites", async () => {
        const { release } = stubFetch({ loads: [UNARRANGED, []], deferred: [POSITIONS] });
        const view = renderProvider();
        await settled();

        await click('move inside after hades');

        auth.user = BOB;
        view.rerender(<FavouritesProvider><Probe /></FavouritesProvider>);
        await settled();

        await release(POSITIONS, 500);

        // Bob has no favourites. Alice's undo must neither write her games into his nor raise her
        // error on his screen.
        expect(titles()).toBe('');
        expect(screen.getByTestId('order-error').textContent).toBe('');
    });

    it("does not put Alice's undo onto the same game among Bob's favourites", async () => {
        // Bob has Inside too, placed first. Alice's undo names Inside with the position she had —
        // none — and applied to Bob's list it would send his Inside behind Hades.
        const { release } = stubFetch({
            loads: [UNARRANGED, [
                favourite(4, 'Inside', '2026-01-01T00:00:00+00:00', -1024),
                favourite(2, 'Hades', '2026-03-01T00:00:00+00:00', 0),
            ]],
            deferred: [POSITIONS],
        });
        const view = renderProvider();
        await settled();

        await click('move inside first');

        auth.user = BOB;
        view.rerender(<FavouritesProvider><Probe /></FavouritesProvider>);
        await settled();
        expect(titles()).toBe('Inside,Hades');

        await release(POSITIONS, 500);

        expect(titles()).toBe('Inside,Hades');
        expect(screen.getByTestId('order-error').textContent).toBe('');
    });

    it('orders the placed by their positions, not by when they were made', async () => {
        // Hades is the newest and goes last: the position decides among the placed, and a comparator
        // that fell back to the dates would put it first again.
        const { calls } = stubFetch({ loads: [UNARRANGED] });
        renderProvider();
        await settled();

        await click('move hades after inside');

        await waitFor(() => expect(moved).toBe(true));
        expect(titles()).toBe('Outer Wilds,Inside,Hades');
        expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({
            positions: [{ gameId: 3, position: 0 }, { gameId: 4, position: 1024 }, { gameId: 2, position: 2048 }],
        });
    });

    it("keeps a move's error apart from the add's and the remove's", async () => {
        stubFetch({ loads: [UNARRANGED], statuses: { [POSITIONS]: [500], '/api/favourites/5': [500] } });
        renderProvider();
        await settled();

        await click('move inside first');
        await waitFor(() => expect(moved).toBe(false));
        await click('add tunic');

        await waitFor(() => expect(screen.getByTestId('mutation-error'))
            .toHaveTextContent('Failed to update your favourites. Please try again.'));
        expect(screen.getByTestId('order-error'))
            .toHaveTextContent('Failed to save the order of your favourites. Please try again.');
    });

    it("takes down a failed move's error once a move saves", async () => {
        // Nothing else takes it down: the showcase's banner has no dismissal of its own.
        stubFetch({ loads: [UNARRANGED], statuses: { [POSITIONS]: [500, 204] } });
        renderProvider();
        await settled();

        await click('move inside first');
        await waitFor(() => expect(moved).toBe(false));
        expect(screen.getByTestId('order-error').textContent).not.toBe('');

        await click('move inside first');

        await waitFor(() => expect(moved).toBe(true));
        expect(screen.getByTestId('order-error').textContent).toBe('');
    });

    it("takes down a failed move's error when the favourites load afresh", async () => {
        // A fresh load supersedes what the last write said, as it does for the add's and the remove's.
        stubFetch({ loads: [UNARRANGED, UNARRANGED], statuses: { [POSITIONS]: [500] } });
        renderProvider();
        await settled();

        await click('move inside first');
        await waitFor(() => expect(moved).toBe(false));
        expect(screen.getByTestId('order-error').textContent).not.toBe('');

        await click('reload');
        await settled();

        expect(screen.getByTestId('order-error').textContent).toBe('');
    });

    it('refuses a move while the favourites are still loading, and sends nothing', async () => {
        // No order is known to plan against, and the answer landing after the write would undo it.
        const { calls, release } = stubFetch({ deferred: ['/api/favourites'] });
        renderProvider();

        await click('move inside first');

        await waitFor(() => expect(moved).toBe(false));
        expect(calls.some(call => call.method === 'PATCH')).toBe(false);
        await release('/api/favourites', 200, UNARRANGED);
    });

    it('drops a favourite whose move is out when a refetch says another device took it off', async () => {
        // The answer no longer has Inside, which is being moved. A placed game the answer lacks is one
        // that was taken off, not one being added, and is not kept on screen as though it were.
        const { release } = stubFetch({
            loads: [UNARRANGED, UNARRANGED.slice(0, 2)],
            deferred: [POSITIONS],
        });
        renderProvider();
        await settled();

        await click('move inside first');
        await click('reload');
        await settled();

        expect(titles()).toBe('Hades,Outer Wilds');

        await release(POSITIONS, 204);
        await waitFor(() => expect(moved).toBe(true));
        expect(titles()).toBe('Hades,Outer Wilds');
    });

    it('takes the place a refetch knows for a favourite still being added', async () => {
        // Another tab made Tunic a favourite and placed it after Hades. This tab's add is still out
        // when the reload answers, and the answer's place stands: the add put no place there.
        const { release } = stubFetch({
            loads: [
                UNARRANGED.slice(0, 2),
                [
                    favourite(2, 'Hades', '2026-03-01T00:00:00+00:00', 0),
                    favourite(5, 'Tunic', '2026-01-15T00:00:00+00:00', 1024),
                    favourite(3, 'Outer Wilds', '2026-02-01T00:00:00+00:00'),
                ],
            ],
            deferred: ['/api/favourites/5'],
        });
        renderProvider();
        await settled();

        await click('add tunic');
        expect(titles()).toBe('Tunic,Hades,Outer Wilds');

        await click('reload');
        await settled();
        expect(titles()).toBe('Hades,Tunic,Outer Wilds');

        await release('/api/favourites/5', 200, { addedAt: '2026-01-15T00:00:00+00:00', position: 1024 });
        await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe(''));
        expect(titles()).toBe('Hades,Tunic,Outer Wilds');
    });

    it('files a favourite another tab already made and placed where it stands, once the add answers', async () => {
        // Added here, Tunic waits first among the unplaced, after Inside. The answer says another tab
        // placed it between Hades and Inside, and that is where it goes — not among the unplaced by the
        // older date the answer also carries.
        stubFetch({
            loads: [[
                favourite(2, 'Hades', '2026-03-01T00:00:00+00:00', 0),
                favourite(4, 'Inside', '2026-01-01T00:00:00+00:00', 2048),
                favourite(3, 'Outer Wilds', '2026-02-01T00:00:00+00:00'),
            ]],
            added: { '/api/favourites/5': { addedAt: '2026-01-15T00:00:00+00:00', position: 1024 } },
        });
        renderProvider();
        await settled();

        await click('add tunic');

        await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe(''));
        expect(titles()).toBe('Hades,Tunic,Inside,Outer Wilds');
    });

    it('puts a new favourite last when every favourite is placed', async () => {
        const { release } = stubFetch({
            loads: [[
                favourite(2, 'Hades', '2026-03-01T00:00:00+00:00', 0),
                favourite(3, 'Outer Wilds', '2026-02-01T00:00:00+00:00', 1024),
            ]],
            deferred: ['/api/favourites/5'],
        });
        renderProvider();
        await settled();

        await click('add tunic');

        expect(titles()).toBe('Hades,Outer Wilds,Tunic');
        await release('/api/favourites/5', 204);
    });

    it('puts a placed favourite back in its place when its removal fails', async () => {
        // Hades is the newest, placed second. Put back by its date it would lead; by its place it
        // follows Inside.
        stubFetch({
            loads: [[
                favourite(4, 'Inside', '2026-01-01T00:00:00+00:00', -1024),
                favourite(2, 'Hades', '2026-03-01T00:00:00+00:00', 0),
                favourite(3, 'Outer Wilds', '2026-02-01T00:00:00+00:00'),
            ]],
            mutationStatus: 500,
        });
        renderProvider();
        await settled();

        await click('remove hades');

        await waitFor(() => expect(screen.getByTestId('mutation-error')).not.toBeEmptyDOMElement());
        expect(titles()).toBe('Inside,Hades,Outer Wilds');
    });
});
