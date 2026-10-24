import { createContext, type MiddlewareFunction, type RouterContextProvider } from 'react-router';
import { apiUrl } from '@/lib/api';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import type { UpstreamFailure } from '@/lib/trace';

/**
 * The trace every request to this server starts, and how it reaches the API.
 *
 * Each request React Router routes — a document, a `.data` navigation, a resource route — draws a
 * W3C trace of its own in the root's middleware, before any loader runs. Every call a loader makes
 * to the API goes through `loaderFetch`, which sends it as `traceparent`, and the API continues it.
 * So the id a response's `X-Trace-Id` names is the id on every line the API logged while serving
 * that render, and the `traceId` in any error it answered with. ADR 0059 is the reasoning.
 *
 * Server-only, which the `.server` suffix makes React Router enforce: the browser's own requests
 * reach the API directly, and the API starts their trace itself.
 */

export interface Trace {
    /** 32 lowercase hex digits. What every log line and error body calls `traceId`. */
    traceId: string;
    /** 16 lowercase hex digits naming this request's own span, which is the parent of the API's. */
    spanId: string;
}

/** The response header naming the request's trace. The API sends the same one. */
export const TRACE_HEADER = 'X-Trace-Id';

const traceContext = createContext<Trace | null>(null);

/** Lowercase hex, never all zeros: the one value of either id the W3C recommendation forbids. */
function randomHex(bytes: number): string {
    for (;;) {
        const value = crypto.getRandomValues(new Uint8Array(bytes));
        if (value.some((byte) => byte !== 0)) {
            return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
        }
    }
}

/**
 * A trace of this server's own. Never one the viewer sent: the trace starts here, and a reader does
 * not get to choose what the render behind their page is called in our logs.
 */
export function newTrace(): Trace {
    return { traceId: randomHex(16), spanId: randomHex(8) };
}

/**
 * The request's trace: the middleware's, drawn before any loader ran. A loader always has one. Drawn
 * here otherwise, which happens only to a loader called without the middleware, as a test calls it.
 */
export function traceOf(context: Readonly<RouterContextProvider>): Trace {
    const existing = currentTrace(context);
    if (existing !== null) return existing;

    const trace = newTrace();
    context.set(traceContext, trace);
    return trace;
}

/**
 * The request's trace if it has one, without drawing one. React Router answers a few requests before
 * any middleware runs — a method it does not route, an action from another origin — and those carry
 * no `X-Trace-Id`, so a line logged about one must not name an id that is on no response.
 */
export function currentTrace(context: Readonly<RouterContextProvider> | undefined): Trace | null {
    return context?.get(traceContext) ?? null;
}

/**
 * The header the API reads. Flagged sampled, because this server does keep the id — on the response,
 * and in its own log when a render fails or a call never reaches the API — and because an
 * OpenTelemetry SDK's default sampler follows the parent's flag: unsampled, the API's own SDK would
 * record none of the spans a render causes.
 */
export function traceparent({ traceId, spanId }: Trace): string {
    return `00-${traceId}-${spanId}-01`;
}

/**
 * The root's middleware: the trace first, so every loader sees it, and its id on whatever is
 * answered, documents, `.data` and resource routes alike.
 *
 * On a page the edge shares, the header names the render that filled the cache. That is the render
 * whose calls produced what every later reader sees, so it is still the right id to report.
 */
export const traceMiddleware: MiddlewareFunction<Response> = async ({ context }, next) => {
    const { traceId } = traceOf(context);
    return withTraceHeader(await next(), traceId);
};

function withTraceHeader(response: Response, traceId: string): Response {
    try {
        response.headers.set(TRACE_HEADER, traceId);
        return response;
    } catch {
        // A Response whose headers cannot change, such as one a resource route passes on from
        // fetch() or Response.redirect(): a copy carries the header instead.
        const copy = new Response(response.body, response);
        copy.headers.set(TRACE_HEADER, traceId);
        return copy;
    }
}

/**
 * A request to the API from a loader, carrying the render's trace. **Every** server-side call to the
 * API goes through this. The lint keeps `apiUrl` to this module and `@/lib/api`, because a call made
 * any other way reaches the API under a trace of its own and nothing joins its log to the page.
 *
 * The URL is resolved as `apiUrl` resolves it, and nothing else is added: no cookie, because the
 * render is the same for every reader.
 *
 * A call that never reached the API is logged here, with the cause, because the API has no line for
 * it and nothing else does either: the loader turns the rejection into a 502 or a degraded page, and
 * React Router logs neither. Every other failure the API logged itself, under the same trace. The
 * path is logged without its query, which can be a search somebody typed.
 */
export async function loaderFetch(
    context: Readonly<RouterContextProvider>,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const trace = traceOf(context);
    const headers = new Headers(init.headers);
    headers.set('traceparent', traceparent(trace));

    try {
        return await fetch(apiUrl(path), { ...init, headers });
    } catch (error) {
        // Not when the loader gave up on it, which is the reader leaving rather than a failure.
        if (!init.signal?.aborted) {
            const method = (init.method ?? 'GET').toUpperCase();
            console.error(`${method} ${path.split('?')[0]} did not reach the API, trace ${trace.traceId}:`, error);
        }
        throw error;
    }
}

/**
 * The 502 a loader throws when the API did not answer, or answered with a failure. It carries the
 * trace id for the error page to show, and is never cached, because caching a failure outlives it.
 */
export function upstreamFailure(context: Readonly<RouterContextProvider>, message: string): Response {
    const failure: UpstreamFailure = { message, traceId: traceOf(context).traceId };

    return Response.json(failure, {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Cache-Control': PRIVATE_NO_STORE },
    });
}
