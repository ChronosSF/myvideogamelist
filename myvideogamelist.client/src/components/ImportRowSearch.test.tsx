import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportRowSearch } from '@/components/ImportRowSearch';
import { SEARCH_DEBOUNCE_MS, SEARCH_SPACING_MS } from '@/hooks/useImportSearch';
import { game } from '@/test/factories';
import type { GameDto } from '@/types/game';

/** One request the search has made, held open until the test answers it. */
interface Pending {
    term: string | null;
    answer: (games: GameDto[], hasMore?: boolean) => Promise<void>;
    respond: (status: number, body: unknown) => Promise<void>;
}

/** Stands in for the API, as the hook's own tests do: every request waits for the test to settle it. */
function stubApi() {
    const requests: Pending[] = [];

    const settle = async (run: () => void) => {
        await act(async () => {
            run();
            await new Promise(resolve => setImmediate(resolve));
        });
    };

    const response = (status: number, body: unknown) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(),
        json: () => Promise.resolve(body),
    }) as unknown as Response;

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            requests.push({
                term: new URL(String(input), 'https://mvgl.test').searchParams.get('search'),
                answer: (games, hasMore = false) => settle(() => resolve(response(200, { items: games, hasMore }))),
                respond: (status, body) => settle(() => resolve(response(status, body))),
            });
        })));

    return requests;
}

/** The search as a review row holds it, with somewhere else on the page for focus to go. */
function Harness({ title, onChoose }: { title: string; onChoose: (game: GameDto) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <ImportRowSearch title={title} open={open} onOpenChange={setOpen} onChoose={onChoose} />
            <button type="button">Elsewhere</button>
        </>
    );
}

function renderSearch(title = 'Resedent Evil') {
    const onChoose = vi.fn();
    render(<Harness title={title} onChoose={onChoose} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const toggle = screen.getByRole('button', { name: `Search IGDB for ${title}` });
    return { onChoose, user, toggle };
}

/** Lets the faked clock run, as a pause in the typing. */
async function pause(ms: number) {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
}

const RE = game({
    id: 424,
    title: 'Resident Evil',
    releaseDate: '1996-03-22',
    coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1ir3.jpg',
    criticScore: 91,
    criticScoreCount: 12,
});
const RE_STUB = game({ id: 1960, title: 'Resident Evil', releaseDate: '1996-03-22', criticScore: 100, criticScoreCount: 1 });
const RE_BUNDLE = game({ id: 77777, title: 'Resident Evil 2 + Resident Evil 3 Bundle' });

/** The API's own answer when IGDB does not (`UpstreamFailureHandler`). */
const OUTAGE = {
    title: 'A service this page depends on is unavailable',
    status: 502,
    detail: 'Game data comes from IGDB, which did not answer. Your own lists, scores and playthroughs are unaffected.',
};

beforeEach(() => {
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

describe('ImportRowSearch', () => {
    it('is one plain action until somebody opens it, named for its row', async () => {
        // A screen of these rows is still a list somebody can work down, and a screen reader moving
        // by buttons hears which row each one searches for.
        const requests = stubApi();
        const { toggle } = renderSearch();

        expect(toggle).toHaveTextContent('Search IGDB');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

        await pause(5000);
        expect(requests).toHaveLength(0);
    });

    it("opens on the row's own title, selected, with focus in the field", async () => {
        // The spelling IGDB was first asked with is what somebody corrects; selected, so typing a
        // new title replaces it instead.
        stubApi();
        const { user, toggle } = renderSearch();

        await user.click(toggle);

        const field = screen.getByRole('searchbox', { name: 'Search IGDB' });
        expect(field).toHaveValue('Resedent Evil');
        expect(field).toHaveFocus();
        expect((field as HTMLInputElement).selectionStart).toBe(0);
        expect((field as HTMLInputElement).selectionEnd).toBe('Resedent Evil'.length);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('says when IGDB found nothing, and why that is usually the spelling', async () => {
        // IGDB's search is not fuzzy (ADR 0040), and a misspelt title is what left the row unmatched.
        const requests = stubApi();
        const { user, toggle } = renderSearch();

        await user.click(toggle);
        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.term)).toEqual(['Resedent Evil']);

        await requests[0].answer([]);

        expect(screen.getByRole('status')).toHaveTextContent(
            'No games found for “Resedent Evil”. IGDB does not correct spelling, so check the title.');
    });

    it('shows each result as the candidate picker does, critic score beside it or why there is none', async () => {
        // ADR 0040: a searched result and an offered candidate are chosen the same way. A search
        // has no floor, so the score's sample travels with it (ADR 0016) — a lone 100 is a dash.
        const requests = stubApi();
        const { user, toggle } = renderSearch();

        await user.click(toggle);
        await user.keyboard('Resident Evil');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE, RE_STUB, RE_BUNDLE]);

        const results = screen.getByRole('list', { name: 'IGDB results' });

        expect(within(results).getByRole('button', {
            name: 'Use Resident Evil (1996)',
            description: 'Critic score: 91 out of 100, from 12 reviews',
        })).toBeInTheDocument();
        expect(within(results).getByRole('button', {
            name: 'Use Resident Evil (1996)',
            description: 'Too few critic reviews to score: 1',
        })).toBeInTheDocument();
        expect(within(results).getByRole('button', {
            name: 'Use Resident Evil 2 + Resident Evil 3 Bundle',
            description: 'No critic reviews',
        })).toBeInTheDocument();

        expect(screen.getByRole('status')).toHaveTextContent('3 games found for “Resident Evil”.');
    });

    it('hands the chosen game to the row, which writes it as it writes an offered one', async () => {
        const requests = stubApi();
        const { onChoose, user, toggle } = renderSearch();

        await user.click(toggle);
        await user.keyboard('Resident Evil');
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE, RE_BUNDLE]);

        await user.click(screen.getByRole('button', { name: 'Use Resident Evil (1996)' }));

        expect(onChoose).toHaveBeenCalledExactlyOnceWith(RE);
    });

    it('says a full page is the first of more, and how to reach past it', async () => {
        // IGDB's own order can put the game somebody means thirteenth (ADR 0040), and the way to one
        // past the page is more of its title.
        const requests = stubApi();
        const { user, toggle } = renderSearch('Resident Evil');

        await user.click(toggle);
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE, RE_STUB], true);

        expect(screen.getByRole('status')).toHaveTextContent(
            'The first 2 games for “Resident Evil”. Not among them? More of the title narrows the search.');
    });

    it('cannot press a game the field has moved on from', async () => {
        // A press writes a game into somebody's import, so it may only land on the answer to what is
        // in the field. The last answer stays drawn while the next one comes, but inert.
        const requests = stubApi();
        const { user, toggle } = renderSearch('Resident Evil');

        await user.click(toggle);
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE]);

        await user.keyboard('{End} 2');

        expect(screen.getByRole('list', { name: 'IGDB results', hidden: true })).toHaveAttribute('inert');
        expect(screen.getByText('Searching…')).toBeInTheDocument();

        await pause(1000);
        await requests[1].answer([RE_BUNDLE]);

        expect(screen.getByRole('list', { name: 'IGDB results' })).not.toHaveAttribute('inert');
        expect(screen.getByRole('button', { name: 'Use Resident Evil 2 + Resident Evil 3 Bundle' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Use Resident Evil \(1996\)/ })).not.toBeInTheDocument();
    });

    it("says an IGDB outage in the API's own sentence, and asks again from the field", async () => {
        const requests = stubApi();
        const { user, toggle } = renderSearch('Resident Evil');

        await user.click(toggle);
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(502, OUTAGE);

        expect(screen.getByRole('status')).toHaveTextContent(OUTAGE.detail);
        expect(screen.queryByRole('list', { name: 'IGDB results' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        // The retry goes the moment it is pressed, so focus is put back in the field first.
        expect(screen.getByRole('searchbox', { name: 'Search IGDB' })).toHaveFocus();
        // Pressed straight after the failure, so the spacing rather than the debounce sets when.
        await pause(SEARCH_SPACING_MS);
        expect(requests).toHaveLength(2);

        await requests[1].answer([RE]);
        expect(screen.getByRole('button', { name: 'Use Resident Evil (1996)' })).toBeInTheDocument();
    });

    it("does not bring an earlier term's games back while a retry waits", async () => {
        // Found in the browser: after a failure, the retry's wait showed the games of the term
        // before the failure under the term that failed — for as long as IGDB took, which was
        // fifteen seconds on a cold start.
        const requests = stubApi();
        const { user, toggle } = renderSearch('Resident Evil');

        await user.click(toggle);
        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE]);

        await user.keyboard('{End} 2');
        await pause(SEARCH_SPACING_MS);
        await requests[1].respond(502, OUTAGE);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(screen.getByText('Searching…')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'IGDB results', hidden: true })).not.toBeInTheDocument();
    });

    it('asks for more letters rather than searching on one', async () => {
        const requests = stubApi();
        const { user, toggle } = renderSearch();

        await user.click(toggle);
        await user.keyboard('R');
        await pause(5000);

        expect(requests).toHaveLength(0);
        expect(screen.getByRole('status')).toHaveTextContent('Type at least 2 letters to search.');
    });

    it('closes on Escape and hands focus back to the button that opened it', async () => {
        const requests = stubApi();
        const { user, toggle } = renderSearch();

        await user.click(toggle);
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
        expect(toggle).toHaveFocus();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        // And it asks nothing once closed, the title's search included.
        await pause(5000);
        expect(requests).toHaveLength(0);
    });

    it('closes from its own button too, and keeps what was typed for when it opens again', async () => {
        stubApi();
        const { user, toggle } = renderSearch();

        await user.click(toggle);
        await user.keyboard('Resident Evil');
        await user.click(screen.getByRole('button', { name: 'Close' }));

        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
        expect(toggle).toHaveFocus();

        await user.click(toggle);
        expect(screen.getByRole('searchbox', { name: 'Search IGDB' })).toHaveValue('Resident Evil');
    });
});
