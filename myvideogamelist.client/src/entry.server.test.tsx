// @vitest-environment node
// Rendered as the server renders, with no `window` or `document`: anything in the document that
// reached for either while rendering would fail here as it would on every production page.

import {
    createRequestHandler,
    type ServerBuild,
    UNSAFE_withComponentProps,
    UNSAFE_withErrorBoundaryProps,
} from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as entry from '@/entry.server';
import { CACHE_GAME, CACHE_NOT_FOUND } from '@/lib/cache';
import { RESOURCE_POLICY } from '@/lib/securityHeaders';
import * as notFound from '@/pages/NotFoundPage';
import * as root from '@/root';

/**
 * The real server entry, the real root route — its document, its error boundary — and the real
 * catch-all, under stand-in pages, rendered by React Router's own request handler. What is under
 * test is the one rule the content policy depends on: the nonce in the header is the nonce on every
 * inline script in the body, on a page and on every kind of error document, because a script whose
 * nonce the header does not name never runs and a page whose hydration scripts never run is dead.
 * And, for a page a shared cache may store, that the header waits until the body is final.
 */

/**
 * The root module as the build hands it to the server. React Router's Vite plugin wraps a route's
 * default export and its `ErrorBoundary` so that they receive `loaderData`, `error` and the rest as
 * props; the bare module would render every error as the generic one.
 */
const rootModule = {
    ...root,
    default: UNSAFE_withComponentProps(root.default),
    ErrorBoundary: UNSAFE_withErrorBoundaryProps(root.ErrorBoundary),
};

/**
 * Data the stand-in pages hand over unfinished, which a test can hold. While it is held, a streamed
 * document has already sent its header and a document sent whole has not.
 */
function gate() {
    let release = () => {};
    const promise = new Promise<string>((resolve) => {
        release = () => resolve('released');
    });
    return { promise, release };
}

let held = gate();

/** How many times React Router called the entry for the current test. */
let entryCalls = 0;

beforeEach(() => {
    held = gate();
    held.release();
    entryCalls = 0;
});

function page() {
    return <p>A page</p>;
}

const later = () => ({ later: held.promise });

function leaf(id: string, path: string, module: NonNullable<ServerBuild['routes'][string]>['module']) {
    return { id, path, parentId: 'root', module };
}

function asset(id: string, path: string, parentId: string | undefined, hasLoader: boolean, css: string[] = []) {
    return {
        id,
        path,
        parentId,
        module: `/assets/${id}.js`,
        hasLoader,
        hasAction: false,
        hasClientAction: false,
        hasClientLoader: false,
        hasClientMiddleware: false,
        hasErrorBoundary: id === 'root',
        clientActionModule: undefined,
        clientLoaderModule: undefined,
        clientMiddlewareModule: undefined,
        hydrateFallbackModule: undefined,
        imports: [],
        css,
    };
}

const build: ServerBuild = {
    entry: {
        // React Router's own template returns an untyped `new Promise`, which the entry keeps
        // verbatim; hence the cast. Counted, so that a test can tell a second render happened.
        module: {
            ...entry,
            default: (...args: Parameters<typeof entry.default>) => {
                entryCalls += 1;
                return entry.default(...args);
            },
        } as ServerBuild['entry']['module'],
    },
    routes: {
        root: { id: 'root', path: '', module: rootModule },
        // No `headers` export, so the root's `private, no-store`: streamed.
        private: leaf('private', 'private', { default: page, loader: later }),
        // A game page's policy: shared, so sent whole.
        shared: leaf('shared', 'shared', {
            default: page,
            loader: later,
            headers: () => ({ 'Cache-Control': CACHE_GAME }),
        }),
        missing: leaf('missing', 'missing', {
            default: page,
            loader: () => {
                throw new Response('Not Found', { status: 404 });
            },
        }),
        unavailable: leaf('unavailable', 'unavailable', {
            default: page,
            loader: () => {
                throw new Response('Bad Gateway', { status: 502 });
            },
        }),
        failing: leaf('failing', 'failing', {
            default: page,
            loader: () => {
                throw new Error('The loader failed.');
            },
        }),
        crashing: leaf('crashing', 'crashing', {
            // Thrown while rendering, which on the server fails the shell rather than reaching a
            // boundary: React Router renders the error boundary in a second call to the entry.
            default: () => {
                throw new Error('The page failed to render.');
            },
        }),
        'not-found': leaf('not-found', '*', notFound),
    },
    assets: {
        entry: { module: '/assets/entry.client.js', imports: ['/assets/chunk.js'] },
        routes: {
            root: asset('root', '', undefined, false, ['/assets/root.css']),
            private: asset('private', 'private', 'root', true),
            shared: asset('shared', 'shared', 'root', true),
            missing: asset('missing', 'missing', 'root', true),
            unavailable: asset('unavailable', 'unavailable', 'root', true),
            failing: asset('failing', 'failing', 'root', true),
            crashing: asset('crashing', 'crashing', 'root', false),
            'not-found': asset('not-found', '*', 'root', true),
        },
        url: '/assets/manifest.js',
        version: 'test',
    },
    publicPath: '/',
    assetsBuildDirectory: 'build/client',
    future: {},
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: 'lazy', manifestPath: '/__manifest' },
};

const handle = createRequestHandler(build, 'production');

const request = (path: string, init: RequestInit = {}) => new Request(`https://localhost${path}`, init);

/** Inline scripts the policy governs. A JSON data block, such as `<Meta>`'s JSON-LD, never runs. */
function isScript(tag: string): boolean {
    const type = /\btype="([^"]*)"/.exec(tag)?.[1]?.toLowerCase();
    return type === undefined || ['', 'module', 'text/javascript', 'importmap'].includes(type);
}

async function read(response: Response) {
    const body = await response.text();
    const policy = response.headers.get('Content-Security-Policy') ?? '';

    return {
        response,
        body,
        policy,
        nonce: /'nonce-([^']+)'/.exec(policy)?.[1],
        // Case-insensitive, as HTML is, although React writes every tag in lower case.
        scripts: [...body.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag).filter(isScript),
        links: [...body.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag),
        nonces: new Set([...body.matchAll(/\bnonce="([^"]*)"/g)].map(([, value]) => value)),
    };
}

const render = async (path: string, init?: RequestInit) => read(await handle(request(path, init)));

type Document = Awaited<ReturnType<typeof read>>;

function expectEveryScriptToCarryTheNonce(document: Document) {
    expect(document.nonce).toBeDefined();
    expect(document.scripts.length).toBeGreaterThan(0);
    for (const script of document.scripts) expect(script).toContain(`nonce="${document.nonce}"`);

    // And no other value anywhere: a stale nonce on a preload is as wrong as one on a script. The
    // empty one is `<Links nonce="">` in the root, on purpose.
    expect([...document.nonces].filter((value) => value !== '')).toEqual([document.nonce]);
}

/** Whether a promise has settled by the time this is asked, without waiting for it. */
function track<T>(promise: Promise<T>) {
    const state = { settled: false };
    void promise.then(() => (state.settled = true), () => (state.settled = true));
    return state;
}

describe('a document', () => {
    it('names its nonce in the header and on every inline script', async () => {
        const document = await render('/private');

        expect(document.response.status).toBe(200);
        expect(document.response.headers.get('Content-Type')).toBe('text/html');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('covers the scripts React writes to reveal what finished after the shell', async () => {
        const document = await render('/private');

        // $RC is React's instruction to swap a finished boundary in. A streamed document always
        // has one, because the loader data is read after the shell has been sent; without the
        // stream's own `nonce` option the data is never revealed and hydration stalls.
        expect(document.body).toContain('$RC(');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('streams a private document: its header goes before its data is final', async () => {
        held = gate();

        // Resolves with the data still held, because the header leaves with the shell.
        const response = await handle(request('/private'));
        held.release();
        const document = await read(response);

        expect(document.body).toContain('released');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('sends a shared document whole: its header waits until the body is final', async () => {
        held = gate();

        const shared = handle(request('/shared'));
        const sharedState = track(shared);
        // The same render, streamed, as a yardstick: once it has answered, a shared page that
        // streamed would have answered too.
        const yardstick = await handle(request('/private'));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(sharedState.settled).toBe(false);

        held.release();
        await yardstick.text();
        const document = await read(await shared);

        expect(document.response.headers.get('Cache-Control')).toBe(CACHE_GAME);
        expect(document.body).toContain('released');
        expect(document.body).not.toContain('$RC(');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('sends a crawler everything at once, with the same nonce throughout', async () => {
        const document = await render('/private', { headers: { 'User-Agent': 'Googlebot/2.1' } });

        expect(document.response.status).toBe(200);
        // No reveal scripts: the proof that this took the all-at-once path.
        expect(document.body).not.toContain('$RC(');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('draws a nonce of its own for each of several renders at once', async () => {
        held = gate();

        // All three have sent their headers and are still writing their bodies when the data is
        // released, so they overlap: a nonce kept anywhere shared between requests would turn up
        // in the wrong one.
        const responses = await Promise.all([1, 2, 3].map(() => handle(request('/private'))));
        held.release();
        const documents = await Promise.all(responses.map(read));

        for (const document of documents) expectEveryScriptToCarryTheNonce(document);
        expect(new Set(documents.map((document) => document.nonce)).size).toBe(3);
    });

    it('gives the links an empty nonce, so the hydrating client renders them the same', async () => {
        const document = await render('/private');
        const stylesheet = document.links.find((link) => link.includes('href="/assets/root.css"'));

        // A browser blanks a nonce attribute once it has read it, and the client has no nonce to
        // render, so on a stylesheet link — which React hydrates attribute by attribute — any value
        // here is a mismatch. root.tsx says more.
        expect(stylesheet).toContain('nonce=""');
        for (const link of document.links.filter((link) => !link.includes('rel="modulepreload"'))) {
            expect(link).toContain('nonce=""');
        }
    });

    it('sends no content policy on a HEAD, whose nonce would be on no script', async () => {
        const response = await handle(request('/shared', { method: 'HEAD' }));

        expect(response.headers.has('Content-Security-Policy')).toBe(false);
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });
});

describe('a .data response', () => {
    it('cannot be run as a script, and loads nothing', async () => {
        const response = await handle(request('/private.data'));

        // React Router's own label for it, which a browser would run as a classic script if it
        // were allowed to sniff.
        expect(response.headers.get('Content-Type')).toBe('text/x-script');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('Content-Security-Policy')).toBe(RESOURCE_POLICY);
        expect(await response.text()).toContain('released');
    });
});

describe('an error document', () => {
    it.each([
        ['/missing', 404, 'Page not found'],
        ['/unavailable', 502, '502'],
    ])('carries the same policy for a thrown %s, and works under it', async (path, status, title) => {
        const document = await render(path);

        expect(document.response.status).toBe(status);
        expect(document.body).toContain(title);
        expectEveryScriptToCarryTheNonce(document);
    });

    it('sends the catch-all 404 whole, since the edge shares it', async () => {
        const document = await render('/no/such/page');

        expect(document.response.status).toBe(404);
        expect(document.response.headers.get('Cache-Control')).toBe(CACHE_NOT_FOUND);
        expect(document.body).toContain('Page not found');
        expect(document.body).not.toContain('$RC(');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('carries the same policy for a loader that failed', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const document = await render('/failing');

        expect(logged).toHaveBeenCalled();
        expect(document.response.status).toBe(500);
        expect(document.body).toContain('Something went wrong');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('names the second render’s nonce when the error boundary replaces a failed shell', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const document = await render('/crashing');

        // Two calls to the entry over the same headers, each with a nonce of its own. The header
        // that goes out has to be the second one's, because the body is the second one's.
        expect(entryCalls).toBe(2);
        expect(logged).toHaveBeenCalled();
        expect(document.response.status).toBe(500);
        expect(document.body).toContain('Something went wrong');
        expect(document.policy.match(/script-src/g)).toHaveLength(1);
        expectEveryScriptToCarryTheNonce(document);
    });
});
