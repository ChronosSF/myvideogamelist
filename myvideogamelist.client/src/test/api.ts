import { vi } from 'vitest';

/** One request the client made, as the API would have received it. */
export interface ApiCall {
    method: string;
    /** The path alone, such as `/api/games`, whichever origin the URL was resolved against. */
    path: string;
    query: URLSearchParams;
    headers: Headers;
    credentials: RequestCredentials | undefined;
    /** The JSON body, parsed, or undefined when the request had none. */
    body: unknown;
}

/** What a route answers with: a response, or the promise of one for a request a test holds open. */
export type ApiAnswer = Response | Promise<Response>;

/** The routes of a stubbed API, keyed by method and path, as `'GET /api/auth/me'`. */
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

/** A response the test sends when it chooses, so what is on screen while a request is out can be seen. */
export interface HeldResponse {
    answer: Promise<Response>;
    release: (response: Response) => void;
}

export function held(): HeldResponse {
    let release!: (response: Response) => void;
    const answer = new Promise<Response>(resolve => { release = resolve; });
    return { answer, release };
}

/** What `fetch` rejects with once the request's signal is aborted. */
const aborted = () => new DOMException('The operation was aborted.', 'AbortError');

/**
 * The API, played by the test: every request is answered by the route registered under its method
 * and path, and recorded with what it carried — the headers, the credentials and the body — so a test
 * can assert what was sent as well as what was shown. A request no route answers is a 404, recorded
 * like the rest, so a request nobody expected is in `calls` rather than an exception somewhere else.
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
        const url = new URL(String(input), 'http://localhost');
        const call: ApiCall = {
            method: (init.method ?? 'GET').toUpperCase(),
            path: url.pathname,
            query: url.searchParams,
            headers: new Headers(init.headers),
            credentials: init.credentials,
            body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
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
