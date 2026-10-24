// @vitest-environment node
// As the server runs a loader: `apiUrl` resolves against the API's address only where there is no
// document, and the request's trace lives in React Router's context.

import { RouterContextProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader as gameLoader } from '@/pages/GamePage';
import { loader as gamesLoader } from '@/pages/GamesPage';
import { loader as profileLoader } from '@/pages/ProfilePage';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { isUpstreamFailure } from '@/lib/trace';
import { traceOf, traceparent } from '@/lib/trace.server';
import { game } from '@/test/factories';

/**
 * The three loaders that call the API and fail with a page of their own: every call carries the
 * render's trace, and a failure of the API's is a 502 carrying its id for the error page to show.
 * What each page then renders is in its own test.
 */

interface Args {
    request: Request;
    params: Record<string, string>;
    context: RouterContextProvider;
}

const argsFor = (path: string, params: Record<string, string> = {}): Args => ({
    request: new Request(`https://localhost${path}`),
    params,
    context: new RouterContextProvider(),
});

/** The API, answering each path as the test says and recording the traceparent of every call. */
function stubApi(answer: (path: string) => Response | Promise<Response>) {
    const calls: { path: string; traceparent: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
        const { pathname } = new URL(url);
        calls.push({ path: pathname, traceparent: new Headers(init.headers).get('traceparent') });
        return answer(pathname);
    }));
    return calls;
}

const unreachable = () => Promise.reject(new TypeError('fetch failed'));

/** What a loader threw, which the test expects to be a Response. */
async function thrownBy(promise: Promise<unknown>): Promise<Response> {
    const thrown: unknown = await promise.then(
        () => new Error('The loader did not throw.'),
        (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    return thrown as Response;
}

/** The 502 an API failure becomes: uncached, with the sentence and the render's trace id. */
async function expectUpstreamFailure(response: Response, args: Args, message: string) {
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE);

    const body: unknown = await response.json();
    expect(isUpstreamFailure(body)).toBe(true);
    expect(body).toEqual({ message, traceId: traceOf(args.context).traceId });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the game page loader', () => {
    const args = () => argsFor('/games/7346', { id: '7346' });

    it('asks the API for the game under the render’s trace', async () => {
        const calls = stubApi(() => Response.json(game({ id: 7346 })));
        const render = args();

        await gameLoader(render as never);

        expect(calls).toEqual([{ path: '/api/games/7346', traceparent: traceparent(traceOf(render.context)) }]);
    });

    it('fails with the trace id when the API cannot be reached', async () => {
        stubApi(unreachable);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const render = args();

        await expectUpstreamFailure(await thrownBy(gameLoader(render as never)), render, 'Failed to load game.');
    });

    it('fails with the trace id when the API answers with a failure', async () => {
        stubApi(() => new Response('', { status: 500 }));
        const render = args();

        await expectUpstreamFailure(await thrownBy(gameLoader(render as never)), render, 'Failed to load game.');
    });

    it('is still a 404, with nothing to quote, for a game the API does not have', async () => {
        stubApi(() => new Response('', { status: 404 }));

        const response = await thrownBy(gameLoader(args() as never));

        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not Found');
    });
});

describe('the browse page loader', () => {
    const answer = (path: string) => path === '/api/games'
        ? Response.json({ games: [], total: 0 })
        : Response.json([]);

    it('asks for the games and both filters under one trace', async () => {
        const calls = stubApi(answer);
        const render = argsFor('/games');

        await gamesLoader(render as never);

        expect(calls.map((call) => call.path).sort()).toEqual(['/api/games', '/api/genres', '/api/platforms/active']);
        for (const call of calls) expect(call.traceparent).toBe(traceparent(traceOf(render.context)));
    });

    it('fails with the trace id when the games cannot be loaded', async () => {
        stubApi((path) => path === '/api/games' ? new Response('', { status: 503 }) : answer(path));
        const render = argsFor('/games');

        await expectUpstreamFailure(await thrownBy(gamesLoader(render as never)), render, 'Failed to load games.');
    });
});

describe('the profile page loader', () => {
    const args = () => argsFor('/u/bob', { userName: 'bob' });

    it('is a 404 for a profile the API does not show, private or unclaimed alike', async () => {
        stubApi((path) => path === '/api/users/bob' ? new Response('', { status: 404 }) : Response.json({}));

        const response = await thrownBy(profileLoader(args() as never));

        expect(response.status).toBe(404);
    });

    it('fails with the trace id when the API cannot be reached', async () => {
        const calls = stubApi(unreachable);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const render = args();

        await expectUpstreamFailure(await thrownBy(profileLoader(render as never)), render, 'Failed to load profile.');
        for (const call of calls) expect(call.traceparent).toBe(traceparent(traceOf(render.context)));
    });
});
