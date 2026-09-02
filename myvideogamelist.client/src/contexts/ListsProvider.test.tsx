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
            <span data-testid="pending">{String(lists.isPending(1))}</span>
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

describe('two mutations at once', () => {
    const HADES = entry({ game: { id: 2, title: 'Hades' } });

    /**
     * A stub that can hold chosen requests open, so a second mutation can complete while a first
     * is still in flight — which is the whole subject of this block.
     *
     * Keyed by method and URL together, because adding to a list and removing from one are a PUT
     * and a DELETE to the same path.
     */
    function concurrencyStub(options: {
        lists?: ListsPayload;
        /** Requests held open until `release`. */
        hold?: string[];
        /** Requests that never arrive at all — see `reject` in the tests below. */
        reject?: string[];
        /** Requests answered with a 500. */
        failing?: string[];
    }) {
        const calls: Recorded[] = [];
        const settlers = new Map<string, (status: number) => void>();

        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            const key = `${method} ${url}`;
            calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

            if (key === 'GET /api/lists') {
                const body = JSON.stringify({ lists: options.lists ?? {} });
                return Promise.resolve(new Response(body, { status: 200 }));
            }
            if (key === 'GET /api/user/list-preferences') {
                const body = JSON.stringify({ view: 'tiles', sorts: {} });
                return Promise.resolve(new Response(body, { status: 200 }));
            }
            if (options.reject?.includes(key)) {
                // What the browser actually does when the API is unreachable: it rejects. It does
                // not hand back a response with a status for the code to check.
                return Promise.reject(new TypeError('Failed to fetch'));
            }
            if (options.hold?.includes(key)) {
                return new Promise<Response>(resolve => {
                    settlers.set(key, status =>
                        resolve(new Response(status === 204 ? null : 'nope', { status })));
                });
            }
            if (options.failing?.includes(key)) {
                return Promise.resolve(new Response('nope', { status: 500 }));
            }
            return Promise.resolve(new Response(null, { status: 204 }));
        });

        vi.stubGlobal('fetch', fetchMock);

        return {
            calls,
            /** Settles a held request and flushes everything it causes. */
            release: (key: string, status: number) => act(async () => {
                const settle = settlers.get(key);
                if (!settle) throw new Error(`${key} was never held`);
                settle(status);
                await Promise.resolve();
            }),
        };
    }

    /** Two games, so a mutation for one can be caught undoing the other. */
    function PairProbe() {
        const lists = useLists();
        const titles = { 1: 'Celeste', 2: 'Hades' } as Record<number, string>;

        return (
            <div>
                <span data-testid="loading">{String(lists.loading)}</span>
                <span data-testid="error">{lists.mutationError ?? ''}</span>
                {(['playing', 'finished'] as ListId[]).map(id => (
                    <span key={id} data-testid={`list-${id}`}>
                        {lists.lists[id].map(e => `${e.game.title}(${e.score ?? '-'})`).join(',')}
                    </span>
                ))}
                {[1, 2].map(id => (
                    <span key={id}>
                        <button onClick={() => void lists.addToList('finished', game({ id, title: titles[id] }))}>
                            {`move ${id}`}
                        </button>
                        <button onClick={() => void lists.removeFromList('playing', id)}>{`remove ${id}`}</button>
                        <button onClick={() => void lists.setScore(id, 9)}>{`score ${id}`}</button>
                        <button onClick={() => void lists.deleteEntry(id)}>{`delete ${id}`}</button>
                    </span>
                ))}
            </div>
        );
    }

    async function mountPair(options: Parameters<typeof concurrencyStub>[0]) {
        const stub = concurrencyStub(options);
        render(<ListsProvider><PairProbe /></ListsProvider>);
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
        return stub;
    }

    const playing = () => screen.getByTestId('list-playing');
    const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

    /*
     * The pending set is per game id, so mutations for two different games overlap by design.
     * Rolling one back by restoring the lists as they were before *its* request therefore undoes
     * whatever the other one did in the meantime, and the symptom is a game the user removed
     * coming back on its own. Each of these fails the removed game and checks that the game
     * nobody touched stays gone.
     */

    it('undoes only the game it was about when a removal fails', async () => {
        const { release } = await mountPair({
            lists: { playing: [CELESTE, HADES] },
            hold: ['DELETE /api/lists/2'],
        });

        await press('remove 2');
        await press('remove 1');
        await waitFor(() => expect(playing()).toBeEmptyDOMElement());

        await release('DELETE /api/lists/2', 500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).not.toHaveTextContent('Celeste');
    });

    it('undoes only the game it was about when a score fails', async () => {
        // Scoring is the one with no rollback of its own to speak of: it used to put back every
        // list as it found them, which is every other game's state as well.
        const { release } = await mountPair({
            lists: { playing: [CELESTE, HADES] },
            hold: ['PUT /api/entries/1/score'],
        });

        await press('score 1');
        await press('delete 2');
        await waitFor(() => expect(playing()).not.toHaveTextContent('Hades'));

        await release('PUT /api/entries/1/score', 500);

        expect(playing()).toHaveTextContent('Celeste(7)');
        expect(playing()).not.toHaveTextContent('Hades');
    });

    it('undoes only the game it was about when a delete fails', async () => {
        const { release } = await mountPair({
            lists: { playing: [CELESTE, HADES] },
            hold: ['DELETE /api/entries/2'],
        });

        await press('delete 2');
        await press('remove 1');
        await waitFor(() => expect(playing()).toBeEmptyDOMElement());

        await release('DELETE /api/entries/2', 500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).not.toHaveTextContent('Celeste');
    });

    it('undoes only the game it was about when a move fails', async () => {
        const { release } = await mountPair({
            lists: { playing: [CELESTE, HADES] },
            hold: ['PUT /api/lists/2'],
        });

        await press('move 2');
        await press('remove 1');
        await waitFor(() => expect(playing()).toBeEmptyDOMElement());

        await release('PUT /api/lists/2', 500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).not.toHaveTextContent('Celeste');
        expect(screen.getByTestId('list-finished')).toBeEmptyDOMElement();
    });

    it('restores the right membership when a game left from in front of it', async () => {
        /*
         * Three entries, because that is the size at which a remembered *position* goes wrong: with
         * `[Celeste, Hades, Cuphead]`, holding Hades' move and then removing Celeste leaves
         * `[Cuphead]`, and an index of 1 captured before the request now points past Cuphead
         * instead of before it.
         *
         * A rollback owes membership and the score, and deliberately not the order: `ListsPage`
         * renders every list through `sortEntries`, which breaks ties on title precisely so that
         * the result cannot depend on the order the API happened to return. So this asserts what is
         * contracted — both surviving games present, the moved one back out of `finished` — and
         * says nothing about their order, which is why the position was dropped rather than
         * anchored to a neighbour.
         */
        const CUPHEAD = entry({ game: { id: 3, title: 'Cuphead' } });
        const { release } = await mountPair({
            lists: { playing: [CELESTE, HADES, CUPHEAD] },
            hold: ['PUT /api/lists/2'],
        });

        await press('move 2');
        await press('remove 1');
        await waitFor(() => expect(playing().textContent).toBe('Cuphead(-)'));

        await release('PUT /api/lists/2', 500);

        expect(playing()).toHaveTextContent('Hades');
        expect(playing()).toHaveTextContent('Cuphead');
        expect(playing()).not.toHaveTextContent('Celeste');
        expect(screen.getByTestId('list-finished')).toBeEmptyDOMElement();
    });

    it('refuses a second score while the first is still saving', async () => {
        // Two scores in flight for one game is the same-game version of the bug above: the first
        // to fail rolls back to a value the second one has already replaced.
        const { calls } = await mountPair({
            lists: { playing: [CELESTE] },
            hold: ['PUT /api/entries/1/score'],
        });

        await press('score 1');
        await press('score 1');

        expect(calls.filter(c => c.url === '/api/entries/1/score')).toHaveLength(1);
    });

    /*
     * `fetch` rejects when the API is unreachable rather than returning a response with a status
     * — the trap `CLAUDE.md` records for loaders, and these three had it too. Only `!res.ok` was
     * handled, so a dead API left the optimistic change on screen as though it had been saved,
     * and the rejection escaped as an unhandled promise because every caller fires these with
     * `void`.
     */

    it('rolls a move back when the request never arrives', async () => {
        await mountPair({ lists: { playing: [CELESTE] }, reject: ['PUT /api/lists/1'] });

        await press('move 1');

        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));
        expect(screen.getByTestId('list-finished')).toBeEmptyDOMElement();
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to update list');
    });

    it('rolls a removal back when the request never arrives', async () => {
        await mountPair({ lists: { playing: [CELESTE] }, reject: ['DELETE /api/lists/1'] });

        await press('remove 1');

        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to remove from list');
    });

    it('rolls a delete back when the request never arrives', async () => {
        await mountPair({ lists: { playing: [CELESTE] }, reject: ['DELETE /api/entries/1'] });

        await press('delete 1');

        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));
        expect(screen.getByTestId('error')).toHaveTextContent('Failed to remove your data');
    });

    it('clears the banner once a change succeeds', async () => {
        // There is no dismiss control, so nothing else would ever take it down: the banner would
        // sit there describing a failure the user has already retried successfully.
        await mountPair({ lists: { playing: [CELESTE] }, failing: ['DELETE /api/lists/1'] });

        await press('remove 1');
        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Failed to remove'));

        await press('move 1');

        await waitFor(() => expect(screen.getByTestId('error')).toBeEmptyDOMElement());
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
        /** Successive preference payloads, so one account can answer differently from the next. */
        prefs?: { view: string }[];
    }) {
        let settle!: (status: number) => void;
        let loadIndex = 0;
        let prefCount = 0;
        // Only the first matching request is held, so a later account can answer normally.
        let heldOnce = false;

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
                if (options.preferences === 'fail') {
                    return Promise.resolve(new Response('nope', { status: 500 }));
                }
                const seq = options.prefs;
                const view = seq === undefined
                    ? 'tiles'
                    : seq[Math.min(prefCount++, seq.length - 1)].view;
                const body = JSON.stringify({ view, sorts: {} });
                if (`${method} ${url}` === options.deferred && !heldOnce) {
                    heldOnce = true;
                    return new Promise<Response>(resolve => {
                        settle = () => resolve(new Response(body, { status: 200 }));
                    });
                }
                return Promise.resolve(new Response(body, { status: 200 }));
            }
            if (`${method} ${url}` === options.deferred && !heldOnce) {
                heldOnce = true;
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

    it('drops the previous account preference response when it arrives late', async () => {
        /*
         * What this actually pins is the AbortController: by the time a response arrives this
         * late, the effect cleanup has aborted it and the handler returns before dispatching.
         * Verified by removing the session stamp from PREFERENCES_LOADED — the test still passes,
         * so it is the abort doing the work, not the stamp.
         *
         * The stamp is still there, and is deliberately belt-and-braces: the abort runs in the
         * effect cleanup, which happens after the commit, so a response resolving in between
         * would slip past it. That window cannot be reproduced here — see the note in
         * ListsProvider on why — so the stamp is reasoned, not covered.
         */
        const { release } = sessionStub({
            loads: [{ playing: [CELESTE] }, { playing: [HADES] }],
            deferred: 'GET /api/user/list-preferences',
            prefs: [{ view: 'table' }, { view: 'tiles' }],
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        await signIn(BOB, view);
        await waitFor(() => expect(playing()).toHaveTextContent('Hades'));
        expect(screen.getByTestId('view')).toHaveTextContent('tiles');

        // Alice asked for table; it arrives now, after Bob is on screen.
        await release(200);

        expect(screen.getByTestId('view')).toHaveTextContent('tiles');
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

    it('does not leave the next account holding the previous one lock', async () => {
        /*
         * The pending set is what stops two writes to one entry row overlapping, and it disables
         * that game's controls while a request is out. Kept in its own `useState` it was the one
         * piece of state the account change did not clear, so a game the previous account had left
         * in flight stayed locked for the new one — and stayed locked indefinitely if that request
         * never settled, which is the case nothing else recovers from.
         */
        sessionStub({
            loads: [{ playing: [CELESTE] }, { playing: [CELESTE] }],
            deferred: 'PUT /api/entries/1/score',
        });
        const view = mount();
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        // Alice starts a score that never comes back.
        await userEvent.click(screen.getByRole('button', { name: 'score 9' }));
        expect(screen.getByTestId('pending')).toHaveTextContent('true');

        await signIn(BOB, view);
        await waitFor(() => expect(playing()).toHaveTextContent('Celeste(7)'));

        expect(screen.getByTestId('pending')).toHaveTextContent('false');
    });
});
