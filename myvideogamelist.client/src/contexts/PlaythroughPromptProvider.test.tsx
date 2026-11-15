import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListsProvider } from '@/contexts/ListsProvider';
import { PlaythroughPromptProvider } from '@/contexts/PlaythroughPromptProvider';
import { useLists } from '@/hooks/useLists';
import type { ListId, ListMoveDto } from '@/types/list';
import { entry, game, playthrough, platform } from '@/test/factories';

const ALICE = { id: 'u1', email: 'alice@test.local' };
const BOB = { id: 'u2', email: 'bob@test.local' };

// One object, handed back every time, as the lists provider's own tests do: a new one per render would
// re-run its fetch on every render.
const auth = {
    user: ALICE as typeof ALICE | null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const CELESTE = game({ id: 1, title: 'Celeste', platforms: [platform(6, 'PC (Microsoft Windows)')] });
const HADES = game({ id: 2, title: 'Hades' });

/** What the API answers each request with; a test changes the parts it is about. */
interface Api {
    moves: Record<number, ListMoveDto | 'fail'>;
    /** Held until released, so a test can look between the optimistic step and the answer. */
    holdMove: Promise<void> | null;
    start: { status: number; body?: unknown } | 'reject';
    finish: { status: number; body?: unknown } | 'reject';
    holdYes: Promise<void> | null;
    save: { status: number; body?: unknown };
}

interface Call {
    method: string;
    url: string;
    body: unknown;
}

let api: Api;
let calls: Call[];

const STARTED = playthrough({ id: 7, startedOn: '2026-11-15', finishedOn: null, type: null, platformId: null, minutesPlayed: null });

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
}

function stubApi() {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

        if (method === 'GET' && url === '/api/lists') {
            return json({ lists: { backlog: [entry({ game: CELESTE }), entry({ game: HADES })] } });
        }
        if (method === 'GET') return json({ view: 'tiles', sorts: {}, names: {} });

        const moved = url.match(/^\/api\/lists\/(\d+)$/);
        if (method === 'PUT' && moved) {
            await api.holdMove;
            const answer = api.moves[Number(moved[1])] ?? { moved: true, unfinishedPlaythrough: null };
            return answer === 'fail' ? new Response('nope', { status: 500 }) : json(answer);
        }

        const yes = url.endsWith('/start') ? api.start : url.endsWith('/finish') ? api.finish : null;
        if (method === 'POST' && yes !== null) {
            await api.holdYes;
            if (yes === 'reject') throw new TypeError('Failed to fetch');
            return yes.body === undefined ? new Response(null, { status: yes.status }) : json(yes.body, yes.status);
        }

        if (method === 'PUT' && /\/playthroughs\/\d+$/.test(url)) {
            return api.save.body === undefined ? new Response(null, { status: api.save.status }) : json(api.save.body, api.save.status);
        }

        return new Response(null, { status: 204 });
    }));
}

/** Buttons that move a game, as any card or the game page's row would, through the one `addToList`. */
function Mover() {
    const { addToList, loading } = useLists();
    if (loading) return <p>Loading</p>;
    const move = (listId: ListId, which = CELESTE) => () => void addToList(listId, which);
    return (
        <div>
            <button type="button" onClick={move('playing')}>Celeste to playing</button>
            <button type="button" onClick={move('finished')}>Celeste to finished</button>
            <button type="button" onClick={move('dropped')}>Celeste to dropped</button>
            <button type="button" onClick={move('on_hold')}>Celeste to on hold</button>
            <button type="button" onClick={move('backlog')}>Celeste to backlog</button>
            <button type="button" onClick={move('playing', HADES)}>Hades to playing</button>
            <button type="button" onClick={move('dropped', HADES)}>Hades to dropped</button>
        </div>
    );
}

function tree() {
    return (
        <ListsProvider>
            <PlaythroughPromptProvider>
                <main>
                    <Mover />
                </main>
            </PlaythroughPromptProvider>
        </ListsProvider>
    );
}

async function renderPrompt() {
    const view = render(tree());
    await screen.findByRole('button', { name: 'Celeste to playing' });
    return view;
}

/** The toast's question or report, wherever it is: in the polite region, or the alert's. */
const toast = () => screen.queryByRole('group', { name: /Playthrough question/ });

const posts = () => calls.filter(call => call.method === 'POST');

beforeEach(() => {
    // The reader's day is read from the clock when a move is saved, so the clock is fixed, and only the
    // date: the timers stay real for the requests and the waits.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15, 10, 30));
    auth.user = ALICE;
    calls = [];
    api = {
        moves: {},
        holdMove: null,
        start: { status: 201, body: STARTED },
        finish: { status: 200, body: { ...STARTED, startedOn: '2026-08-02', finishedOn: '2026-11-15' } },
        holdYes: null,
        save: { status: 200, body: { ...STARTED, minutesPlayed: 600 } },
    };
    stubApi();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('which moves ask', () => {
    it('asks to start one once a move to Playing is saved, naming the reader\'s day', async () => {
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));

        const asked = await screen.findByRole('group', { name: /Playthrough question/ });
        expect(within(asked).getByText('Playthrough · Celeste')).toBeInTheDocument();
        expect(within(asked).getByText('Start a playthrough today?')).toBeInTheDocument();
        expect(within(asked).getByText('Sunday 15 November 2026')).toBeInTheDocument();
        // Announced politely, and nothing written until the reader says yes.
        expect(screen.getByRole('status')).toContainElement(asked);
        expect(posts()).toEqual([]);
    });

    it('asks to finish the unfinished run once a move to Finished is saved, saying when it started', async () => {
        api.moves[1] = { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-08-02' } };
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to finished' }));

        const asked = await screen.findByRole('group', { name: /Playthrough question/ });
        expect(within(asked).getByText('Finish your playthrough today?')).toBeInTheDocument();
        expect(within(asked).getByText('Started 2 Aug 2026 · 105 days ago')).toBeInTheDocument();
    });

    it('has no started line for a run that does not say when it started', async () => {
        api.moves[1] = { moved: true, unfinishedPlaythrough: { id: 9, startedOn: null } };
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to finished' }));

        const asked = await screen.findByRole('group', { name: /Playthrough question/ });
        expect(within(asked).queryByText(/^Started/)).not.toBeInTheDocument();
    });

    it.each<[string, string, ListMoveDto]>([
        ['back to Playing with a run going', 'Celeste to playing', { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-08-02' } }],
        ['to Finished with nothing unfinished', 'Celeste to finished', { moved: true, unfinishedPlaythrough: null }],
        ['to Dropped with a run going', 'Celeste to dropped', { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-08-02' } }],
        ['to On Hold with a run going', 'Celeste to on hold', { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-08-02' } }],
        ['to the Backlog', 'Celeste to backlog', { moved: true, unfinishedPlaythrough: null }],
        ['to the list it was already in, as the server saw it', 'Celeste to playing', { moved: false, unfinishedPlaythrough: null }],
        ['to Finished with a run that starts after today', 'Celeste to finished', { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-11-20' } }],
    ])('asks nothing on a move %s', async (_, button, answer) => {
        api.moves[1] = answer;
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: button }));

        await waitFor(() => expect(calls.some(call => call.method === 'PUT')).toBe(true));
        // The move's own answer has been committed once the game is unlocked; give the prompt a tick more.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(toast()).not.toBeInTheDocument();
    });

    it('asks only once the server has saved the move, never on the optimistic step', async () => {
        let release!: () => void;
        api.holdMove = new Promise<void>(resolve => { release = resolve; });
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        expect(toast()).not.toBeInTheDocument();

        await act(async () => release());
        expect(await screen.findByRole('group', { name: /Playthrough question/ })).toBeInTheDocument();
    });

    it('asks nothing after a move that failed and was put back', async () => {
        api.moves[1] = 'fail';
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));

        await waitFor(() => expect(calls.some(call => call.method === 'PUT')).toBe(true));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(toast()).not.toBeInTheDocument();
    });
});

describe('one toast at a time', () => {
    it('lets a newer move\'s question replace the one up', async () => {
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await screen.findByText('Playthrough · Celeste');
        await userEvent.click(screen.getByRole('button', { name: 'Hades to playing' }));

        expect(await screen.findByText('Playthrough · Hades')).toBeInTheDocument();
        expect(screen.queryByText('Playthrough · Celeste')).not.toBeInTheDocument();
        expect(screen.getAllByRole('group', { name: /Playthrough question/ })).toHaveLength(1);
    });

    it('takes the question away when the same game moves again and asks nothing', async () => {
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await screen.findByText('Playthrough · Celeste');
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to backlog' }));

        await waitFor(() => expect(toast()).not.toBeInTheDocument());
    });

    it('leaves the question up when another game moves and asks nothing', async () => {
        await renderPrompt();

        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await screen.findByText('Playthrough · Celeste');
        await userEvent.click(screen.getByRole('button', { name: 'Hades to dropped' }));

        await waitFor(() => expect(calls.filter(call => call.method === 'PUT')).toHaveLength(2));
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(screen.getByText('Playthrough · Celeste')).toBeInTheDocument();
    });
});

describe('the answer', () => {
    it('writes nothing for "Not now", and goes', async () => {
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));

        await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));

        expect(toast()).not.toBeInTheDocument();
        expect(posts()).toEqual([]);
    });

    it('starts a run on the day the toast named for a yes, and confirms it', async () => {
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));

        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));

        expect(await screen.findByText('Playthrough started today.')).toBeInTheDocument();
        expect(posts()).toEqual([
            { method: 'POST', url: '/api/entries/1/playthroughs/start', body: { startedOn: '2026-11-15' } },
        ]);
        expect(screen.getByRole('button', { name: 'Add details' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
    });

    it('finishes the run the move named for a yes, and says how long it took', async () => {
        api.moves[1] = { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-08-02' } };
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to finished' }));

        await userEvent.click(await screen.findByRole('button', { name: 'Finish it' }));

        expect(await screen.findByText('Playthrough finished today.')).toBeInTheDocument();
        expect(screen.getByText('2 Aug to 15 Nov 2026 · 105 days')).toBeInTheDocument();
        expect(posts()).toEqual([
            { method: 'POST', url: '/api/entries/1/playthroughs/9/finish', body: { finishedOn: '2026-11-15' } },
        ]);
        expect(screen.getByRole('button', { name: 'Add your hours' })).toBeInTheDocument();
    });

    it('shows the yes saving, its buttons held, until the server answers', async () => {
        let release!: () => void;
        api.holdYes = new Promise<void>(resolve => { release = resolve; });
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));

        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));

        const saving = screen.getByRole('button', { name: 'Starting…' });
        expect(saving).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Not now' })).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(toast()).toBeInTheDocument();

        await act(async () => release());
        expect(await screen.findByText('Playthrough started today.')).toBeInTheDocument();
    });

    it('says a failure as an alert, and "Try again" sends the day that was shown, not a new one', async () => {
        api.start = { status: 500, body: { title: 'nope' } };
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));

        const alert = await screen.findByRole('alert');
        await waitFor(() => expect(alert).toHaveTextContent('Your playthrough was not started.'));
        expect(alert).toHaveTextContent('It could not be saved, so nothing has changed.');

        // Past midnight, and the server back.
        vi.setSystemTime(new Date(2026, 10, 16, 0, 5));
        api.start = { status: 201, body: STARTED };
        await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('Playthrough started today.')).toBeInTheDocument();
        expect(posts().map(call => call.body)).toEqual([{ startedOn: '2026-11-15' }, { startedOn: '2026-11-15' }]);
    });

    it('says a failure when the request never arrives, too', async () => {
        api.start = 'reject';
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Your playthrough was not started.');
    });

    it('says plainly that nothing changed when a run was started meanwhile', async () => {
        api.start = { status: 409, body: { detail: 'This game already has an unfinished playthrough.' } };
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));

        expect(await screen.findByText('A playthrough of this game is already under way, so nothing has changed.'))
            .toBeInTheDocument();
        expect(screen.getByText('Your playthrough was not started.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(toast()).not.toBeInTheDocument();
    });

    it.each([
        [404, 'That playthrough is no longer there, so nothing has changed.'],
        [409, 'That playthrough has changed since you were asked, so nothing has changed.'],
    ])('says a finish refused with a %i changed nothing', async (status, sentence) => {
        api.moves[1] = { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-08-02' } };
        api.finish = { status };
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to finished' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Finish it' }));

        expect(await screen.findByText(sentence)).toBeInTheDocument();
        expect(screen.getByText('Your playthrough was not finished.')).toBeInTheDocument();
    });

    it('closes with Escape from inside it, writing nothing', async () => {
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await screen.findByRole('button', { name: 'Start it' });

        await userEvent.keyboard('{F8}');
        expect(screen.getByRole('button', { name: 'Start it' })).toHaveFocus();
        await userEvent.keyboard('{Escape}');

        expect(toast()).not.toBeInTheDocument();
        expect(posts()).toEqual([]);
    });
});

describe('reaching it from the keyboard', () => {
    it('takes no focus as it appears, and F8 takes focus to it and Not now gives it back', async () => {
        await renderPrompt();
        const mover = screen.getByRole('button', { name: 'Celeste to playing' });
        await userEvent.click(mover);
        expect(mover).toHaveFocus();

        await screen.findByRole('button', { name: 'Start it' });
        expect(mover).toHaveFocus();

        await userEvent.keyboard('{F8}');
        expect(screen.getByRole('button', { name: 'Start it' })).toHaveFocus();

        await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(mover).toHaveFocus();
    });

    it('keeps focus in it when a yes turns it into the confirmation', async () => {
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await screen.findByRole('button', { name: 'Start it' });

        await userEvent.keyboard('{F8}');
        await userEvent.keyboard('{Enter}');

        await waitFor(() => expect(screen.getByRole('button', { name: 'Add details' })).toHaveFocus());
    });
});

describe('the popup', () => {
    async function confirmStart() {
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));
        return screen.findByRole('dialog', { name: 'Your playthrough' });
    }

    it('opens the form in place on the run the yes wrote, and the toast goes', async () => {
        const dialog = await confirmStart();

        expect(within(dialog).getByText('Playthrough · Celeste')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Started')).toHaveValue('2026-11-15');
        expect(within(dialog).getByLabelText('Platform')).toHaveFocus();
        expect(toast()).not.toBeInTheDocument();
    });

    it('saves the run it was opened on, and closes', async () => {
        const dialog = await confirmStart();

        await userEvent.type(within(dialog).getByLabelText('Hours'), '10');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Save playthrough' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const saved = calls.find(call => call.method === 'PUT' && call.url === '/api/entries/1/playthroughs/7');
        expect(saved?.body).toMatchObject({ minutesPlayed: 600, startedOn: '2026-11-15', finishedOn: null });
    });

    it('keeps the form open with the server\'s sentence when the save is refused', async () => {
        api.save = { status: 400, body: { errors: { FinishedOn: ['The finish date cannot be before the start date.'] } } };
        const dialog = await confirmStart();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Save playthrough' }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent('The finish date cannot be before the start date.');
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes on Cancel, writing nothing more, and gives focus back to the page', async () => {
        const dialog = await confirmStart();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(calls.filter(call => call.method === 'PUT' && call.url.includes('/playthroughs/'))).toEqual([]);
        // The way back was the button that made the move, still on the page.
        expect(screen.getByRole('button', { name: 'Celeste to playing' })).toHaveFocus();
    });

    it('focuses the hours after a finish, which is what it was opened for', async () => {
        api.moves[1] = { moved: true, unfinishedPlaythrough: { id: 9, startedOn: '2026-08-02' } };
        await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to finished' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Finish it' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Add your hours' }));

        const dialog = await screen.findByRole('dialog', { name: 'Your playthrough' });
        expect(within(dialog).getByLabelText('Hours')).toHaveFocus();
    });
});

describe('across an account change', () => {
    it('takes the question away when another account signs in', async () => {
        const view = await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await screen.findByText('Start a playthrough today?');

        auth.user = BOB;
        view.rerender(tree());

        await waitFor(() => expect(toast()).not.toBeInTheDocument());
    });

    it('drops a yes that lands for the previous account', async () => {
        let release!: () => void;
        api.holdYes = new Promise<void>(resolve => { release = resolve; });
        const view = await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Start it' }));

        auth.user = BOB;
        view.rerender(tree());
        await waitFor(() => expect(toast()).not.toBeInTheDocument());

        await act(async () => release());
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(screen.queryByText('Playthrough started today.')).not.toBeInTheDocument();
    });

    it('drops a move saved for the previous account', async () => {
        let release!: () => void;
        api.holdMove = new Promise<void>(resolve => { release = resolve; });
        const view = await renderPrompt();
        await userEvent.click(screen.getByRole('button', { name: 'Celeste to playing' }));

        auth.user = BOB;
        view.rerender(tree());

        await act(async () => release());
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(toast()).not.toBeInTheDocument();
    });
});
