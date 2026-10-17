import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
    MIN_SEARCH_LENGTH,
    SEARCH_DEBOUNCE_MS,
    SEARCH_REFUSED,
    SEARCH_SPACING_MS,
    SEARCH_UNREACHABLE,
    useImportSearch,
} from '@/hooks/useImportSearch';
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
function renderSearch(query = '', enabled = true) {
    return renderHook(
        ({ query: q, enabled: e }) => useImportSearch(q, e),
        { initialProps: { query, enabled } },
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

describe('useImportSearch', () => {
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
        // The browse page's own question for the same term, so the API's cached answer is shared.
        expect(requests.map(r => r.url)).toEqual(['/api/games?search=resident&offset=0']);
    });

    it(`asks nothing under ${MIN_SEARCH_LENGTH} characters, counted without the spaces around them`, async () => {
        const requests = stubApi();
        const { result } = renderSearch(' r ');

        await pause(5000);

        expect(requests).toHaveLength(0);
        expect(result.current.status).toBe('idle');
    });

    it('asks nothing while the search is closed', async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil', false);

        await pause(5000);

        expect(requests).toHaveLength(0);
        expect(result.current.status).toBe('idle');
    });

    it('answers with the whole page IGDB gave, and whether it has more', async () => {
        const requests = stubApi();
        const { result } = renderSearch('resident evil');

        await pause(SEARCH_DEBOUNCE_MS);
        await requests[0].answer([RE, RE2], true);

        expect(result.current).toMatchObject({
            status: 'answered',
            term: 'resident evil',
            answer: { games: [RE, RE2], hasMore: true },
        });
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

        await pause(SEARCH_SPACING_MS);
        expect(requests.map(r => r.term)).toEqual(['resident', 'resident evil 2']);

        await requests[1].answer([RE2]);
        expect(result.current).toMatchObject({ status: 'answered', answer: { games: [RE2] } });
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
});
