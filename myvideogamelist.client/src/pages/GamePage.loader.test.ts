import { afterEach, describe, expect, it, vi } from 'vitest';
import { headers, loader } from '@/pages/GamePage';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import { communityScores, communityTimes, game } from '@/test/factories';
import { cachePolicyOf, loaderArgs, onTheServer, thrownBy } from '@/test/loader';
import { empty, held, json, stubApi, tearDownApi, unreachable, type ApiRoutes } from '@/test/api';
import type { Route } from './+types/GamePage';

/**
 * The game page's loader, as the server runs it for a document request: which ids reach the API at
 * all, what it asks the API for, and how long each answer may be kept — a failure never, a missing
 * game briefly, a page missing the members' figures never, and a whole page at the edge (ADR 0013,
 * ADR 0069). What a failure's body says is left out, because the page promises its status and its
 * caching and not its wording, which #274 changes.
 */

/** The loader for `/games/{id}`, run as the server runs it. */
const load = (id: string) => onTheServer(() => loader(loaderArgs(`/games/${id}`, { id }) as unknown as Route.LoaderArgs));

const WITCHER = game({ id: 1942, title: 'The Witcher 3: Wild Hunt' });
const SCORES = communityScores({ scored: 23, mean: 8.4, distribution: [0, 0, 0, 0, 0, 0, 0, 23, 0, 0], tracked: 31 });
const TIMES = communityTimes({ normally: { samples: MIN_PLAYTHROUGH_SAMPLES, medianMinutes: 3120 } });

/** The API answering for game 1942 — the game and both of the members' figures — unless a test says otherwise. */
function routes(overrides: ApiRoutes = {}): ApiRoutes {
    return {
        'GET /api/games/1942': () => json(WITCHER),
        'GET /api/games/1942/community-scores': () => json(SCORES),
        'GET /api/games/1942/community-times': () => json(TIMES),
        ...overrides,
    };
}

afterEach(() => {
    tearDownApi();
    vi.unstubAllEnvs();
});

describe('GamePage loader', () => {
    it("asks the API for the game and the members' figures, and never for their reviews", async () => {
        // The figures name nobody, so they may sit in a page the edge shares (ADR 0069). The reviews
        // name their authors and are fetched after hydration, never here: a withdrawn review must not
        // outlive its withdrawal at the edge (ADR 0028).
        const api = stubApi(routes());

        const result = await load('1942');

        expect(result.data.game).toMatchObject({ id: 1942, title: 'The Witcher 3: Wild Hunt' });
        expect(result.data.scores).toEqual(SCORES);
        expect(result.data.times).toEqual(TIMES);
        expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual([
            'GET /api/games/1942',
            'GET /api/games/1942/community-scores',
            'GET /api/games/1942/community-times',
        ]);
    });

    it('asks for the game and both figures at once, not one after another', async () => {
        // The page waits for the slowest of the three, not for their sum.
        const answers = [held(), held(), held()];
        const api = stubApi({
            'GET /api/games/1942': () => answers[0].answer,
            'GET /api/games/1942/community-scores': () => answers[1].answer,
            'GET /api/games/1942/community-times': () => answers[2].answer,
        });

        const result = load('1942');
        await vi.waitFor(() => expect(api.calls).toHaveLength(3));
        answers[0].release(json(WITCHER));
        answers[1].release(json(SCORES));
        answers[2].release(json(TIMES));

        expect(cachePolicyOf(await result)).toBe(CACHE_GAME);
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

    it('fails with a 502 nothing may keep when the API fails or cannot be reached, whatever the figures did', async () => {
        // Cached at the edge, a failure would outlive whatever caused it.
        const failures: [string, () => Response | Promise<Response>][] = [['refused', () => empty(500)], ['unreachable', unreachable]];

        for (const [failure, answer] of failures) {
            stubApi(routes({ 'GET /api/games/1942': answer }));

            const response = await thrownBy(load('1942'));

            expect(response.status, failure).toBe(502);
            expect(response.headers.get('Cache-Control'), failure).toBe(PRIVATE_NO_STORE);
        }
    });

    it('lets a page with everything in it be cached at the edge', async () => {
        stubApi(routes());

        expect(cachePolicyOf(await load('1942'))).toBe(CACHE_GAME);
    });

    it("still renders the game when the members' figures did not come, and lets nothing keep it", async () => {
        // The page stands without them. Kept at the edge it would go on leaving our score out long
        // after the API recovered: for an hour, then a day stale.
        const missing: [string, ApiRoutes][] = [
            ['scores refused', { 'GET /api/games/1942/community-scores': () => empty(500) }],
            ['times unreachable', { 'GET /api/games/1942/community-times': unreachable }],
        ];

        for (const [what, overrides] of missing) {
            stubApi(routes(overrides));

            const result = await load('1942');

            expect(result.data.game, what).toMatchObject({ id: 1942 });
            expect(cachePolicyOf(result), what).toBe(PRIVATE_NO_STORE);
        }
    });

    it('lets nothing keep a page built from answers that are not the shape it reads', async () => {
        // A 200 with nothing in it would otherwise be taken for whole, and the description's reading of
        // it would fail in `meta` — on the edge's copy of the page's data, for a day.
        const malformed: [string, ApiRoutes][] = [
            ['times', { 'GET /api/games/1942/community-times': () => json({}) }],
            ['scores', { 'GET /api/games/1942/community-scores': () => json({}) }],
            ['scores as a list', { 'GET /api/games/1942/community-scores': () => json([]) }],
        ];

        for (const [what, overrides] of malformed) {
            stubApi(routes(overrides));

            const result = await load('1942');

            expect(result.data.game, what).toMatchObject({ id: 1942 });
            expect(cachePolicyOf(result), what).toBe(PRIVATE_NO_STORE);
        }
    });

    it('lets nothing keep a page built from an API older than this build', async () => {
        // Mid-deploy: scores with no tracked count. Whole as far as that API knows, and missing the
        // description's lead all the same.
        const { tracked: _, ...older } = SCORES;
        stubApi(routes({ 'GET /api/games/1942/community-scores': () => json(older) }));

        expect(cachePolicyOf(await load('1942'))).toBe(PRIVATE_NO_STORE);
    });

    it("renders without the members' figures, and lets nothing keep it, rather than wait past their deadline", async () => {
        // A database slow enough to miss it — a failover, a lock — would otherwise hold every game page
        // for as long as the API waits on it. Here the deadline has already passed when they are asked.
        const timeout = vi.spyOn(AbortSignal, 'timeout')
            .mockImplementation(() => AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')));
        stubApi(routes());

        const result = await load('1942');

        expect(timeout).toHaveBeenCalledTimes(2);
        expect(result.data.game).toMatchObject({ id: 1942 });
        expect(result.data.scores).toBeNull();
        expect(result.data.times).toBeNull();
        expect(cachePolicyOf(result)).toBe(PRIVATE_NO_STORE);
    });

    it('keeps nothing the page would not show: under the floors, only the counts', async () => {
        // The loader's data is in the shared HTML for as long as the page is kept. A lone member's
        // score and a median from two runs are kept off the page by its floors, so they are kept out
        // of the copy beside it too (ADR 0028's consequences, ADR 0069 §1).
        stubApi(routes({
            'GET /api/games/1942/community-scores': () =>
                json(communityScores({ scored: 1, mean: 9, distribution: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0], tracked: 2 })),
            'GET /api/games/1942/community-times': () =>
                json(communityTimes({ normally: { samples: MIN_PLAYTHROUGH_SAMPLES - 1, medianMinutes: 600 } })),
        }));

        const result = await load('1942');

        expect(result.data.scores).toEqual(communityScores({ scored: 1, mean: null, tracked: 2 }));
        expect(result.data.times).toEqual(communityTimes({ normally: { samples: MIN_PLAYTHROUGH_SAMPLES - 1, medianMinutes: null } }));
        expect(cachePolicyOf(result)).toBe(CACHE_GAME);
    });

    it('records the day it ran in UTC, whatever the server’s own zone', async () => {
        // Late on 17 October in UTC is already the 18th in Kiritimati. Release dates are UTC days, so a
        // date read in the server's zone would publish a game a day early there.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-17T23:30:00Z'));
        vi.stubEnv('TZ', 'Pacific/Kiritimati');
        stubApi(routes());

        try {
            expect((await load('1942')).data.today).toBe('2026-10-17');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('GamePage headers', () => {
    const headersFor = (loaderHeaders: Headers) => headers({ loaderHeaders } as unknown as Route.HeadersArgs);

    it("sends the loader's policy, whichever it chose", () => {
        for (const policy of [CACHE_GAME, PRIVATE_NO_STORE]) {
            expect(headersFor(new Headers({ 'Cache-Control': policy }))).toEqual({ 'Cache-Control': policy });
        }
    });

    it("sends a thrown response's own policy, which is what a `.data` request's error reaches it with", () => {
        // A client-side navigation's data request does not bubble a loader's error to the root, so a
        // 404 or a 502 thrown here comes through this function. It used to answer the game's hour.
        expect(headersFor(new Headers({ 'Cache-Control': CACHE_NOT_FOUND }))).toEqual({ 'Cache-Control': CACHE_NOT_FOUND });
    });

    it('fails closed when the loader stated none', () => {
        expect(headersFor(new Headers())).toEqual({ 'Cache-Control': PRIVATE_NO_STORE });
    });
});
