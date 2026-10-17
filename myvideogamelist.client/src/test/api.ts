import { expect, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { REQUEST_HEADER } from '@/lib/api';
import type { UserProfile } from '@/types/auth';
import type { ListEntryDto, ListId } from '@/types/list';

/** One request the client made, as the API would have received it. */
export interface ApiCall {
    /** Upper case, as the routes are keyed. */
    method: string;
    /** The path alone, such as `/api/games`, whichever origin the URL was resolved against. */
    path: string;
    /** The query string, which the route key leaves out: one route answers every query to a path. */
    query: URLSearchParams;
    headers: Headers;
    credentials: RequestCredentials | undefined;
    /**
     * A string body, parsed when it is JSON and as sent when it is not. Undefined when there was no
     * body or it was not a string — a `FormData` upload is not recorded.
     */
    body: unknown;
}

/** What a route answers with: a response, or the promise of one for a request a test holds open. */
export type ApiAnswer = Response | Promise<Response>;

/**
 * The routes of a stubbed API, keyed by an upper-case method and a path without its query string,
 * as `'GET /api/games'`. A route that has to tell requests to one path apart reads `call.query`.
 */
export type ApiRoutes = Record<string, (call: ApiCall) => ApiAnswer>;

/** A JSON response, a 200 unless told otherwise. */
export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A response with no body, a 204 unless told otherwise. */
export function empty(status = 204): Response {
    return new Response(null, { status });
}

/** What `fetch` does when the API cannot be reached: it rejects, rather than answering badly. */
export function unreachable(): Promise<Response> {
    return Promise.reject(new TypeError('fetch failed'));
}

export interface HeldResponse {
    answer: Promise<Response>;
    release: (response: Response) => void;
}

/**
 * An answer the test gives when it chooses, so what is on screen while a request is out can be seen:
 * hand `answer` to a route and call `release` with the response. Releasing only ever resolves; a
 * request aborted meanwhile has already rejected, as it would have with `fetch`.
 */
export function held(): HeldResponse {
    let release!: (response: Response) => void;
    const answer = new Promise<Response>(resolve => { release = resolve; });
    return { answer, release };
}

function bodyOf(init: RequestInit): unknown {
    if (typeof init.body !== 'string') return undefined;
    try {
        return JSON.parse(init.body);
    } catch {
        return init.body;
    }
}

/** What `fetch` rejects with once the request's signal is aborted. */
const aborted = () => new DOMException('The operation was aborted.', 'AbortError');

/**
 * The API, played by the test: every request is answered by the route registered under its method
 * and path, and recorded with what it carried — the headers, the credentials and the body — so a test
 * can assert what was sent as well as what was shown. A request no route answers is a 404, recorded
 * like the rest, so a request nobody expected is in `calls` rather than an exception somewhere else;
 * a provider reads that 404 as a failed load, so a route left out shows as a control that never
 * enables.
 *
 * `calls` is live: it grows as requests are made, so a test can wait on it.
 *
 * An aborted request rejects as `fetch` rejects it, even when its answer is held, so a component that
 * cancels what it no longer wants is tested against the cancellation it relies on.
 *
 * One stub for every request a render makes, because a second `stubGlobal('fetch')` silently replaces
 * the first. Undo it with `vi.unstubAllGlobals()`.
 */
export function stubApi(routes: ApiRoutes) {
    const calls: ApiCall[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        // On the server there is no origin to resolve a relative URL against, and Node's `fetch`
        // refuses one: what `apiUrl` is for, and what `onTheServer` in `@/test/loader` checks.
        if (typeof document === 'undefined' && !/^[a-z][a-z0-9+.-]*:/i.test(String(input))) {
            throw new TypeError(`Failed to parse URL from ${String(input)}`);
        }

        const url = new URL(String(input), 'http://localhost');
        const call: ApiCall = {
            method: (init.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            query: url.searchParams,
            headers: new Headers(init.headers),
            credentials: init.credentials,
            body: bodyOf(init),
        };
        calls.push(call);

        const { signal } = init;
        if (signal?.aborted) throw aborted();

        const route = routes[`${call.method} ${call.path}`];
        const answer = Promise.resolve(route === undefined ? empty(404) : route(call));
        if (!signal) return answer;

        return Promise.race([
            answer,
            new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(aborted()), { once: true })),
        ]);
    });

    vi.stubGlobal('fetch', fetchMock);

    return {
        calls,
        /** The requests made with this method to this path, in the order they were made. */
        callsTo: (method: string, path: string) => calls.filter(call => call.method === method && call.path === path),
        /** Every request that changes state, which is every one the API's write guard looks at. */
        writes: () => calls.filter(call => !['GET', 'HEAD', 'OPTIONS'].includes(call.method)),
    };
}

/**
 * For `afterEach`: unmounts what the test rendered while the stubbed API is still in place, then
 * takes the stubs away. Vitest runs a file's own `afterEach` before the setup file's `cleanup`, so a
 * bare `vi.unstubAllGlobals()` would unmount every tree against the real `fetch`.
 */
export function tearDownApi() {
    cleanup();
    vi.unstubAllGlobals();
}

/**
 * The five reads `AppProviders` makes once `/api/auth/me` names `user` — the account, its lists as
 * `lists` has them, its list preferences, its wishlist and its favourites — answered as an account
 * that has renamed no list and has nothing on either axis. Spread a test's own routes after it.
 *
 * Signed out, the providers read `/api/auth/me` and nothing else.
 */
export function signedInRoutes(user: UserProfile, lists: Partial<Record<ListId, ListEntryDto[]>> = {}): ApiRoutes {
    return {
        'GET /api/auth/me': () => json(user),
        'GET /api/lists': () => json({ lists }),
        'GET /api/user/list-preferences': () => json({ view: 'tiles', sorts: {}, names: {} }),
        'GET /api/wishlist': () => json([]),
        'GET /api/favourites': () => json([]),
    };
}

/**
 * That a write carried the two things `apiFetch` adds: the header the API's write guard refuses a
 * write without, whatever its value (ADR 0033 §3), and the session cookie. A write sent with bare
 * `fetch` fails this, as it fails against the API with a 403.
 */
export function expectSentThroughApiFetch(call: ApiCall) {
    expect(call.headers.has(REQUEST_HEADER), `${call.method} ${call.path} carries ${REQUEST_HEADER}`).toBe(true);
    expect(call.credentials, `${call.method} ${call.path}`).toBe('include');
}

/**
 * Lets whatever the answers already given set going finish — a provider's load, a navigation and its
 * loader, the render after either — without waiting on a timer, so it works on a fake clock as well as
 * a real one. For a test asserting that something did not happen, which has nothing to wait for.
 *
 * Each tick lets every promise queued so far run, and a stubbed answer, a loader and the router's
 * commit take one or two each. Five is the most any of these needs with room to spare; it counts
 * turns of the event loop, not time, so it does not get slower or flakier under load.
 */
export async function settle() {
    await act(async () => {
        for (let tick = 0; tick < 5; tick++) await new Promise(resolve => setImmediate(resolve));
    });
}
