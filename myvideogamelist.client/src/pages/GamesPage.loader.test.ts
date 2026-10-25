import { afterEach, describe, expect, it } from 'vitest';
import { headers, loader } from '@/pages/GamesPage';
import { CACHE_GAMES_LIST, PRIVATE_NO_STORE } from '@/lib/cache';
import type { GenreDto, PlatformDto } from '@/types/game';
import { platform } from '@/test/factories';
import { cachePolicyOf, loaderArgs, onTheServer, thrownBy } from '@/test/loader';
import { type ApiRoutes, empty, json, stubApi, tearDownApi, unreachable } from '@/test/api';
import type { Route } from './+types/GamesPage';

/**
 * The browse page's loader, as the server runs it for a document request: what it asks the API
 * for, and how long its answer may be kept (ADR 0013, ADR 0032 §3). What a failure's body says is
 * left out, because the page promises its status and its caching and not its wording — which #274
 * changes in any case.
 */

const PLATFORMS: PlatformDto[] = [platform(6, 'PC (Windows)', 'PC')];
const GENRES: GenreDto[] = [{ id: 12, name: 'Role-playing (RPG)', description: null }];

/**
 * The loader for `path`, run as the server runs it, against an API that answers every request it
 * makes unless told otherwise.
 */
function load(path: string, routes: ApiRoutes = {}) {
    const api = stubApi({
        'GET /api/games': () => json({ items: [], hasMore: false }),
        'GET /api/genres': () => json(GENRES),
        'GET /api/platforms/active': () => json(PLATFORMS),
        ...routes,
    });
    return { api, result: onTheServer(() => loader(loaderArgs(path) as unknown as Route.LoaderArgs)) };
}

afterEach(tearDownApi);

describe('GamesPage loader', () => {
    it('asks for the first page of the browse the URL names, and the two lists the filters offer', async () => {
        const { api, result } = load('/games?search=zelda&platform=6');
        await result;

        expect(api.calls.map(call => `${call.path}?${call.query}`).sort()).toEqual([
            '/api/games?search=zelda&platform=6&offset=0',
            '/api/genres?',
            '/api/platforms/active?',
        ]);
    });

    it('shares a whole answer at the edge', async () => {
        const result = await load('/games?platform=6').result;

        expect(cachePolicyOf(result)).toBe(CACHE_GAMES_LIST);
        expect(result.data.browse.platform).toBe(6);
    });

    it('hands the page no options for a list that failed, and keeps that page out of shared caches', async () => {
        // Pinned at the edge, the missing filter would outlive whatever made it go missing.
        const failures: [string, ApiRoutes][] = [
            ['genres refused', { 'GET /api/genres': () => empty(503) }],
            ['platforms refused', { 'GET /api/platforms/active': () => empty(503) }],
            ['genres unreachable', { 'GET /api/genres': unreachable }],
        ];

        for (const [failure, routes] of failures) {
            const result = await load('/games', routes).result;

            expect(cachePolicyOf(result), failure).toBe(PRIVATE_NO_STORE);
            expect(result.data.genres === null || result.data.platforms === null, failure).toBe(true);
        }
    });

    it('fails the page with a 502 nothing may keep when the games cannot be loaded', async () => {
        // The list is the page, and a 502 tells a crawler to come back rather than index an empty one.
        const failures: [string, ApiRoutes][] = [
            ['refused', { 'GET /api/games': () => empty(500) }],
            ['unreachable', { 'GET /api/games': unreachable }],
        ];

        for (const [failure, routes] of failures) {
            const response = await thrownBy(load('/games', routes).result);

            expect(response.status, failure).toBe(502);
            expect(response.headers.get('Cache-Control'), failure).toBe(PRIVATE_NO_STORE);
        }
    });
});

describe('GamesPage headers', () => {
    const policyFor = (value: string) =>
        headers({ loaderHeaders: new Headers({ 'Cache-Control': value }) } as unknown as Route.HeadersArgs)['Cache-Control'];

    it('sends the policy the loader chose, whichever it was', () => {
        expect(policyFor(PRIVATE_NO_STORE)).toBe(PRIVATE_NO_STORE);
        expect(policyFor(CACHE_GAMES_LIST)).toBe(CACHE_GAMES_LIST);
    });
});
