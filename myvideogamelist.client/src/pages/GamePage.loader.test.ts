import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterContextProvider } from 'react-router';
import { headers, loader } from '@/pages/GamePage';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { game } from '@/test/factories';
import { empty, json, stubApi, unreachable } from '@/test/api';
import type { Route } from './+types/GamePage';

/**
 * The game page's loader, as the server runs it for a document request.
 *
 * #274 sends its request through a traced fetch and changes what a failure's body carries, and its
 * own suite covers that much. These hold what survives it: which ids reach the API at all, and how
 * long each answer may be kept — a failure never, a missing game briefly, and the page itself at the
 * edge (ADR 0013).
 */

function load(id: string) {
    // A context, because the server hands every loader one and #274 reads the request's trace from it.
    const args = { request: new Request(`http://localhost/games/${id}`), params: { id }, context: new RouterContextProvider() };
    return loader(args as unknown as Route.LoaderArgs);
}

/** What the loader threw, which has to be a Response for the error boundary to render its status. */
async function thrownBy(promise: Promise<unknown>): Promise<Response> {
    const thrown = await promise.then(() => null, (error: unknown) => error);
    expect(thrown).toBeInstanceOf(Response);
    return thrown as Response;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GamePage loader', () => {
    it('hands the page the game the API answered with', async () => {
        stubApi({ 'GET /api/games/26226': () => json(game({ id: 26226, title: 'Celeste' })) });

        const result = await load('26226');

        expect(result.game).toMatchObject({ id: 26226, title: 'Celeste' });
    });

    it('answers an address that cannot name a game with a 404, without asking the API', async () => {
        const api = stubApi({});

        for (const id of ['celeste', '0', '-3', '1.5']) {
            expect((await thrownBy(load(id))).status, id).toBe(404);
        }
        expect(api.calls).toHaveLength(0);
    });

    it('lets a missing game be cached for a short while, as a 404', async () => {
        stubApi({ 'GET /api/games/9': () => empty(404) });

        const response = await thrownBy(load('9'));

        expect(response.status).toBe(404);
        expect(response.headers.get('Cache-Control')).toBe(CACHE_NOT_FOUND);
    });

    it('fails with a 502 nothing may keep when the API fails or cannot be reached', async () => {
        // Cached at the edge, a failure would outlive whatever caused it.
        for (const answer of [() => empty(500), unreachable]) {
            stubApi({ 'GET /api/games/9': answer });

            const response = await thrownBy(load('9'));

            expect(response.status).toBe(502);
            expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE);
        }
    });

    it('lets the page itself be cached at the edge', () => {
        expect(headers()['Cache-Control']).toBe(CACHE_GAME);
    });
});
