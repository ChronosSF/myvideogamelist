import {
    createRequestHandler,
    type ServerBuild,
    UNSAFE_withComponentProps,
    UNSAFE_withErrorBoundaryProps,
} from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as entry from '@/entry.server';
import * as root from '@/root';

/**
 * The real server entry and the real root route — its document, its error boundary — under a
 * stand-in route table, rendered by React Router's own request handler. What is under test is the
 * one rule the content policy depends on: the nonce in the header is the nonce on every inline
 * script in the body, on a page and on every kind of error document, because a script whose nonce
 * the header does not name never runs and a page whose hydration scripts never run is dead.
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

/** The page's data arrives after the shell has gone, which is when React writes scripts of its own. */
const LATE_MS = 30;

function page() {
    return <p>A page</p>;
}

function leaf(id: string, path: string, module: NonNullable<ServerBuild['routes'][string]>['module']) {
    return { id, path, parentId: 'root', module };
}

function asset(id: string, path: string, parentId: string | undefined, hasLoader: boolean) {
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
        css: [],
    };
}

const build: ServerBuild = {
    // React Router's own template returns an untyped `new Promise`, which this file keeps verbatim.
    entry: { module: entry as ServerBuild['entry']['module'] },
    routes: {
        root: { id: 'root', path: '', module: rootModule },
        page: leaf('page', 'page', {
            default: page,
            loader: () => ({ later: new Promise((resolve) => setTimeout(() => resolve('late'), LATE_MS)) }),
        }),
        missing: leaf('missing', 'missing', {
            default: page,
            loader: () => {
                throw new Response('Not Found', { status: 404 });
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
    },
    assets: {
        entry: { module: '/assets/entry.client.js', imports: [] },
        routes: {
            root: asset('root', '', undefined, false),
            page: asset('page', 'page', 'root', true),
            missing: asset('missing', 'missing', 'root', true),
            failing: asset('failing', 'failing', 'root', true),
            crashing: asset('crashing', 'crashing', 'root', false),
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

async function render(path: string, init: RequestInit = {}) {
    const response = await handle(new Request(`https://localhost${path}`, init));
    const body = await response.text();
    const policy = response.headers.get('Content-Security-Policy') ?? '';

    return {
        response,
        body,
        policy,
        nonce: /'nonce-([^']+)'/.exec(policy)?.[1],
        scripts: [...body.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag),
        nonces: new Set([...body.matchAll(/\bnonce="([^"]*)"/g)].map(([, value]) => value)),
    };
}

function expectEveryScriptToCarryTheNonce(document: Awaited<ReturnType<typeof render>>) {
    expect(document.nonce).toBeDefined();
    expect(document.scripts.length).toBeGreaterThan(0);
    for (const script of document.scripts) expect(script).toContain(`nonce="${document.nonce}"`);

    // And no other value anywhere — a stale nonce on a preload is as wrong as one on a script.
    // The empty one is `<Links nonce="">` in the root, on purpose.
    expect([...document.nonces].filter((value) => value !== '')).toEqual([document.nonce]);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a document', () => {
    it('names its nonce in the header and on every inline script', async () => {
        const document = await render('/page');

        expect(document.response.status).toBe(200);
        expect(document.response.headers.get('Content-Type')).toBe('text/html');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('covers the scripts React writes for content that arrives after the shell', async () => {
        const document = await render('/page');

        // $RC is React's instruction to swap a finished boundary in. It appears only when data
        // lands after the shell has been sent, so this is the proof the stream's own `nonce`
        // option was exercised — without it the late data is never revealed and hydration stalls.
        expect(document.body).toContain('$RC(');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('gives the links in the head an empty nonce, so the hydrating client renders them the same', async () => {
        const { body } = await render('/page');
        const icon = /<link\b[^>]*\brel="icon"[^>]*>/.exec(body)?.[0];

        // A browser blanks a nonce attribute once it has read it, and the client has no nonce to
        // render, so any value here is a hydration mismatch on every page in development. root.tsx.
        expect(icon).toContain('nonce=""');
    });

    it('covers the same scripts for a crawler, which is sent everything at once', async () => {
        const document = await render('/page', { headers: { 'User-Agent': 'Googlebot/2.1' } });

        expect(document.response.status).toBe(200);
        expectEveryScriptToCarryTheNonce(document);
    });

    it('draws a different nonce for every render', async () => {
        const first = await render('/page');
        const second = await render('/page');

        expect(first.nonce).not.toBe(second.nonce);
    });

    it('carries the policy on a HEAD, which renders nothing', async () => {
        const response = await handle(new Request('https://localhost/page', { method: 'HEAD' }));

        expect(response.headers.get('Content-Security-Policy')).toMatch(/script-src 'self' 'nonce-[^']+'/);
    });
});

describe('an error document', () => {
    it('carries the same policy for a thrown 404, and works under it', async () => {
        const document = await render('/missing');

        expect(document.response.status).toBe(404);
        expect(document.body).toContain('Page not found');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('carries the same policy for a URL no route matches', async () => {
        const document = await render('/no/such/page');

        expect(document.response.status).toBe(404);
        expectEveryScriptToCarryTheNonce(document);
    });

    it('carries the same policy for a loader that failed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const document = await render('/failing');

        expect(document.response.status).toBe(500);
        expect(document.body).toContain('Something went wrong');
        expectEveryScriptToCarryTheNonce(document);
    });

    it('names the second render’s nonce when the error boundary replaces a failed shell', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const document = await render('/crashing');

        // Two calls to the entry over the same headers, each with a nonce of its own. The header
        // that goes out has to be the second one's, because the body is the second one's.
        expect(document.response.status).toBe(500);
        expect(document.body).toContain('Something went wrong');
        expect(document.policy.match(/script-src/g)).toHaveLength(1);
        expectEveryScriptToCarryTheNonce(document);
    });
});
