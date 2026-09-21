import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { headers, loader } from '@/pages/HomePage';
import { CACHE_HOME, PRIVATE_NO_STORE } from '@/lib/cache';
import { game } from '@/test/factories';
import type { HomeResponse, NewsItemDto } from '@/types/news';
import type { Route } from './+types/HomePage';

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

const NEWS: NewsItemDto = {
    id: 'gid-1',
    gameId: 1,
    gameTitle: 'Hades',
    gameCoverUrl: null,
    title: 'Patch 1.1',
    url: 'https://example.test/1',
    source: 'Steam',
    excerpt: null,
    publishedAt: '2026-09-01T12:00:00+00:00',
};

/** What is left of the page when the API gave the loader nothing to build it from. */
const NOTHING: HomeResponse = { spotlight: null, popular: [], news: [], degraded: true };

/** `/api/home` answering with `body` — a 200 unless told otherwise, which is what it sends even with IGDB down. */
function stubHome(body: unknown, status = 200) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

/** The policy a loader attached through `data()`. */
const policyOf = (result: Awaited<ReturnType<typeof loader>>) =>
    new Headers(result.init?.headers).get('Cache-Control');

beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE.siteUrl);
    vi.stubEnv('SITE_INDEXABLE', 'true');
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('HomePage loader', () => {
    it('shares an answer the API says is whole', async () => {
        const home: HomeResponse = { spotlight: null, popular: [game()], news: [NEWS], degraded: false };
        stubHome(home);

        const result = await loader();

        expect(policyOf(result)).toBe(CACHE_HOME);
        expect(result.data).toEqual({ ...home, site: SITE });
    });

    it('does not let a degraded 200 be cached', async () => {
        // IGDB down with the API up. The status is a 200 and the body is a well-formed payload, so
        // nothing but the flag separates this from a healthy answer — and read as one, an empty
        // home page was pinned at the edge for five minutes and served stale for ten more.
        stubHome({ spotlight: null, popular: [], news: [], degraded: true });

        const result = await loader();

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
    });

    it('still renders what a degraded answer has, with the site beside it', async () => {
        // The news failed and the covers did not. The page shows the covers; it is just not kept.
        // `meta` reads `site` whichever way the loader went, so it rides along here too.
        const home: HomeResponse = { spotlight: null, popular: [game()], news: [], degraded: true };
        stubHome(home);

        const result = await loader();

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data).toEqual({ ...home, site: SITE });
    });

    it('fails closed on an answer that does not say, however whole it looks', async () => {
        // An API older than this build, in the middle of a deploy. Both rails are full, which is
        // exactly why this is not judged from the rails.
        stubHome({ spotlight: null, popular: [game()], news: [NEWS] });

        const result = await loader();

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data.popular).toHaveLength(1);
    });

    it('degrades, uncached, when the API answers with an error', async () => {
        stubHome({ title: 'Bad Gateway', status: 502 }, 502);

        const result = await loader();

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data).toEqual({ ...NOTHING, site: SITE });
    });

    it('degrades, uncached, when the API cannot be reached', async () => {
        // fetch rejects rather than returning !ok, and a rejection here must not become a 500.
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

        const result = await loader();

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data).toEqual({ ...NOTHING, site: SITE });
    });
});

describe('HomePage headers', () => {
    const policyFor = (loaderHeaders: Headers) =>
        headers({ loaderHeaders } as unknown as Route.HeadersArgs)['Cache-Control'];

    it("sends the loader's policy, whichever it chose", () => {
        expect(policyFor(new Headers({ 'Cache-Control': CACHE_HOME }))).toBe(CACHE_HOME);
        expect(policyFor(new Headers({ 'Cache-Control': PRIVATE_NO_STORE }))).toBe(PRIVATE_NO_STORE);
    });

    it('fails closed when the loader stated none', () => {
        // The shared policy is for an answer somebody judged to be whole, and nobody has here.
        expect(policyFor(new Headers())).toBe(PRIVATE_NO_STORE);
    });
});
