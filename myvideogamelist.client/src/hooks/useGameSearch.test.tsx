import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SearchPacerProvider } from '@/contexts/SearchPacerProvider';
import {
    type GameSearchOptions,
    MIN_SEARCH_LENGTH,
    SEARCH_DEBOUNCE_MS,
    SEARCH_PAGE_SIZE,
    SEARCH_REFUSED,
    SEARCH_SPACING_MS,
    SEARCH_UNREACHABLE,
    TYPEAHEAD_SIZE,
    useGameSearch,
} from '@/hooks/useGameSearch';
import { game } from '@/test/factories';
import type { GameDto } from '@/types/game';

/** One request the hook has made, held open until the test answers it. */
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
 * Stands in for the API. Every request stays open until the test settles it, and an aborted one
 * rejects as a browser's would — unless `honourAbort` is off, which plays a server answering a
 * request the browser has already stopped listening to.
 */
function stubApi({ honourAbort = true } = {}) {
    const requests: Pending[] = [];

    // Settled inside `act`, then a macrotask, by which time every promise the answer travels
    // through has run.
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

/** The hook as a search field holds it: a term, and whether the search is open. */
function renderSearch(query = '', enabled = true, options?: GameSearchOptions) {
    return renderHook(
        ({ query: q, enabled: e }) => useGameSearch(q, e, options),
        { initialProps: { query, enabled } },
    );
}

/** Two rows' searches on an import review, under the one pacer the root provides. */
function renderTwoRows(first: { query: string; enabled: boolean }, second: { query: string; enabled: boolean }) {
    return renderHook(
        ({ a, b }) => [useGameSearch(a.query, a.enabled), useGameSearch(b.query, b.enabled)] as const,
        { initialProps: { a: first, b: second }, wrapper: SearchPacerProvider },
    );
}

/** Lets the faked clock run, as a pause in the typing. */
async function pause(ms: number) {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
}

const RE2 = game({ id: 880, title: 'Resident Evil 2', releaseDate: '1998-01-21' });
const RE = game({ id: 424, title: 'Resident Evil', releaseDate: '1996-03-22' });

/** The API's own answer when IGDB does not (`UpstreamFailureHandler`). */
const OUTAGE = {
    title: 'A service this page depends on is unavailable',
    status: 502,
    detail: 'Game data comes from IGDB, which did not answer. Your own lists, scores and playthroughs are unaffected.',
};

/** The API's own answer when its queue for IGDB is full (`UpstreamBusyHandler`). */
const BUSY = {
    title: 'Busy fetching game data',
    status: 503,
    detail: 'Too many people are browsing games at once. Try again in a moment — your own lists, scores and playthroughs are unaffected.',
};

beforeEach(() => {
    // Only the clock and timeouts: the debounce and the spacing run on them. React's scheduler and
    // the promises an answer travels through stay real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('useGameSearch', () => {
    it('asks once the typing pauses, not on every keystroke', async () => {
        const requests = stubApi();
        const { result, rerender } = renderSearch();

        for (const query of ['re', 'res', 'resi', 'resident']) {
            rerender({ query, enabled: true });
            await pause(150);
        }
        expect(requests).toHaveLength(0);
        expect(result.current.status).toBe('waiting');

        await pause(SEARCH_DEBOUNCE_MS - 150);
        // The browse page's own question for the same term, cut short, so the API's cached answer is
        // shared.
        expect(requests.map(r => r.url)).toEqual([`/api/games?search=resident&offset=0&limit=${TYPEAHEAD_SIZE}`]);
    });

    it(`asks nothing under ${MIN_SEARCH_LENGTH} characters, counted without the spaces around them`, async () => {
        const requests = stubApi();
        const { result } = renderSearch(' r ');

        await pause(5000);

        expect(requests).toHaveLength(0);
        expect(result.current.status).toBe('idle');
    });

    it('asks about a two-letter title', async () => {
        // Ys is a series of a dozen games, which is why the floor is two and not three.
        const requests = stubApi();
        renderSearch('Ys');

        await pause(SEARCH_DEBOUNCE_MS);

        expect(requests.map(r => r.term)).toEqual(['Ys']);
    });

    it('asks nothing while the search is closed', async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil', false);

        await pause(5000);

        expect(requests).toHaveLength(0);
        expect(result.current.status).toBe('idle');
    });

    it('asks for as many games as it is told to, and answers with them and whether there are more', async () => {
        // An import's row asks for the browse page's whole page, where the navbar asks for its few.
        const requests = stubApi();
        const { result } = renderSearch('resident evil', true, { size: SEARCH_PAGE_SIZE });

        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.url)).toEqual([`/api/games?search=resident+evil&offset=0&limit=${SEARCH_PAGE_SIZE}`]);

        await requests[0].answer([RE, RE2], true);

        expect(result.current).toMatchObject({
            status: 'answered',
            term: 'resident evil',
            answer: { games: [RE, RE2], hasMore: true },
        });
    });

    it('cuts a longer answer down to its size, and says there are more', async () => {
        // As an API older than this client answers, mid-deploy: it ignores the limit.
        const requests = stubApi();
        const { result } = renderSearch('resident evil', true, { size: 1 });

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE, RE2]);

        expect(result.current).toMatchObject({ status: 'answered', answer: { games: [RE], hasMore: true } });
    });

    it('never asks for more games than the API answers', async () => {
        // It would refuse a larger page outright, and the refusal reads as a search that cannot run.
        const requests = stubApi();
        renderSearch('resident evil', true, { size: SEARCH_PAGE_SIZE + 5 });

        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.url)).toEqual([`/api/games?search=resident+evil&offset=0&limit=${SEARCH_PAGE_SIZE}`]);
    });

    it('does not answer at one size with the games it was given at another', async () => {
        // Six games are not an answer for somebody asking for twenty, though the term is the same.
        const requests = stubApi();
        const { result, rerender } = renderHook(
            ({ size }) => useGameSearch('resident evil', true, { size }),
            { initialProps: { size: TYPEAHEAD_SIZE } },
        );

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE], true);
        expect(result.current.status).toBe('answered');

        rerender({ size: SEARCH_PAGE_SIZE });
        expect(result.current.status).toBe('waiting');

        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.url)).toEqual([
            `/api/games?search=resident+evil&offset=0&limit=${TYPEAHEAD_SIZE}`,
            `/api/games?search=resident+evil&offset=0&limit=${SEARCH_PAGE_SIZE}`,
        ]);
    });

    it(`never starts two requests within ${SEARCH_SPACING_MS}ms, however the typing falls`, async () => {
        // A slow, steady typist whose every keystroke lands just past the debounce would otherwise
        // ask on every one.
        const requests = stubApi();
        const { rerender } = renderSearch('resident');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE]);

        // Typed the moment the first answer came: the debounce has run out long before the second
        // can start.
        rerender({ query: 'resident evil', enabled: true });
        await pause(SEARCH_SPACING_MS - 1);
        expect(requests).toHaveLength(1);

        await pause(1);
        expect(requests).toHaveLength(2);
        expect(requests[1].at - requests[0].at).toBe(SEARCH_SPACING_MS);
    });

    it('abandons the request in flight when the term moves on, and never shows its answer for the new term', async () => {
        // The server answers anyway — the dev proxy does not pass an abort on — and the late answer
        // to "resident" must not stand in for "resident evil 2", whose games a press would write.
        const requests = stubApi({ honourAbort: false });
        const { result, rerender } = renderSearch('resident');

        await pause(SEARCH_DEBOUNCE_MS);
        rerender({ query: 'resident evil 2', enabled: true });

        expect(requests[0].signal.aborted).toBe(true);

        await requests[0].answer([RE]);
        expect(result.current).toMatchObject({ status: 'waiting', term: 'resident evil 2' });

        // The abandoned request still counts: it reached the API, which asked IGDB all the same.
        await pause(SEARCH_SPACING_MS - 1);
        expect(requests).toHaveLength(1);
        await pause(1);
        expect(requests.map(r => r.term)).toEqual(['resident', 'resident evil 2']);
        expect(requests[1].at - requests[0].at).toBe(SEARCH_SPACING_MS);

        await requests[1].answer([RE2]);
        expect(result.current).toMatchObject({ status: 'answered', answer: { games: [RE2] } });
    });

    it('drops an abandoned request whole, a 503 included', async () => {
        // A 503 holds every term on the page. One that answers a request the field has already left
        // is dropped with the rest of that request, rather than holding the term that replaced it.
        const requests = stubApi({ honourAbort: false });
        const { result, rerender } = renderSearch('resident');

        await pause(SEARCH_DEBOUNCE_MS);
        rerender({ query: 'resident evil 2', enabled: true });
        await requests[0].respond(503, BUSY, { 'Retry-After': '30' });

        expect(result.current).toMatchObject({ status: 'waiting', term: 'resident evil 2' });

        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.term)).toEqual(['resident', 'resident evil 2']);
    });

    it('abandons the request in flight when the search closes', async () => {
        const requests = stubApi();
        const { result, rerender } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        rerender({ query: 'resident evil', enabled: false });

        expect(requests[0].signal.aborted).toBe(true);
        expect(result.current.status).toBe('idle');
    });

    it('shows a term it has answered again without asking', async () => {
        const requests = stubApi();
        const { result, rerender } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE]);

        rerender({ query: 'resident evil 2', enabled: true });
        await pause(SEARCH_SPACING_MS);
        await requests[1].answer([RE2]);

        rerender({ query: 'resident evil', enabled: true });
        await pause(5000);

        expect(requests).toHaveLength(2);
        expect(result.current).toMatchObject({ status: 'answered', answer: { games: [RE] } });
    });

    it('forgets the oldest of more than twenty answered terms', async () => {
        const requests = stubApi();
        const { result, rerender } = renderSearch('term 1');

        for (let n = 1; n <= 21; n++) {
            rerender({ query: `term ${n}`, enabled: true });
            await pause(SEARCH_SPACING_MS);
            await requests[n - 1].answer([game({ id: n, title: `Term ${n}` })]);
        }
        expect(requests).toHaveLength(21);

        rerender({ query: 'term 2', enabled: true });
        await pause(SEARCH_SPACING_MS);
        expect(requests).toHaveLength(21);
        expect(result.current.status).toBe('answered');

        rerender({ query: 'term 1', enabled: true });
        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.term).at(-1)).toBe('term 1');
        expect(requests).toHaveLength(22);
    });

    it("says IGDB's failure in the API's own sentence, and asks again when told to", async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(502, OUTAGE);

        expect(result.current).toMatchObject({ status: 'failed', message: OUTAGE.detail, canRetry: true });

        // Standing for its term: nothing is asked again by itself.
        await pause(5000);
        expect(requests).toHaveLength(1);

        act(() => result.current.retry());
        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests).toHaveLength(2);

        await requests[1].answer([RE]);
        expect(result.current.status).toBe('answered');
    });

    it('asks again when the search is closed and opened after a failure', async () => {
        const requests = stubApi();
        const { result, rerender } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(502, OUTAGE);

        rerender({ query: 'resident evil', enabled: false });
        rerender({ query: 'resident evil', enabled: true });
        expect(result.current.status).toBe('waiting');

        await pause(SEARCH_SPACING_MS);
        expect(requests).toHaveLength(2);
    });

    it('asks again when the term is edited after a failure', async () => {
        const requests = stubApi();
        const { result, rerender } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(502, OUTAGE);

        rerender({ query: 'resident evil 2', enabled: true });
        expect(result.current.status).toBe('waiting');

        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.term)).toEqual(['resident evil', 'resident evil 2']);
    });

    it('says so when the API cannot be reached at all', async () => {
        // A rejected fetch, which `!response.ok` never reports.
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].unreachable();

        expect(result.current).toMatchObject({ status: 'failed', message: SEARCH_UNREACHABLE, canRetry: true });
    });

    it('falls back to a plain sentence when a failure carries none', async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(500, 'not json');

        expect(result.current).toMatchObject({ status: 'failed', message: SEARCH_UNREACHABLE });
    });

    it('treats a 200 that is not a page of games as a failure', async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(200, { items: 'nope' });

        expect(result.current).toMatchObject({ status: 'failed', message: SEARCH_UNREACHABLE });
    });

    it('does not offer to repeat a question the API refused', async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(400, { title: 'One or more validation errors occurred.' });

        expect(result.current).toMatchObject({ status: 'failed', message: SEARCH_REFUSED, canRetry: false });
    });

    it("asks nothing, for any term, while a 503's wait runs, and nothing by itself once it is over", async () => {
        // The API's queue for IGDB is full. Everybody told to wait at once would otherwise all ask
        // again at once.
        const requests = stubApi();
        const { result, rerender } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(503, BUSY, { 'Retry-After': '3' });

        expect(result.current).toMatchObject({ status: 'failed', message: BUSY.detail, canRetry: false });

        rerender({ query: 'resident evil 2', enabled: true });
        await pause(2900);
        expect(requests).toHaveLength(1);
        expect(result.current).toMatchObject({ status: 'failed', canRetry: false });

        await pause(100);
        expect(result.current).toMatchObject({ status: 'failed', term: 'resident evil 2', canRetry: true });

        await pause(5000);
        expect(requests).toHaveLength(1);

        act(() => result.current.retry());
        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.term)).toEqual(['resident evil', 'resident evil 2']);
    });

    it('holds for a 429 as for a 503', async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(429, {}, { 'Retry-After': '2' });

        expect(result.current).toMatchObject({ status: 'failed', canRetry: false, busy: true });
        await pause(2000);
        expect(result.current).toMatchObject({ status: 'failed', canRetry: true, busy: true });
    });

    it("waits out no more than thirty seconds of a 503's Retry-After", async () => {
        // A search shut for longer than somebody will wait is one they stop using.
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(503, BUSY, { 'Retry-After': '120' });

        await pause(29_999);
        expect(result.current).toMatchObject({ status: 'failed', canRetry: false });
        await pause(1);
        expect(result.current).toMatchObject({ status: 'failed', canRetry: true });
    });
});

describe('useGameSearch, two rows under one SearchPacerProvider', () => {
    it('never starts two requests within a second, whichever row asks', async () => {
        // With a clock each, opening one row's search after another started two requests within
        // half a second: the budget is the person's, not the field's.
        const requests = stubApi();
        const { rerender } = renderTwoRows(
            { query: 'Resedent Evil', enabled: true },
            { query: 'Doom', enabled: false },
        );

        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.term)).toEqual(['Resedent Evil']);

        rerender({ a: { query: 'Resedent Evil', enabled: false }, b: { query: 'Doom', enabled: true } });
        await pause(SEARCH_SPACING_MS - 1);
        expect(requests).toHaveLength(1);

        await pause(1);
        expect(requests.map(r => r.term)).toEqual(['Resedent Evil', 'Doom']);
        expect(requests[1].at - requests[0].at).toBe(SEARCH_SPACING_MS);
    });

    it('spaces two searches that are both waiting to ask', async () => {
        // The navbar's typeahead and a row's search can both be waiting at once, which two rows never
        // are: the review keeps one open. Found in the browser, where the two started 31ms apart.
        const requests = stubApi();
        renderTwoRows({ query: 'Resedent Evil', enabled: true }, { query: 'zelda', enabled: true });

        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.term)).toEqual(['Resedent Evil']);

        await pause(SEARCH_SPACING_MS - 1);
        expect(requests).toHaveLength(1);

        await pause(1);
        expect(requests.map(r => r.term)).toEqual(['Resedent Evil', 'zelda']);
        expect(requests[1].at - requests[0].at).toBe(SEARCH_SPACING_MS);
    });

    it("holds every row through one row's 503, and asks nothing by itself after", async () => {
        // The queue is everybody's (ADR 0034), so moving to another row is not a way round it.
        const requests = stubApi();
        const { result, rerender } = renderTwoRows(
            { query: 'Resedent Evil', enabled: true },
            { query: 'Doom', enabled: false },
        );

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].respond(503, BUSY, { 'Retry-After': '5' });

        rerender({ a: { query: 'Resedent Evil', enabled: false }, b: { query: 'Doom', enabled: true } });
        expect(result.current[1]).toMatchObject({ status: 'failed', message: BUSY.detail, canRetry: false });

        await pause(4999);
        expect(requests).toHaveLength(1);

        await pause(1);
        expect(result.current[1]).toMatchObject({ status: 'failed', term: 'Doom', canRetry: true });

        await pause(5000);
        expect(requests).toHaveLength(1);

        act(() => result.current[1].retry());
        await pause(SEARCH_DEBOUNCE_MS);
        expect(requests.map(r => r.term)).toEqual(['Resedent Evil', 'Doom']);
    });
});
