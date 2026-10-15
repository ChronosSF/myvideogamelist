// @vitest-environment node
// Rendered as the server renders, with no `window` or `document`: anything in the document that
// reached for either while rendering would fail here as it would on every production page.

import {
    createRequestHandler,
    type LoaderFunctionArgs,
    type ServerBuild,
    UNSAFE_withComponentProps,
    UNSAFE_withErrorBoundaryProps,
} from 'react-router';
import { Suspense, use } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as entry from '@/entry.server';
import { CACHE_GAME, CACHE_NOT_FOUND } from '@/lib/cache';
import { RESOURCE_POLICY } from '@/lib/securityHeaders';
import { loaderFetch, TRACE_HEADER, upstreamFailure } from '@/lib/trace.server';
import * as notFound from '@/pages/NotFoundPage';
import * as version from '@/resources/version';
import * as root from '@/root';

/**
 * The real server entry, the real root route — its document, its error boundary — and the real
 * catch-all, under stand-in pages, rendered by React Router's own request handler. What is under
 * test is the one rule the content policy depends on: the nonce in the header is the nonce on every
 * inline script in the body, on a page and on every kind of error document, because a script whose
 * nonce the header does not name never runs and a page whose hydration scripts never run is dead.
 * And, for a page a shared cache may store, that the header waits until the body is final. And the
 * trace: that the id a response names is the one every call its loaders made to the API carried.
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

/** A promise a stand-in page reads after its shell has gone, which a test can make fail. */
function failingLater() {
    let fail = (_reason: Error) => {};
    const promise = new Promise<string>((_resolve, reject) => {
        fail = reject;
    });
    return { promise, fail };
}

let later = failingLater();

/** How many times React Router called the entry for the current test. */
let entryCalls = 0;

beforeEach(() => {
    held = gate();
    held.release();
    later = failingLater();
    entryCalls = 0;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function page() {
    return <p>A page</p>;
}

const heldData = () => ({ later: held.promise });

/** A part of the page that suspends until `later` settles, so its failure comes after the shell. */
function LateSection() {
    return <p>{use(later.promise)}</p>;
}

function pageThatFailsLate() {
    return (
        <Suspense fallback={<p>Loading the rest</p>}>
            <LateSection />
        </Suspense>
    );
}

type RouteModule = NonNullable<ServerBuild['routes'][string]>['module'];

function leaf(id: string, path: string, module: RouteModule) {
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
        private: leaf('private', 'private', { default: page, loader: heldData }),
        // A game page's policy: shared, so sent whole.
        shared: leaf('shared', 'shared', {
            default: page,
            loader: heldData,
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
        // A page whose loader asks the API for something, as every real one does.
        traced: leaf('traced', 'traced', {
            default: page,
            loader: async ({ context }: LoaderFunctionArgs) =>
                ({ answer: await (await loaderFetch(context, '/api/probe')).text() }),
        }),
        // A page whose loader the API failed, as GamePage reports it.
        upstream: leaf('upstream', 'upstream', {
            default: page,
            loader: ({ context }: LoaderFunctionArgs) => {
                throw upstreamFailure(context, 'Failed to load the probe.');
            },
        }),
        // A page whose loader could not reach the API at all, as GamePage reports that.
        unreachable: leaf('unreachable', 'unreachable', {
            default: page,
            loader: async ({ context }: LoaderFunctionArgs) => {
                try {
                    return { answer: await (await loaderFetch(context, '/api/probe?q=alice@example.com')).text() };
                } catch {
                    throw upstreamFailure(context, 'Failed to load the probe.');
                }
            },
        }),
        // Private, so streamed: part of it fails after the shell has gone.
        'fails-late': leaf('fails-late', 'fails-late', { default: pageThatFailsLate }),
        // A resource route: a loader and no component, which is what tells React Router not to render
        // it, and which the module's type cannot say.
        version: { id: 'version', path: 'version', parentId: 'root', module: version as unknown as RouteModule },
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
            traced: asset('traced', 'traced', 'root', true),
            upstream: asset('upstream', 'upstream', 'root', true),
            unreachable: asset('unreachable', 'unreachable', 'root', true),
            'fails-late': asset('fails-late', 'fails-late', 'root', false),
            version: asset('version', 'version', 'root', true),
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

describe('a trace', () => {
    /** Stands in for the API, recording the traceparent of each call it is sent. */
    function stubApi() {
        const sent: (string | null)[] = [];
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit = {}) => {
            sent.push(new Headers(init.headers).get('traceparent'));
            return new Response('from the API');
        }));
        return sent;
    }

    const traceIdOf = (response: Response) => response.headers.get(TRACE_HEADER) ?? '';

    it('is named on the document, and carried by every call its loaders made to the API', async () => {
        const sent = stubApi();

        const document = await render('/traced');
        const traceId = traceIdOf(document.response);

        expect(document.body).toContain('from the API');
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
    });

    it('is drawn afresh for each request, and a .data navigation is one', async () => {
        const sent = stubApi();

        const first = await handle(request('/traced'));
        const second = await handle(request('/traced.data'));
        await Promise.all([first.text(), second.text()]);

        expect(traceIdOf(first)).not.toBe(traceIdOf(second));
        expect(sent.map((header) => header?.split('-')[1])).toEqual([traceIdOf(first), traceIdOf(second)]);
    });

    it('is named on a HEAD and on the shared 404, which make no call', async () => {
        const head = await handle(request('/shared', { method: 'HEAD' }));
        const notFound = await handle(request('/no/such/page'));
        await notFound.text();

        expect(traceIdOf(head)).toMatch(/^[0-9a-f]{32}$/);
        expect(traceIdOf(notFound)).toMatch(/^[0-9a-f]{32}$/);
    });

    it('is the reference the error page shows when the API failed a loader', async () => {
        const document = await render('/upstream');
        const traceId = traceIdOf(document.response);

        expect(document.response.status).toBe(502);
        expect(document.body).toContain('Failed to load the probe.');
        expect(document.body).toMatch(new RegExp(`<code[^>]*>${traceId}</code>`));
        // And in the data the browser hydrates from, so that its render shows the same id.
        expect(document.body.split(traceId).length - 1).toBeGreaterThan(1);
        expectEveryScriptToCarryTheNonce(document);
    });

    it('is logged beside a loader that threw, with the path and not the query', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const document = await render('/failing?q=alice@example.com');

        expect(logged).toHaveBeenCalledWith(
            `GET /failing failed, trace ${traceIdOf(document.response)}:`,
            expect.objectContaining({ message: 'The loader failed.' }),
        );
        expect(JSON.stringify(logged.mock.calls)).not.toContain('alice');
    });

    it('is logged, and is the reference on the page, when a call never reached the API', async () => {
        // The one failure the API has no line for, so the only place the reference can be found.
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const document = await render('/unreachable');
        const traceId = traceIdOf(document.response);

        expect(document.response.status).toBe(502);
        expect(document.body).toMatch(new RegExp(`<code[^>]*>${traceId}</code>`));
        expect(logged).toHaveBeenCalledWith(
            `GET /api/probe did not reach the API, trace ${traceId}:`,
            expect.objectContaining({ message: 'fetch failed' }),
        );
        expect(JSON.stringify(logged.mock.calls)).not.toContain('alice');
    });

    it('is named in a .data failure by that request, not by the page it was loaded from', async () => {
        // A client-side navigation lands on the error page with the error this carries, so the id in
        // it has to be the navigation's own.
        const response = await handle(request('/upstream.data'));
        const body = await response.text();

        expect(body).toContain(traceIdOf(response));
    });

    it('starts at this server, whatever trace the viewer sent', async () => {
        const sent = stubApi();
        const theirs = '0af7651916cd43dd8448eb211c80319c';

        const document = await render('/traced', {
            headers: { traceparent: `00-${theirs}-b7ad6b7169203331-01` },
        });

        expect(traceIdOf(document.response)).not.toBe(theirs);
        expect(sent[0]).not.toContain(theirs);
        expect(sent[0]).toContain(traceIdOf(document.response));
    });

    it('is logged beside a part of a streamed page that failed after the shell', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await handle(request('/fails-late'));
        later.fail(new Error('The late part failed.'));
        await response.text();

        expect(logged).toHaveBeenCalledWith(
            `GET /fails-late failed, trace ${traceIdOf(response)}:`,
            expect.objectContaining({ message: 'The late part failed.' }),
        );
    });

    it('is none for what React Router refuses before any middleware runs, which names no trace', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await handle(request('/private', { method: 'PROPFIND' }));
        await response.text();

        expect(response.status).toBe(405);
        expect(response.headers.has(TRACE_HEADER)).toBe(false);
        // The error React Router's own response stands for, as its default handler logs it.
        expect(logged).toHaveBeenCalledWith(
            'PROPFIND /private failed, trace none:',
            expect.objectContaining({ message: 'Invalid request method "PROPFIND"' }),
        );
    });

    it('is named on what /version answers, as on every resource route', async () => {
        const response = await handle(request('/version'));

        expect(traceIdOf(response)).toMatch(/^[0-9a-f]{32}$/);
        expect(await response.json()).toEqual({ sha: 'unknown', builtAt: 'unknown' });
    });

    it('is logged beside a shell that failed to render', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const document = await render('/crashing');

        expect(logged).toHaveBeenCalledWith(
            `GET /crashing failed, trace ${traceIdOf(document.response)}:`,
            expect.objectContaining({ message: 'The page failed to render.' }),
        );
    });
});
