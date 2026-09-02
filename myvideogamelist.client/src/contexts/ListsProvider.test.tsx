import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListsProvider } from '@/contexts/ListsProvider';
import { useLists } from '@/hooks/useLists';
import type { ListId, ListEntryDto } from '@/types/list';
import { entry, game } from '@/test/factories';

const ALICE = { id: 'u1', email: 'alice@test.local', theme: 'dark' };
const BOB = { id: 'u2', email: 'bob@test.local', theme: 'dark' };

// The provider only reads `user` and `loading`, and going through the real AuthProvider would
// mean mocking its fetches too.
//
// One module-level object handed back every time, not a fresh literal per call. The provider's
// fetch effect depends on `user`, so returning a new object each render would re-run the effect
// on every render it caused — an unbounded loop that ends in an out-of-memory crash rather than
// a failed assertion. `user` is reassigned on purpose by the session tests, which is exactly the
// dependency change a sign-in produces.
const auth = {
    user: ALICE as typeof ALICE | null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateTheme: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

type ListsPayload = Partial<Record<ListId, ListEntryDto[]>>;

interface Routes {
    lists?: ListsPayload;
    preferences?: { view: string; sorts: Record<string, { sortKey: string; descending: boolean }> };
    /** Paths whose mutations should fail, so rollback can be asserted. */
    failing?: string[];
}

/** Records every request so the tests can assert what was sent, not just what was rendered. */
interface Recorded {
    method: string;
    url: string;
    body: unknown;
}

function stubFetch(routes: Routes) {
    const calls: Recorded[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

        if (method === 'GET' && url === '/api/lists') {
            return new Response(JSON.stringify({ lists: routes.lists ?? {} }), { status: 200 });
        }
        if (method === 'GET' && url === '/api/user/list-preferences') {
            const prefs = routes.preferences ?? { view: 'tiles', sorts: {} };
            return new Response(JSON.stringify(prefs), { status: 200 });
        }
        if (routes.failing?.some(fragment => url.includes(fragment))) {
            return new Response('nope', { status: 500 });
        }
        return new Response(null, { status: 204 });
    });

    vi.stubGlobal('fetch', fetchMock);
    return calls;
}

/** Surfaces the parts of the context the assertions need, as plain text and buttons. */
function Probe({ listId = 'playing' as ListId }: { listId?: ListId }) {
    const lists = useLists();

    return (
        <div>
            <span data-testid="view">{lists.view}</span>
            <span data-testid="sort">{`${lists.sortFor(listId).key}:${lists.sortFor(listId).descending}`}</span>
            <span data-testid="loading">{String(lists.loading)}</span>
            <span data-testid="error">{lists.mutationError ?? ''}</span>
            <span data-testid="score">{String(lists.scoreFor(1))}</span>
            <span data-testid="found-in">{String(lists.getListFor(1))}</span>
            {(['backlog', 'playing', 'on_hold', 'finished', 'dropped'] as ListId[]).map(id => (
                <span key={id} data-testid={`list-${id}`}>
                    {lists.lists[id].map(e => `${e.game.title}(${e.score ?? '-'})`).join(',')}
                </span>
            ))}
            <button onClick={() => void lists.addToList('finished', game({ id: 1, title: 'Celeste' }))}>
                move to finished
            </button>
            <button onClick={() => void lists.removeFromList('playing', 1)}>remove</button>
            <button onClick={() => void lists.setScore(1, 9)}>score 9</button>
            <button onClick={() => void lists.deleteEntry(1)}>delete entry</button>
            <button onClick={() => lists.setView('table')}>use table</button>
            <button onClick={() => lists.setSort(listId, { key: 'score', descending: true })}>sort by score</button>
        </div>
    );
}

async function renderProvider(routes: Routes = {}) {
    const calls = stubFetch(routes);
    render(<ListsProvider><Probe /></ListsProvider>);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    return calls;
}

const CELESTE = entry({ game: { id: 1, title: 'Celeste' }, score: 7 });

beforeEach(() => {
    vi.unstubAllGlobals();
    auth.user = ALICE;
});

describe('loading', () => {
    it('fills every status even when the server omits the empty ones', async () => {
        await renderProvider({ lists: { playing: [CELESTE] } });

        expect(screen.getByTestId('list-playing')).toHaveTextContent('Celeste(7)');
        for (const id of ['backlog', 'on_hold', 'finished', 'dropped']) {
            expect(screen.getByTestId(`list-${id}`)).toBeEmptyDOMElement();
        }
    });

    it('applies stored preferences', async () => {
        await renderProvider({
            preferences: { view: 'table', sorts: { playing: { sortKey: 'score', descending: false } } },
        });

        expect(screen.getByTestId('view')).toHaveTextContent('table');
        expect(screen.getByTestId('sort')).toHaveTextContent('score:false');
    });

    it('falls back to the default sort for a list the user never re-sorted', async () => {
        await renderProvider({ preferences: { view: 'tiles', sorts: {} } });

        expect(screen.getByTestId('sort')).toHaveTextContent('added:true');
    });

    it('still shows the lists when the preference fetch fails', async () => {
        // Presentation settings are not worth failing someone's actual data over.
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            if (String(input) === '/api/lists') {
                return new Response(JSON.stringify({ lists: { playing: [CELESTE] } }), { status: 200 });
            }
            return new Response('nope', { status: 500 });
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<ListsProvider><Probe /></ListsProvider>);
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

        expect(screen.getByTestId('list-playing')).toHaveTextContent('Celeste(7)');
        expect(screen.getByTestId('view')).toHaveTextContent('tiles');
    });
});

describe('moving between lists', () => {
    it('carries the score across, so it does not blink out and back', async () => {
        // The point of the whole feature: a score belongs to the game, not to the list.
        await renderProvider({ lists: { playing: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'move to finished' }));

        expect(screen.getByTestId('list-finished')).toHaveTextContent('Celeste(7)');
        expect(screen.getByTestId('list-playing')).toBeEmptyDOMElement();
    });

    it('sends the target status', async () => {
        const calls = await renderProvider({ lists: { playing: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'move to finished' }));

        const put = calls.find(c => c.method === 'PUT' && c.url === '/api/lists/1');
        expect(put?.body).toEqual({ status: 'finished' });
    });

    it('rolls every list back when the move fails', async () => {
        await renderProvider({ lists: { playing: [CELESTE] }, failing: ['/api/lists/1'] });

        await userEvent.click(screen.getByRole('button', { name: 'move to finished' }));

        await waitFor(() => expect(screen.getByTestId('list-playing')).toHaveTextContent('Celeste(7)'));
        expect(screen.getByTestId('list-finished')).toBeEmptyDOMElement();
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to update list');
    });
});

describe('leaving every list', () => {
    it('takes the game out of the list it was in', async () => {
        await renderProvider({ lists: { playing: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));

        expect(screen.getByTestId('list-playing')).toBeEmptyDOMElement();
        expect(screen.getByTestId('found-in')).toHaveTextContent('null');
    });

    it('calls the list endpoint, not the entry endpoint', async () => {
        // Removing from lists must never be routed to the delete-everything endpoint.
        const calls = await renderProvider({ lists: { playing: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));

        expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/lists/1')).toBe(true);
        expect(calls.some(c => c.url === '/api/entries/1')).toBe(false);
    });

    it('puts the game back when the request fails', async () => {
        await renderProvider({ lists: { playing: [CELESTE] }, failing: ['/api/lists/1'] });

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));

        await waitFor(() => expect(screen.getByTestId('list-playing')).toHaveTextContent('Celeste(7)'));
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to remove from list');
    });
});

describe('scoring', () => {
    it('updates the score in place, wherever the game sits', async () => {
        await renderProvider({ lists: { on_hold: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'score 9' }));

        expect(screen.getByTestId('list-on_hold')).toHaveTextContent('Celeste(9)');
        expect(screen.getByTestId('score')).toHaveTextContent('9');
    });

    it('posts to the entry endpoint rather than a list one', async () => {
        const calls = await renderProvider({ lists: { playing: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'score 9' }));

        const put = calls.find(c => c.url === '/api/entries/1/score');
        expect(put?.method).toBe('PUT');
        expect(put?.body).toEqual({ score: 9 });
    });

    it('restores the old score when the save fails', async () => {
        await renderProvider({ lists: { playing: [CELESTE] }, failing: ['/score'] });

        await userEvent.click(screen.getByRole('button', { name: 'score 9' }));

        await waitFor(() => expect(screen.getByTestId('list-playing')).toHaveTextContent('Celeste(7)'));
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to save your score');
    });

    it('does not move the game between lists', async () => {
        const calls = await renderProvider({ lists: { playing: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'score 9' }));

        expect(screen.getByTestId('found-in')).toHaveTextContent('playing');
        expect(calls.some(c => c.url === '/api/lists/1')).toBe(false);
    });
});

describe('deleting everything about a game', () => {
    it('drops the game from the lists', async () => {
        await renderProvider({ lists: { finished: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'delete entry' }));

        expect(screen.getByTestId('list-finished')).toBeEmptyDOMElement();
    });

    it('calls the entry endpoint', async () => {
        const calls = await renderProvider({ lists: { finished: [CELESTE] } });

        await userEvent.click(screen.getByRole('button', { name: 'delete entry' }));

        expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/entries/1')).toBe(true);
    });

    it('treats a 404 as success, since the wanted state is already true', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/lists' && (init?.method ?? 'GET') === 'GET') {
                return new Response(JSON.stringify({ lists: { finished: [CELESTE] } }), { status: 200 });
            }
            if (url === '/api/user/list-preferences') {
                return new Response(JSON.stringify({ view: 'tiles', sorts: {} }), { status: 200 });
            }
            return new Response('gone', { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<ListsProvider><Probe /></ListsProvider>);
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

        await userEvent.click(screen.getByRole('button', { name: 'delete entry' }));

        expect(screen.getByTestId('list-finished')).toBeEmptyDOMElement();
        expect(screen.getByTestId('error')).toBeEmptyDOMElement();
    });

    it('restores the game on a real failure', async () => {
        await renderProvider({ lists: { finished: [CELESTE] }, failing: ['/api/entries/1'] });

        await userEvent.click(screen.getByRole('button', { name: 'delete entry' }));

        await waitFor(() => expect(screen.getByTestId('list-finished')).toHaveTextContent('Celeste(7)'));
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to remove your data');
    });
});

describe('preferences', () => {
    it('applies a layout change immediately and persists it', async () => {
        const calls = await renderProvider();

        await userEvent.click(screen.getByRole('button', { name: 'use table' }));

        expect(screen.getByTestId('view')).toHaveTextContent('table');
        const put = calls.find(c => c.method === 'PUT' && c.url === '/api/user/list-preferences');
        expect(put?.body).toMatchObject({ view: 'table' });
    });

    it('sends the sort map as a list the API can validate per item', async () => {
        const calls = await renderProvider();

        await userEvent.click(screen.getByRole('button', { name: 'sort by score' }));

        const put = calls.find(c => c.method === 'PUT' && c.url === '/api/user/list-preferences');
        expect(put?.body).toEqual({
            view: 'tiles',
            sorts: [{ status: 'playing', sortKey: 'score', descending: true }],
        });
    });

    it('keeps the new setting even when saving it fails', async () => {
        // A lost preference is not worth interrupting anyone over; the next load reconciles.
        await renderProvider({ failing: ['/api/user/list-preferences'] });

        await userEvent.click(screen.getByRole('button', { name: 'use table' }));

        expect(screen.getByTestId('view')).toHaveTextContent('table');
        expect(screen.getByTestId('error')).toBeEmptyDOMElement();
    });

    it('carries the existing sorts along when only the layout changes', async () => {
        const calls = await renderProvider({
            preferences: { view: 'tiles', sorts: { finished: { sortKey: 'score', descending: true } } },
        });

        await userEvent.click(screen.getByRole('button', { name: 'use table' }));

        const put = calls.find(c => c.method === 'PUT' && c.url === '/api/user/list-preferences');
        expect(put?.body).toEqual({
            view: 'table',
            sorts: [{ status: 'finished', sortKey: 'score', descending: true }],
        });
    });
});

describe('across a session change', () => {
    const HADES = entry({ game: { id: 2, title: 'Hades' } });

    /**
     * A stub that can hold one request open across a sign-in.
     *
     * Keyed by method and URL together, because adding to a list and removing from one are a PUT
     * and a DELETE to the same path.
     */
    function sessionStub(options: {
        loads: (ListsPayload | 'fail')[];
        deferred: string;
        /** Fails the preference fetch too, so only a state reset can explain a default. */
        preferences?: 'fail';
    }) {
        let settle!: (status: number) => void;
        let loadIndex = 0;

        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (method === 'GET' && url === '/api/lists') {
                const lists = options.loads[Math.min(loadIndex++, options.loads.length - 1)];
                return Promise.resolve(lists === 'fail'
                    ? new Response('nope', { status: 500 })
                    : new Response(JSON.stringify({ lists }), { status: 200 }));
            }
            if (method === 'GET' && url === '/api/user/list-preferences') {
                return Promise.resolve(options.preferences === 'fail'
                    ? new Response('nope', { status: 500 })
                    : new Response(JSON.stringify({ view: 'tiles', sorts: {} }), { status: 200 }));
            }
            if (`${method} ${url}` === options.deferred) {
                return new Promise<Response>(resolve => {
                    settle = (status: number) =>
                        resolve(new Response(status === 204 ? null : 'nope', { status }));
                });
            }
            return Promise.resolve(new Response(null, { status: 204 }));
        });

        vi.stubGlobal('fetch', fetchMock);

        return {
            /** Settles the held request and flushes everything it causes. */
            release: (status: number) => act(async () => {
                settle(status);
                await Promise.resolve();
            }),
            /**
             * Settles it without an `act` of its own, for the one test that has to interleave the
             * completion with a re-render inside a single `act` block.
             */
            settle: (status: number) => settle(status),
        };
    }

    function mount() {
        return render(<ListsProvider><Probe /></ListsProvider>);
    }

    /** Signs a different account in, which is the dependency change the real provider sees. */
    async function signIn(user: typeof ALICE | null, view: ReturnType<typeof mount>) {
        auth.user = user;
        await act(async () => {
            view.rerender(<ListsProvider><Probe /></ListsProvider>);
        });
    }

    const playing = () => screen.getByTestId('list-playing');

    /*
     * Each of these holds one mutation open, signs a second account in, and then fails the
     * mutation. Every rollback closes over entries captured from the first account, so an
     * unguarded one writes them into the second account’s lists — one user seeing another
     * user’s games. All four mutations carry their own rollback, hence four tests.
     */
    it('does not put a failed move back into the next account', async () => {
        const { release } = sessionStub({
            loads: [{ playing: [CELESTE] }, { playing: [HADES] }],
            deferred: 'PUT /api/lists/1',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'move to finished' }));
        expect(screen.getByTestId('list-finished')).toHaveTextContent('Celeste(7)');

        await signIn(BOB, view);
        await waitFor(() => expect(playing()).toHaveTextContent('Hades'));

        await release(500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).not.toHaveTextContent('Celeste');
        expect(screen.getByTestId('list-finished')).toBeEmptyDOMElement();
    });

    it('does not put a failed removal back into the next account', async () => {
        const { release } = sessionStub({
            loads: [{ playing: [CELESTE] }, { playing: [HADES] }],
            deferred: 'DELETE /api/lists/1',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));
        expect(playing()).toBeEmptyDOMElement();

        await signIn(BOB, view);
        await waitFor(() => expect(playing()).toHaveTextContent('Hades'));

        await release(500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).not.toHaveTextContent('Celeste');
    });

    it('does not put a failed score back into the next account', async () => {
        // setScore takes no pending lock at all, so it is the likeliest of the four to still be
        // in flight when something else happens.
        const { release } = sessionStub({
            loads: [{ playing: [CELESTE] }, { playing: [HADES] }],
            deferred: 'PUT /api/entries/1/score',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'score 9' }));
        expect(playing()).toHaveTextContent('Celeste(9)');

        await signIn(BOB, view);
        await waitFor(() => expect(playing()).toHaveTextContent('Hades'));

        await release(500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).not.toHaveTextContent('Celeste');
    });

    it('does not put a failed delete back into the next account', async () => {
        const { release } = sessionStub({
            loads: [{ playing: [CELESTE] }, { playing: [HADES] }],
            deferred: 'DELETE /api/entries/1',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'delete entry' }));
        expect(playing()).toBeEmptyDOMElement();

        await signIn(BOB, view);
        await waitFor(() => expect(playing()).toHaveTextContent('Hades'));

        await release(500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).not.toHaveTextContent('Celeste');
    });

    it('does not show the next account the failure banner either', async () => {
        // The rollback and the banner are dispatched together, so the guard has to cover both.
        // An error about a game the new user never touched is its own small confusion.
        const { release } = sessionStub({
            loads: [{ playing: [CELESTE] }, { playing: [HADES] }],
            deferred: 'DELETE /api/lists/1',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));
        await signIn(BOB, view);
        await waitFor(() => expect(playing()).toHaveTextContent('Hades'));

        await release(500);

        expect(screen.getByTestId('error')).toHaveTextContent('');
    });

    it('shows the next account nothing when its own load fails, not the previous account lists', async () => {
        /*
         * No mutation involved, which is what makes this its own bug rather than a variant of the
         * ones above: FETCH_ERROR keeps state.lists, so a failed load for the new account left the
         * previous account entries on screen underneath the error. The state is cleared when the
         * account changes instead of when the fetch succeeds, so a fetch that never succeeds
         * cannot strand anything.
         */
        sessionStub({
            loads: [{ playing: [CELESTE] }, 'fail'],
            deferred: 'DELETE /api/lists/never-called',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await signIn(BOB, view);
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

        expect(playing()).toBeEmptyDOMElement();
        expect(playing()).not.toHaveTextContent('Celeste');
    });

    it('does not carry the previous account preferences over either', async () => {
        // The sort and layout are per-user rows on the server, so they belong to the account that
        // loaded them and have to go with it.
        //
        // Both fetches are made to fail: with the preference fetch succeeding, the default it
        // returns would explain the assertion just as well as the reset does, and the test would
        // pass whether or not the reset happened at all.
        sessionStub({
            loads: [{ playing: [CELESTE] }, 'fail'],
            deferred: 'DELETE /api/lists/never-called',
            preferences: 'fail',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'use table' }));
        expect(screen.getByTestId('view')).toHaveTextContent('table');

        await signIn(BOB, view);
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

        expect(screen.getByTestId('view')).toHaveTextContent('tiles');
    });

    it('rejects a stale completion that lands before the account effect has run', async () => {
        /*
         * The window the other tests in this block cannot reach.
         *
         * They call `signIn`, which exits its own `act` and therefore flushes the provider effect
         * before the request is released — so the session marker is always up to date by the time
         * the rollback happens, whether it was written during render or in the effect. That made
         * them pass against a marker updated in a passive effect, which is wrong: an effect runs
         * after the commit, so the new account is on screen while the marker still names the old
         * one, and a completion arriving in between is exactly the leak.
         *
         * Re-rendering and settling the request inside one `act` block reproduces it. A nested
         * `act` does not flush passive effects; the outermost one does, on exit.
         *
         * The second load is made to fail on purpose. A successful one would overwrite the leaked
         * entries a moment later and hide the bug behind a race.
         */
        const { settle } = sessionStub({
            loads: [{ playing: [CELESTE] }, 'fail'],
            deferred: 'DELETE /api/lists/1',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));
        expect(playing()).toBeEmptyDOMElement();

        auth.user = BOB;
        await act(async () => {
            // Commits with BOB. The provider effect has not run yet.
            view.rerender(<ListsProvider><Probe /></ListsProvider>);
            settle(500);
            await Promise.resolve();
        });

        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

        expect(playing()).toBeEmptyDOMElement();
        expect(playing()).not.toHaveTextContent('Celeste');
    });

    it('still rolls back normally when the account has not changed', async () => {
        // The guard must not swallow the ordinary failure it sits in front of.
        const { release } = sessionStub({
            loads: [{ playing: [CELESTE] }],
            deferred: 'DELETE /api/lists/1',
        });
        mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));
        expect(playing()).toBeEmptyDOMElement();

        await release(500);

        expect(playing()).toHaveTextContent('Celeste(7)');
        expect(screen.getByTestId('error')).toHaveTextContent(/failed to remove from list/i);
    });
});
