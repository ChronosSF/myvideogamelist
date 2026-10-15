import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { NavbarSearch } from '@/components/NavbarSearch';
import {
    MIN_SEARCH_LENGTH,
    SEARCH_DEBOUNCE_MS,
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
    fail: (status: number, body: unknown) => Promise<void>;
    unreachable: () => Promise<void>;
}

/**
 * Stands in for the API. Every request stays open until the test settles it, and a request that is
 * aborted rejects as a browser's would, so what a test sees is what the box does with each answer.
 *
 * A response with nothing behind its `json` but a promise, rather than a real `Response`, so an
 * answer lands in a known number of microtasks under the faked clock.
 */
function stubApi() {
    const requests: Pending[] = [];

    const settle = async (run: () => void) => {
        await act(async () => {
            run();
            for (let tick = 0; tick < 5; tick++) await Promise.resolve();
        });
    };

    const response = (status: number, body: unknown) =>
        ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response;

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
            const url = String(input);
            const signal = init?.signal ?? new AbortController().signal;
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));

            requests.push({
                term: new URL(url, 'https://mvgl.test').searchParams.get('search'),
                url,
                init,
                at: Date.now(),
                signal,
                answer: (games, hasMore = false) => settle(() => resolve(response(200, { items: games, hasMore }))),
                fail: (status, body) => settle(() => resolve(response(status, body))),
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

/** Lets the faked clock run, as a pause in the typing. */
async function pause(ms: number) {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
}

const where = (router: ReturnType<typeof createMemoryRouter>) =>
    router.state.location.pathname + router.state.location.search;

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
    it('server-renders a plain search form, and hydrates it into the typeahead without a mismatch', async () => {
        vi.useRealTimers();
        const errors = vi.spyOn(console, 'error');
        const ui = (
            <MemoryRouter>
                <NavbarSearch panelOpen={false} onPanelOpenChange={() => {}} />
            </MemoryRouter>
        );

        const container = document.createElement('div');
        container.innerHTML = renderToString(ui);
        document.body.append(container);

        // What a reader has before any script runs: a form that searches the browse page.
        const field = within(container).getByRole('searchbox', { name: 'Search games' });
        expect(field).toHaveAttribute('name', 'search');
        expect(field.closest('form')).toHaveAttribute('action', '/games');
        expect(field.closest('form')).toHaveAttribute('method', 'get');
        // And nothing it cannot do yet: no combobox that cannot open, no list, nothing to announce.
        expect(within(container).queryByRole('combobox')).not.toBeInTheDocument();
        expect(within(container).queryByRole('listbox', { hidden: true })).not.toBeInTheDocument();
        expect(within(container).queryByRole('status')).not.toBeInTheDocument();

        render(ui, { container, hydrate: true });

        expect(await within(container).findByRole('combobox', { name: 'Search games' })).toBe(field);
        expect(errors).not.toHaveBeenCalled();
        container.remove();
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

    it(`asks nothing under ${MIN_SEARCH_LENGTH} characters`, async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'z');
        await pause(5000);
        expect(requests).toHaveLength(0);

        await user.type(box, 's');
        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.term)).toEqual(['zs']);
    });

    it('asks at most once a second, however steady the typing', async () => {
        // A keystroke every 400ms — past the debounce every time, which is ordinary typing on a
        // phone. The debounce alone would ask after every one of them from the second on.
        const requests = stubApi();
        const { box } = renderSearch();
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: 400 });

        await user.type(box, 'final fantasy');
        await pause(SEARCH_SPACING_MS);

        expect(requests.length).toBeGreaterThan(1);
        expect(requests.length).toBeLessThanOrEqual(Math.ceil((13 * 400) / SEARCH_SPACING_MS) + 1);
        for (let i = 1; i < requests.length; i++) {
            expect(requests[i].at - requests[i - 1].at).toBeGreaterThanOrEqual(SEARCH_SPACING_MS);
        }
        // And the last thing typed is always asked about in the end.
        expect(requests.at(-1)?.term).toBe('final fantasy');
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

    it('remembers an answer, so backspacing to it asks nothing', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA, BOTW]);

        await user.type(box, 's');
        await pause(SEARCH_SPACING_MS);
        await requests[1].answer([]);
        expect(screen.getByText('No games found for “zeldas”.')).toBeInTheDocument();

        await user.type(box, '{Backspace}');
        await pause(SEARCH_SPACING_MS);

        expect(requests).toHaveLength(2);
        expect(screen.getAllByRole('option').map(o => o.getAttribute('href'))).toEqual(['/games/1022', '/games/7346']);
    });

    it('never lists one term’s games under another', async () => {
        // A slow answer to an earlier term is filed under that term. Here the term changes back and
        // forth while answers arrive out of order, and each term shows only its own.
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA]);

        await user.type(box, ' breath');
        await pause(SEARCH_SPACING_MS);
        expect(requests[1].term).toBe('zelda breath');
        // Still waiting: the last answer stays up, marked as stale, rather than blanking out.
        expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');

        await requests[1].answer([BOTW]);

        expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false');
        expect(screen.getAllByRole('option').map(o => o.getAttribute('href'))).toEqual(['/games/7346']);
    });
});

describe('NavbarSearch listing', () => {
    it('lists each game with its cover, title, year and critic score — or a dash with the count under the floor', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([BOTW, ORACLE, ZELDA], true);

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

    it('announces what came back', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA, BOTW]);

        expect(screen.getByRole('status')).toHaveTextContent('2 games found for zelda.');
        expect(box).toHaveAttribute('aria-expanded', 'true');
    });

    it('says what a failure says, and asks again when told to', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        // The API's own answer when its IGDB queue is full.
        await requests[0].fail(503, {
            title: 'Busy fetching game data',
            status: 503,
            detail: 'Too many people are browsing games at once. Try again in a moment — your own lists, scores and playthroughs are unaffected.',
        });

        expect(screen.getByText(/Too many people are browsing games at once/, { selector: 'p' })).toBeVisible();
        expect(screen.getByRole('status')).toHaveTextContent(/Too many people are browsing games at once/);
        expect(box).toHaveAttribute('aria-expanded', 'false');

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        await pause(SEARCH_SPACING_MS);
        await requests[1].answer([ZELDA]);

        expect(requests).toHaveLength(2);
        expect(screen.getByRole('option', { name: /The Legend of Zelda/ })).toBeInTheDocument();
    });

    it('says so when the API cannot be reached at all', async () => {
        const requests = stubApi();
        const { user, box } = renderSearch();

        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].unreachable();

        expect(screen.getByText(SEARCH_UNREACHABLE, { selector: 'p' })).toBeVisible();
        expect(screen.getByRole('status')).toHaveTextContent(SEARCH_UNREACHABLE);
    });
});

describe('NavbarSearch keyboard', () => {
    async function answered(games: GameDto[]) {
        const requests = stubApi();
        const rendered = renderSearch();
        await rendered.user.type(rendered.box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer(games);
        return rendered;
    }

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
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA]);

        await user.tab();

        expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    it('stays open while a press inside it is turning into a click', async () => {
        // The press would otherwise blur the box and close the list under the pointer, and the
        // click that follows would land on the page instead of the game.
        const requests = stubApi();
        const { user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA]);

        const pressed = fireEvent.mouseDown(screen.getByRole('option'));

        expect(pressed).toBe(false);
        expect(box).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes and empties when the page changes, whatever changed it', async () => {
        const requests = stubApi();
        const { router, user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA]);

        await act(() => router.navigate('/lists'));

        expect(box).toHaveValue('');
        expect(box).toHaveAttribute('aria-expanded', 'false');
    });

    it('follows a clicked game, and empties', async () => {
        const requests = stubApi();
        const { router, user, box } = renderSearch();
        await user.type(box, 'zelda');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([ZELDA, BOTW]);

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
