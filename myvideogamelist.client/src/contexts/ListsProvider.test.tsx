import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListsProvider } from '@/contexts/ListsProvider';
import { useLists } from '@/hooks/useLists';
import type { ListId, ListEntryDto } from '@/types/list';
import { entry, game } from '@/test/factories';

// The provider only reads `user` and `loading`, and going through the real AuthProvider would
// mean mocking its fetches too.
//
// The returned object is a module-level constant, not a fresh literal per call. The provider's
// fetch effect depends on `user`, so returning a new object each render would re-run the effect
// on every render it caused — an unbounded loop that ends in an out-of-memory crash rather than
// a failed assertion.
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
