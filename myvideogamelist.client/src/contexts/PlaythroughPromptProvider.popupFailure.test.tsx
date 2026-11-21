import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListsProvider } from '@/contexts/ListsProvider';
import { PlaythroughPromptProvider } from '@/contexts/PlaythroughPromptProvider';
import { useLists } from '@/hooks/useLists';
import { entry, game, playthrough } from '@/test/factories';

// The popup's code cannot be fetched: a tab open across a deploy whose old chunk is gone, or a dropped
// connection. Its own file, because the mock stands for the whole run of it.
vi.mock('@/components/PlaythroughPopup', () => {
    throw new Error('Failed to fetch dynamically imported module');
});

const auth = { user: { id: 'u1', email: 'alice@test.local' }, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const CELESTE = game({ id: 1, title: 'Celeste' });

function Mover() {
    const { addToList, loading } = useLists();
    if (loading) return <p>Loading</p>;
    return <button type="button" onClick={() => void addToList('playing', CELESTE)}>Celeste to playing</button>;
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
        if (method === 'GET' && url === '/api/lists') return json({ lists: { backlog: [entry({ game: CELESTE })] } });
        if (method === 'GET') return json({ view: 'tiles', sorts: {}, names: {} });
        if (method === 'PUT') return json({ moved: true, unfinishedPlaythrough: null });
        if (url.endsWith('/start')) return json(playthrough({ id: 7, startedOn: '2026-11-15', finishedOn: null }), 201);
        return new Response(null, { status: 204 });
    }));
});

afterEach(() => vi.unstubAllGlobals());

describe('a popup whose code cannot be fetched', () => {
    it('says so in the confirmation, and leaves the page standing', async () => {
        render(
            <ListsProvider>
                <PlaythroughPromptProvider>
                    <main><Mover /></main>
                </PlaythroughPromptProvider>
            </ListsProvider>,
        );
        await userEvent.click(await screen.findByRole('button', { name: 'Celeste to playing' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));

        expect(await screen.findByText(/Your playthrough is saved, but its form could not be opened/)).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        // The page is still the page: no error boundary took it over.
        expect(screen.getByRole('button', { name: 'Celeste to playing' })).toBeInTheDocument();
    });
});
