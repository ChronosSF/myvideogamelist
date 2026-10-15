// @vitest-environment node
// As the server runs it: `apiUrl` resolves against API_BASE_URL only where there is no document.

import { RouterContextProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { isUpstreamFailure } from '@/lib/trace';
import {
    currentTrace,
    loaderFetch,
    newTrace,
    TRACE_HEADER,
    traceMiddleware,
    traceOf,
    traceparent,
    upstreamFailure,
} from '@/lib/trace.server';

/** The W3C recommendation's header, version 00: trace id, parent id, flags, in lowercase hex. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;

/** The arguments React Router passes a middleware; only the context is read. */
const middlewareArgs = (context: RouterContextProvider) =>
    ({ context }) as unknown as Parameters<typeof traceMiddleware>[0];

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('a trace', () => {
    it('is two random ids in lowercase hex, never all zeros', () => {
        const traces = Array.from({ length: 50 }, newTrace);

        for (const { traceId, spanId } of traces) {
            expect(traceId).toMatch(/^[0-9a-f]{32}$/);
            expect(spanId).toMatch(/^[0-9a-f]{16}$/);
            expect(traceId).not.toBe('0'.repeat(32));
            expect(spanId).not.toBe('0'.repeat(16));
        }
        expect(new Set(traces.map((trace) => trace.traceId)).size).toBe(traces.length);
    });

    it('draws its ids from the cryptographic source', () => {
        const random = vi.spyOn(crypto, 'getRandomValues');

        newTrace();

        expect(random).toHaveBeenCalledTimes(2);
    });

    it('draws again rather than send an id of all zeros, which the recommendation forbids', () => {
        const draw = crypto.getRandomValues.bind(crypto) as (array: Uint8Array) => Uint8Array;
        let first = true;
        // The first draw is left as the new array comes, which is all zeros.
        vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
            if (!first) return draw(array);
            first = false;
            return array;
        }) as typeof crypto.getRandomValues);

        const { traceId } = newTrace();

        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(traceId).not.toBe('0'.repeat(32));
    });

    it('is sent as a sampled W3C traceparent naming both ids', () => {
        const trace = newTrace();

        const header = traceparent(trace);

        expect(header).toMatch(TRACEPARENT);
        expect(header).toBe(`00-${trace.traceId}-${trace.spanId}-01`);
    });

    it('is one per request: drawn once, and the same however often it is asked for', () => {
        const context = new RouterContextProvider();
        const other = new RouterContextProvider();

        const first = traceOf(context);

        expect(traceOf(context)).toBe(first);
        expect(currentTrace(context)).toBe(first);
        expect(traceOf(other).traceId).not.toBe(first.traceId);
    });

    it('is not drawn just to be logged, for a request that never had one', () => {
        // React Router answers a few requests before any middleware runs; those carry no X-Trace-Id.
        expect(currentTrace(new RouterContextProvider())).toBeNull();
        expect(currentTrace(undefined)).toBeNull();
    });
});

describe('the middleware', () => {
    it('draws the trace before anything below it runs, and names it on the answer', async () => {
        const context = new RouterContextProvider();
        let seenBelow: string | undefined;

        const response = await traceMiddleware(middlewareArgs(context), async () => {
            seenBelow = traceOf(context).traceId;
            return new Response('fine');
        });

        expect(seenBelow).toMatch(/^[0-9a-f]{32}$/);
        expect(response).toBeInstanceOf(Response);
        expect((response as Response).headers.get(TRACE_HEADER)).toBe(seenBelow);
    });

    it('names it on an answer whose headers cannot change, by answering with a copy', async () => {
        // Response.redirect's headers are immutable, as fetch()'s are.
        const context = new RouterContextProvider();

        const response = await traceMiddleware(middlewareArgs(context), async () =>
            Response.redirect('https://localhost/elsewhere', 302)) as Response;

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('https://localhost/elsewhere');
        expect(response.headers.get(TRACE_HEADER)).toBe(traceOf(context).traceId);
    });
});

describe('a call from a loader', () => {
    it('reaches the API at its own address, carrying the render’s trace', async () => {
        vi.stubEnv('API_BASE_URL', 'http://api.internal:8080');
        const fetchMock = vi.fn(async () => new Response('{}'));
        vi.stubGlobal('fetch', fetchMock);
        const context = new RouterContextProvider();

        await loaderFetch(context, '/api/games/7346');
        await loaderFetch(context, '/api/genres');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [[firstUrl, firstInit], [, secondInit]] = fetchMock.mock.calls as unknown as [string, RequestInit][];
        expect(firstUrl).toBe('http://api.internal:8080/api/games/7346');

        // Every call of one render under one trace, so the API's lines for all of them share an id.
        const sent = new Headers(firstInit.headers).get('traceparent');
        expect(sent).toBe(traceparent(traceOf(context)));
        expect(new Headers(secondInit.headers).get('traceparent')).toBe(sent);
    });

    it('keeps what the loader asked for and adds no cookie', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'));
        vi.stubGlobal('fetch', fetchMock);
        const signal = AbortSignal.timeout(1_000);

        await loaderFetch(new RouterContextProvider(), '/api/home', {
            headers: { Accept: 'application/json' },
            signal,
        });

        const [[, init]] = fetchMock.mock.calls as unknown as [string, RequestInit][];
        const headers = new Headers(init.headers);
        expect(headers.get('Accept')).toBe('application/json');
        expect(headers.get('traceparent')).toMatch(TRACEPARENT);
        expect(headers.has('Cookie')).toBe(false);
        expect(init.signal).toBe(signal);
    });

    it('logs a call that never reached the API, which nothing else would, and still fails it', async () => {
        const unreachable = new TypeError('fetch failed');
        vi.stubGlobal('fetch', vi.fn(async () => { throw unreachable; }));
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const context = new RouterContextProvider();

        await expect(loaderFetch(context, '/api/games?search=alice@example.com')).rejects.toBe(unreachable);

        // The path without its query: a search can be an email address.
        expect(logged).toHaveBeenCalledWith(
            `GET /api/games did not reach the API, trace ${traceOf(context).traceId}:`,
            unreachable,
        );
        expect(JSON.stringify(logged.mock.calls)).not.toContain('alice');
    });

    it('says nothing when the loader gave up on the call itself', async () => {
        const controller = new AbortController();
        controller.abort();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(loaderFetch(new RouterContextProvider(), '/api/home', { signal: controller.signal }))
            .rejects.toThrow('Aborted');

        expect(logged).not.toHaveBeenCalled();
    });
});

describe('a failure a loader throws', () => {
    it('is an uncached 502 carrying the sentence and the trace id', async () => {
        const context = new RouterContextProvider();

        const response = upstreamFailure(context, 'Failed to load game.');

        expect(response.status).toBe(502);
        expect(response.statusText).toBe('Bad Gateway');
        expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE);
        expect(response.headers.get('Content-Type')).toContain('application/json');

        const body: unknown = await response.json();
        expect(isUpstreamFailure(body)).toBe(true);
        expect(body).toEqual({ message: 'Failed to load game.', traceId: traceOf(context).traceId });
    });
});
