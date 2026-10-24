import { expect } from 'vitest';
import { RouterContextProvider } from 'react-router';

/**
 * A route loader's arguments as the server builds them for a document request to `path`, context
 * included, since the server hands every loader one. Cast at the call site to the route's own
 * `Route.LoaderArgs`, which only typegen knows.
 */
export function loaderArgs(path: string, params: Record<string, string> = {}) {
    return { request: new Request(`http://localhost${path}`), params, context: new RouterContextProvider() };
}

/**
 * Runs a loader with no `document`, which is how `apiUrl` tells the server from the browser. Under
 * jsdom there always is one, so a loader that sent a bare `/api/...` would pass here while every
 * server render failed: on the server a relative URL has no origin, and `stubApi` refuses one then,
 * as Node's `fetch` does. Not for anything that renders.
 */
export async function onTheServer<T>(load: () => Promise<T>): Promise<T> {
    const own = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true, writable: true });
    try {
        return await load();
    } finally {
        if (own) Object.defineProperty(globalThis, 'document', own);
        else delete (globalThis as { document?: unknown }).document;
    }
}

/** What a loader threw, which has to be a Response for the error boundary to render its status. */
export async function thrownBy(promise: Promise<unknown>): Promise<Response> {
    const thrown = await promise.then(() => null, (error: unknown) => error);
    expect(thrown).toBeInstanceOf(Response);
    return thrown as Response;
}

/** The `Cache-Control` a loader attached through `data()`, or null when it attached none. */
export function cachePolicyOf(result: { init?: ResponseInit | null }): string | null {
    return new Headers(result.init?.headers).get('Cache-Control');
}
