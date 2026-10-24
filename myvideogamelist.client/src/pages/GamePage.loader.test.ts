import { afterEach, describe, expect, it } from 'vitest';
import { headers, loader } from '@/pages/GamePage';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { game } from '@/test/factories';
import { loaderArgs, onTheServer, thrownBy } from '@/test/loader';
import { empty, json, stubApi, tearDownApi, unreachable } from '@/test/api';
import type { Route } from './+types/GamePage';

/**
 * The game page's loader, as the server runs it for a document request: which ids reach the API at
 * all, what it asks the API for, and how long each answer may be kept — a failure never, a missing
 * game briefly, and the page itself at the edge (ADR 0013). What a failure's body says is left out,
 * because the page promises its status and its caching and not its wording, which #274 changes.
 */

/** The loader for `/games/{id}`, run as the server runs it. */
const load = (id: string) => onTheServer(() => loader(loaderArgs(`/games/${id}`, { id }) as unknown as Route.LoaderArgs));

afterEach(tearDownApi);

describe('GamePage loader', () => {
    it('asks the API for the game and nothing else, and hands the page its answer', async () => {
        // The members' scores and reviews are fetched after hydration, never here: the page is
        // edge-cached for a day, and a withdrawn review must not outlive its withdrawal there (ADR 0028).
        const api = stubApi({ 'GET /api/games/26226': () => json(game({ id: 26226, title: 'Celeste' })) });

        const result = await load('26226');

        expect(result.data.game).toMatchObject({ id: 26226, title: 'Celeste' });
        expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual(['GET /api/games/26226']);
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
        const failures: [string, () => Response | Promise<Response>][] = [['refused', () => empty(500)], ['unreachable', unreachable]];

        for (const [failure, answer] of failures) {
            stubApi({ 'GET /api/games/9': answer });

            const response = await thrownBy(load('9'));

            expect(response.status, failure).toBe(502);
            expect(response.headers.get('Cache-Control'), failure).toBe(PRIVATE_NO_STORE);
        }
    });

    it('lets the page itself be cached at the edge', async () => {
        // The policy rides on the loader's answer, and `headers` hands on whatever the loader decided
        // (ADR 0070), so a failure it threw is never given the page's.
        stubApi({ 'GET /api/games/26226': () => json(game({ id: 26226, title: 'Celeste' })) });

        const loaderHeaders = new Headers((await load('26226')).init?.headers);

        expect(loaderHeaders.get('Cache-Control')).toBe(CACHE_GAME);
        expect(headers({ loaderHeaders } as unknown as Route.HeadersArgs)['Cache-Control']).toBe(CACHE_GAME);
    });
});
