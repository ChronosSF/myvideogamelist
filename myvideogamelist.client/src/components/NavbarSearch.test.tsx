import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { NavbarSearch } from '@/components/NavbarSearch';
import {
    MAX_SEARCH_LENGTH,
    MIN_SEARCH_LENGTH,
    SEARCH_DEBOUNCE_MS,
    SEARCH_REFUSED,
    SEARCH_SPACING_MS,
    SEARCH_UNREACHABLE,
    TYPEAHEAD_SIZE,
} from '@/hooks/useGameSearch';
import { game } from '@/test/factories';
import type { GameDto } from '@/types/game';

/** One request the box has made, held open until the test answers it. */
interface Pending {
    term: string | null;
    url: string;
    init: RequestInit | undefined;
    /** When it was made, by the faked clock. */
    at: number;
    signal: AbortSignal;
    answer: (games: GameDto[], hasMore?: boolean) => Promise<void>;
    /** Any status and body, for the failures and for a 200 that is not what it should be. */
    respond: (status: number, body: unknown, headers?: Record<string, string>) => Promise<void>;
    unreachable: () => Promise<void>;
}

/**
 * Stands in for the API. Every request stays open until the test settles it, and a request that is
 * aborted rejects as a browser's would — unless `honourAbort` is off, which plays a server answering
 * a request the browser has already stopped listening to.
 *
 * A response with nothing behind its `json` but a promise, rather than a real `Response`, so its body
 * is ready the moment the test answers.
 */
function stubApi({ honourAbort = true } = {}) {
    const requests: Pending[] = [];

    // Settled inside `act`, and then a macrotask, by which time every promise the answer travels
    // through has run, however many there are.
    const settle = async (run: () => void) => {
        await act(async () => {
            run();
            await new Promise(resolve => setImmediate(resolve));
        });
    };

    const response = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        json: () => Promise.resolve(body),
    }) as unknown as Response;

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
            const url = String(input);
            const signal = init?.signal ?? new AbortController().signal;
            if (honourAbort) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));

            requests.push({
                term: new URL(url, 'https://mvgl.test').searchParams.get('search'),
                url,
                init,
                at: Date.now(),
                signal,
                answer: (games, hasMore = false) => settle(() => resolve(response(200, { items: games, hasMore }))),
                respond: (status, body, headers) => settle(() => resolve(response(status, body, headers))),
                unreachable: () => settle(() => reject(new TypeError('Failed to fetch'))),
            });
        })));

    return requests;
}

/** The box as the navbar holds it, with somewhere else on the page for focus to go. */
function Harness() {
    const [panelOpen, setPanelOpen] = useState(false);
    return (
        <>
            <NavbarSearch panelOpen={panelOpen} onPanelOpenChange={setPanelOpen} />
            <button type="button">Elsewhere</button>
        </>
    );
}

function renderSearch() {
    const router = createMemoryRouter([{ path: '*', element: <Harness /> }], { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const box = screen.getByRole('combobox', { name: 'Search games' });
    return { router, user, box };
}

/** The box with `term` typed, asked about and answered. */
async function answered(games: GameDto[], { term = 'zelda', hasMore = false } = {}) {
    const requests = stubApi();
    const rendered = renderSearch();
    await rendered.user.type(rendered.box, term);
    await pause(SEARCH_DEBOUNCE_MS);
    await requests[0].answer(games, hasMore);
    return { ...rendered, requests };
}

/** Lets the faked clock run, as a pause in the typing. */
async function pause(ms: number) {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
}

const where = (router: ReturnType<typeof createMemoryRouter>) =>
    router.state.location.pathname + router.state.location.search;

/** The visible line of a message, as against the same words in the screen-reader announcement. */
const line = (text: string | RegExp) => screen.getByText(text, { selector: 'p' });

const ZELDA = game({ id: 1022, title: 'The Legend of Zelda', releaseDate: '1986-02-21' });
const BOTW = game({
    id: 7346,
    title: 'The Legend of Zelda: Breath of the Wild',
    releaseDate: '2017-03-03',
    coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.jpg',
    criticScore: 97,
    criticScoreCount: 25,
});
const ORACLE = game({ id: 1041, title: 'The Legend of Zelda: Oracle of Ages', releaseDate: '2001-02-27', criticScore: 95, criticScoreCount: 3 });

/** The API's own answer when its queue for IGDB is full (`UpstreamBusyHandler`). */
const BUSY = {
    title: 'Busy fetching game data',
    status: 503,
    detail: 'Too many people are browsing games at once. Try again in a moment — your own lists, scores and playthroughs are unaffected.',
};

beforeEach(() => {
    // Only the clock and timeouts: the debounce and the spacing run on them. React's scheduler and the
    // promises an answer travels through stay real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Testing Library ends every userEvent call by waiting out a zero-length timeout, and moves the
    // clock past it only when it finds Jest's fake timers. Under Vitest's it finds no `jest`, the
    // timeout never fires and the call never returns; this is the one method it reaches for.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('NavbarSearch before hydration', () => {
    function serverRendered() {
        const ui = (
            <MemoryRouter>
                <NavbarSearch panelOpen={false} onPanelOpenChange={() => {}} />
            </MemoryRouter>
        );
        const container = document.createElement('div');
        container.innerHTML = renderToString(ui);
        document.body.append(container);
        return { ui, container };
    }

    it('server-renders a plain search form, and hydrates it into the typeahead without a mismatch', async () => {
        vi.useRealTimers();
        const errors = vi.spyOn(console, 'error');
        const { ui, container } = serverRendered();

        // What a reader has before any script runs: a form that searches the browse page, and below
        // lg, where the form waits behind a button the script opens, a link to that page instead.
        const field = within(container).getByRole('searchbox', { name: 'Search games' });
        expect(field).toHaveAttribute('name', 'search');
        expect(field.closest('form')).toHaveAttribute('action', '/games');
        expect(field.closest('form')).toHaveAttribute('method', 'get');
        expect(within(container).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/games');
        // And nothing it cannot do yet: no combobox that cannot open, no list, nothing to announce.
        expect(within(container).queryByRole('combobox')).not.toBeInTheDocument();
        expect(within(container).queryByRole('listbox', { hidden: true })).not.toBeInTheDocument();
        expect(within(container).queryByRole('status')).not.toBeInTheDocument();

        render(ui, { container, hydrate: true });

        expect(await within(container).findByRole('combobox', { name: 'Search games' })).toBe(field);
        expect(within(container).getByRole('button', { name: 'Search' })).toHaveAttribute('aria-expanded', 'false');
        expect(errors).not.toHaveBeenCalled();
    });

    it('keeps what was typed into the box before the script arrived', async () => {
        // Hydration leaves it in the field; the commit that makes the box a combobox would otherwise
        // write the empty state over it.
        vi.useRealTimers();
        const { ui, container } = serverRendered();
        const field = within(container).getByRole('searchbox', { name: 'Search games' });
        (field as HTMLInputElement).value = 'hollow kn';

        render(ui, { container, hydrate: true });

        expect(await within(container).findByRole('combobox', { name: 'Search games' })).toHaveValue('hollow kn');
    });
});

describe('NavbarSearch asking', () => {
    it('asks once the typing pauses, not on every keystroke', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS - 1);
        expect(requests).toHaveLength(0);

        await pause(1);
        expect(requests.map(r => r.url)).toEqual([`/api/games?search=zelda&offset=0&limit=${TYPEAHEAD_SIZE}`]);
        // With the browser's own credentials: the dev site's basic auth lets nothing through without them.
        expect(requests[0].init?.credentials).not.toBe('omit');
    });

    it(`asks nothing under ${MIN_SEARCH_LENGTH} characters, counted without the spaces around them`, async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, ' z ');
        await pause(5000);
        expect(requests).toHaveLength(0);

        await user.type(box, '{Backspace}s');
        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.term)).toEqual(['zs']);
    });

    it('asks nothing new for a space at the end', async () => {
        const { user, box, requests } = await answered([ZELDA]);

        await user.type(box, ' ');
        await pause(5000);

        expect(requests).toHaveLength(1);
        expect(screen.getByRole('option', { name: /The Legend of Zelda/ })).toBeVisible();
    });

    it('asks about finished words when the typing is steady', async () => {
        // A keystroke every 400ms: inside the debounce within a word. The pause around a space is two
        // keystrokes long, because the space itself leaves the trimmed term as it was.
        const requests = stubApi();
        const { box } = renderSearch();
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: 400 });

        await user.type(box, 'final fantasy');
        await pause(SEARCH_SPACING_MS);

        expect(requests.map(r => r.term)).toEqual(['final', 'final fantasy']);
    });

    it('asks at most once a second, however slow and steady the typing', async () => {
        // A keystroke every 500ms passes the debounce every time. On its own the debounce would ask
        // after every one of them from the second on.
        const requests = stubApi();
        const { box } = renderSearch();
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: 500 });

        await user.type(box, 'final fantasy');
        await pause(SEARCH_SPACING_MS);

        expect(requests.length).toBeGreaterThan(1);
        expect(requests.length).toBeLessThanOrEqual(Math.ceil((13 * 500) / SEARCH_SPACING_MS) + 1);
        for (let i = 1; i < requests.length; i++) {
            expect(requests[i].at - requests[i - 1].at).toBeGreaterThanOrEqual(SEARCH_SPACING_MS);
        }
        // And the last thing typed is always asked about in the end.
        expect(requests.at(-1)?.term).toBe('final fantasy');
    });

    it('waits out exactly the rest of the second after the last request', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);

        // At once: the debounce alone would ask in 450ms.
        await user.type(box, 's');
        await pause(SEARCH_SPACING_MS - 1);
        expect(requests).toHaveLength(1);

        await pause(1);
        expect(requests).toHaveLength(2);
        expect(requests[1].at - requests[0].at).toBe(SEARCH_SPACING_MS);
    });

    it('waits no longer than the spacing when the clock is set back', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);

        vi.setSystemTime(Date.now() - 60_000);
        await user.type(box, 's');
        await pause(SEARCH_SPACING_MS);

        expect(requests.map(r => r.term)).toEqual(['zelda', 'zeldas']);
    });

    it('abandons the request in flight when the term changes', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests[0].signal.aborted).toBe(false);

        await user.type(box, 's');

        expect(requests[0].signal.aborted).toBe(true);
    });

    it('abandons the request in flight when the list is closed, and asks nothing while it is', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await user.keyboard('{Escape}');

        expect(requests[0].signal.aborted).toBe(true);
        await pause(5000);
        expect(requests).toHaveLength(1);
    });

    it('drops an answer that arrives after its request was abandoned', async () => {
        // As a server answers a request the browser has stopped listening to. Neither shown under the
        // term that replaced it, nor kept for later.
        const requests = stubApi({ honourAbort: false });
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await user.type(box, 's');

        await requests[0].answer([ZELDA]);
        expect(screen.queryByRole('option')).not.toBeInTheDocument();

        await user.type(box, '{Backspace}');
        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.term)).toEqual(['zelda', 'zelda']);
    });

    it('remembers an answer, so backspacing to it asks nothing', async () => {
        const { user, box, requests } = await answered([ZELDA, BOTW]);

        await user.type(box, 's');
        await pause(SEARCH_SPACING_MS);
        await requests[1].answer([]);
        expect(line('No games found for “zeldas”.')).toBeVisible();

        await user.type(box, '{Backspace}');
        await pause(SEARCH_SPACING_MS);

        expect(requests).toHaveLength(2);
        expect(screen.getAllByRole('option').map(o => o.getAttribute('href'))).toEqual(['/games/1022', '/games/7346']);
    });

    it('remembers the last twenty answers, and asks again about anything older', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        for (let i = 0; i < 21; i++) {
            await user.clear(box);
            await user.type(box, `term ${i}`);
            await pause(SEARCH_SPACING_MS);
            await requests.at(-1)!.answer([]);
        }
        expect(requests).toHaveLength(21);

        await user.clear(box);
        await user.type(box, 'term 1');
        await pause(SEARCH_SPACING_MS);
        expect(requests).toHaveLength(21);

        await user.clear(box);
        await user.type(box, 'term 0');
        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.term).at(-1)).toBe('term 0');
    });

    it('keeps the last list up, marked as waiting, until the new term has its own answer', async () => {
        // Rather than blanking out at every pause in the typing.
        const { user, box, requests } = await answered([ZELDA]);

        await user.type(box, ' breath');
        await pause(SEARCH_SPACING_MS);
        expect(requests[1].term).toBe('zelda breath');
        expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getAllByRole('option').map(o => o.getAttribute('href'))).toEqual(['/games/1022']);

        await requests[1].answer([BOTW]);

        expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false');
        expect(screen.getAllByRole('option').map(o => o.getAttribute('href'))).toEqual(['/games/7346']);
    });
});

describe('NavbarSearch listing', () => {
    it('lists each game with its cover, title, year and critic score — or a dash with the count under the floor', async () => {
        await answered([BOTW, ORACLE, ZELDA], { hasMore: true });

        const [botw, oracle, zelda] = screen.getAllByRole('option');

        expect(botw).toHaveAccessibleName(
            'The Legend of Zelda: Breath of the Wild, 2017. Critic score: 97 out of 100, from 25 reviews');
        expect(within(botw).getByText('2017')).toBeInTheDocument();
        expect(within(botw).getByText('97')).toBeInTheDocument();
        // The small cover: the thumbnail is drawn at a fraction of a card's.
        expect(botw.querySelector('img')).toHaveAttribute(
            'src', 'https://images.igdb.com/igdb/image/upload/t_cover_small/co3p2d.jpg');

        // Three critics are too few for the score to mean anything, so it is not shown — the dash
        // says there is none to show and the count says why.
        expect(oracle).toHaveAccessibleName('The Legend of Zelda: Oracle of Ages, 2001. Too few critic reviews to score: 3');
        expect(within(oracle).queryByText('95')).not.toBeInTheDocument();
        expect(within(oracle).getByText('—')).toBeInTheDocument();
        expect(within(oracle).getByText('3 reviews')).toBeInTheDocument();

        expect(zelda).toHaveAccessibleName('The Legend of Zelda, 1986. No critic reviews');
        expect(within(zelda).getByText('no reviews')).toBeInTheDocument();

        expect(screen.getByRole('link', { name: 'See all results for “zelda”' })).toHaveAttribute('href', '/games?search=zelda');
    });

    it('announces the first few of more as the first few, not as the whole', async () => {
        const { box } = await answered([ZELDA, BOTW, ORACLE], { hasMore: true });

        expect(screen.getByRole('status')).toHaveTextContent('First 3 games for zelda. Press Enter for all results.');
        expect(box).toHaveAttribute('aria-expanded', 'true');
    });

    it('announces what came back when it is everything, one game or none', async () => {
        const { user, box, requests } = await answered([ZELDA]);
        expect(screen.getByRole('status')).toHaveTextContent('1 game found for zelda.');

        await user.type(box, ' breath');
        await pause(SEARCH_SPACING_MS);
        await requests[1].answer([]);

        expect(screen.getByRole('status')).toHaveTextContent('No games found for zelda breath.');
        expect(line('No games found for “zelda breath”.')).toBeVisible();
        expect(box).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('link', { name: /See all results/ })).not.toBeInTheDocument();
    });

    it('says it is searching while the first answer is on its way', async () => {
        stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);

        expect(line('Searching…')).toBeVisible();
        expect(screen.getByRole('status')).toHaveTextContent('');
    });

    it('cuts a whole page down to the dropdown’s size, as an older API that ignores the limit sends', async () => {
        await answered(Array.from({ length: 20 }, (_, i) => game({ id: i + 1, title: `Game ${i + 1}` })));

        expect(screen.getAllByRole('option')).toHaveLength(TYPEAHEAD_SIZE);
        expect(screen.getByRole('status')).toHaveTextContent(`First ${TYPEAHEAD_SIZE} games for zelda.`);
    });

    it('takes a term no longer than the import takes a title', () => {
        stubApi();
        const { box } = renderSearch();

        expect(box).toHaveAttribute('maxlength', String(MAX_SEARCH_LENGTH));
    });
});

describe('NavbarSearch failing', () => {
    it('says what a failure says, and asks again when told to', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        // The API's own answer when IGDB does not (`UpstreamFailureHandler`).
        await requests[0].respond(502, {
            title: 'A service this page depends on is unavailable',
            status: 502,
            detail: 'Game data comes from IGDB, which did not answer. Your own lists, scores and playthroughs are unaffected.',
        });

        expect(line(/Game data comes from IGDB, which did not answer/)).toBeVisible();
        expect(screen.getByRole('status')).toHaveTextContent(/Game data comes from IGDB, which did not answer/);
        expect(box).toHaveAttribute('aria-expanded', 'false');

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        await pause(SEARCH_SPACING_MS);
        await requests[1].answer([ZELDA]);

        expect(requests).toHaveLength(2);
        expect(screen.getByRole('option', { name: /The Legend of Zelda/ })).toBeVisible();
    });

    it('asks nothing for as long as a 503 says, about any term, and nothing by itself after', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(503, BUSY, { 'Retry-After': '10' });

        expect(line(/Too many people are browsing games at once/)).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

        // Another term while the wait runs is not asked about, and the box says why.
        await user.type(box, ' breath');
        await pause(9_999);
        expect(requests).toHaveLength(1);
        expect(line(/Too many people are browsing games at once/)).toBeVisible();

        // The wait over, the reader may ask again — and nothing asks for them.
        await pause(1);
        await pause(10_000);
        expect(requests).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.term)).toEqual(['zelda', 'zelda breath']);
    });

    it('waits five seconds after a 503 that names no wait, as a balancer’s does not', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(503, null);

        expect(line(SEARCH_UNREACHABLE)).toBeVisible();
        await pause(4_999);
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

        await pause(1);
        expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    });

    it('offers no retry when the API refused the question itself', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(400, { title: 'One or more validation errors occurred.', status: 400 });

        expect(line(SEARCH_REFUSED)).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('says so when the API cannot be reached at all', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].unreachable();

        expect(line(SEARCH_UNREACHABLE)).toBeVisible();
        expect(screen.getByRole('status')).toHaveTextContent(SEARCH_UNREACHABLE);
    });

    it('treats a 200 that is not a page of games as a failure, and keeps the page up', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);

        await requests[0].respond(200, {});

        expect(line(SEARCH_UNREACHABLE)).toBeVisible();
        expect(box).toBeInTheDocument();
    });

    it.each([
        ['a null in place of a game', [null]],
        ['a title that is not text', [{ ...ZELDA, title: 42 }]],
        ['one wrong game among right ones', [ZELDA, { ...BOTW, criticScore: '97' }]],
    ])('fails an answer with %s whole, rather than crashing the navbar', async (_case, items) => {
        // The first is the review's case. Rendered, any of them would throw in the navbar of every
        // page, and the root boundary renders without one.
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);

        await requests[0].respond(200, { items, hasMore: false });

        expect(line(SEARCH_UNREACHABLE)).toBeVisible();
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        expect(box).toBeInTheDocument();
    });

    it('asks again when the term moves on from a failure and comes back', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].unreachable();

        await user.type(box, 's{Backspace}');
        await pause(SEARCH_SPACING_MS);

        expect(requests.map(r => r.term)).toEqual(['zelda', 'zelda']);
    });

    it('asks again when the list is closed on a failure and opened again', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].unreachable();

        await user.keyboard('{Escape}{ArrowDown}');
        await pause(SEARCH_SPACING_MS);

        expect(requests.map(r => r.term)).toEqual(['zelda', 'zelda']);
    });

    it('hands focus back to the box when Try again is pressed from the keyboard', async () => {
        // The button goes as the retry starts; focus left on it would drop to the page, leaving the
        // list open with nothing focused to close it.
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].unreachable();

        await user.tab();
        expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
        await user.keyboard('{Enter}');

        expect(box).toHaveFocus();
        await pause(SEARCH_SPACING_MS);
        await requests[1].answer([ZELDA]);
        expect(box).toHaveAttribute('aria-expanded', 'true');

        await user.tab();
        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on Escape from Try again, and hands focus back to the box', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].unreachable();

        await user.tab();
        await user.keyboard('{Escape}');

        expect(box).toHaveFocus();
        expect(screen.queryByText(SEARCH_UNREACHABLE, { selector: 'p' })).not.toBeInTheDocument();
    });
});

describe('NavbarSearch keyboard', () => {
    it('moves through the options with the arrow keys, wrapping at either end, while focus stays in the box', async () => {
        const { user, box } = await answered([ZELDA, BOTW, ORACLE]);
        const active = () => document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.getAttribute('href');

        await user.keyboard('{ArrowDown}');
        expect(active()).toBe('/games/1022');
        expect(screen.getByRole('option', { selected: true })).toHaveAttribute('href', '/games/1022');

        await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
        expect(active()).toBe('/games/1022');

        await user.keyboard('{ArrowUp}');
        expect(active()).toBe('/games/1041');
        expect(box).toHaveFocus();
    });

    it('opens the highlighted game on Enter', async () => {
        const { router, user, box } = await answered([ZELDA, BOTW]);

        await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

        expect(where(router)).toBe('/games/7346');
        expect(box).toHaveValue('');
        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens the search in full on Enter with nothing highlighted', async () => {
        const { router, user, box } = await answered([ZELDA, BOTW]);

        await user.type(box, '{Enter}');

        expect(where(router)).toBe('/games?search=zelda');
        expect(box).toHaveValue('');
    });

    it('opens the search in full on Enter before anything has come back', async () => {
        // The submit is not the typeahead's: it works whatever the API is doing.
        stubApi();
        const { router, user, box } = renderSearch();

        await user.type(box, '  hollow knight {Enter}');

        expect(where(router)).toBe('/games?search=hollow+knight');
    });

    it('closes the list on Escape, then empties the box on a second', async () => {
        const { user, box } = await answered([ZELDA]);

        await user.keyboard('{Escape}');
        expect(box).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        expect(box).toHaveValue('zelda');

        await user.keyboard('{Escape}');
        expect(box).toHaveValue('');
    });

    it('opens the list again with the down arrow, from the answer it already has', async () => {
        const { user, box } = await answered([ZELDA]);

        await user.keyboard('{Escape}{ArrowDown}');

        expect(box).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('option', { name: /The Legend of Zelda/ })).toBeInTheDocument();
    });
});

describe('NavbarSearch closing', () => {
    it('closes when focus leaves it', async () => {
        const { user, box } = await answered([ZELDA]);

        await user.tab();

        expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes when focus goes nowhere, as a click on the page does', async () => {
        const { box } = await answered([ZELDA]);

        fireEvent.blur(box, { relatedTarget: null });

        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps focus in the box while a press on an option turns into a click', async () => {
        // The press would otherwise blur the box and close the list under the pointer, and the
        // click that follows would land on the page instead of the game.
        const { user, box } = await answered([ZELDA]);

        await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('option') });

        expect(box).toHaveFocus();
        expect(box).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes and empties when the page changes, whatever changed it', async () => {
        const { router, box } = await answered([ZELDA]);

        await act(() => router.navigate('/lists'));

        expect(box).toHaveValue('');
        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    it('follows a clicked game, and empties', async () => {
        const { router, user, box } = await answered([ZELDA, BOTW]);

        await user.click(screen.getByRole('option', { name: /Breath of the Wild/ }));

        expect(where(router)).toBe('/games/7346');
        expect(box).toHaveValue('');
    });
});

describe('NavbarSearch below lg', () => {
    it('opens as a panel from its button, with the box focused', async () => {
        stubApi();
        const { user, box } = renderSearch();
        const toggle = screen.getByRole('button', { name: 'Search' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveAttribute('aria-controls', box.closest('form')?.id);

        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(box).toHaveFocus();
    });

    it('stays open when focus goes nowhere, which is a phone putting its keyboard away', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        const toggle = screen.getByRole('button', { name: 'Search' });
        await user.click(toggle);
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA]);

        fireEvent.blur(box, { relatedTarget: null });

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(box).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes when focus moves somewhere else on the page', async () => {
        stubApi();
        const { user } = renderSearch();
        const toggle = screen.getByRole('button', { name: 'Search' });
        await user.click(toggle);

        await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('takes off the list, then the panel, one Escape at a time, and hands focus back to its button', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();
        const toggle = screen.getByRole('button', { name: 'Search' });
        await user.click(toggle);
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA]);

        await user.keyboard('{Escape}');
        expect(box).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');

        await user.keyboard('{Escape}');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveFocus();
        expect(box).toHaveValue('zelda');
    });

    it('closes from its button', async () => {
        stubApi();
        const { user } = renderSearch();
        const toggle = screen.getByRole('button', { name: 'Search' });

        await user.click(toggle);
        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
});
