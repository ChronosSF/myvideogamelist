import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HomePage, headers, loader } from '@/pages/HomePage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { CACHE_HOME, PRIVATE_NO_STORE } from '@/lib/cache';
import { game } from '@/test/factories';
import type { HomeResponse, NewsItemDto } from '@/types/news';
import type { Route } from './+types/HomePage';

/**
 * A visitor nobody has signed in as, once `/api/auth/me` has said so. One module-level object handed
 * back on every call, never a fresh literal — a new object per render re-runs any effect depending on
 * it, which ends in a heap crash rather than an assertion failure.
 */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

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

        // Recorded as degraded, not merely treated as it. The flag is typed a boolean, so passing
        // the payload on as it arrived would hand the page an undefined under that name and leave
        // anything reading it later to repeat the rule the header was chosen by.
        expect(result.data.degraded).toBe(true);
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

describe('HomePage for a signed-out visitor', () => {
    it('asks the API for nothing from the browser', () => {
        // Everything a visitor sees arrives through the loader, cached once for everybody. The
        // upcoming releases are asked for by the Releasing soon rail, which only a signed-in user
        // sees — fetched at the page, they were requested for every visitor and shown to none.
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            throw new Error(`unexpected fetch: ${String(input)}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const home: HomeResponse = { spotlight: null, popular: [game()], news: [NEWS], degraded: false };
        const props = { loaderData: { ...home, site: SITE } } as unknown as Route.ComponentProps;

        render(<MemoryRouter><HomePage {...props} /></MemoryRouter>);

        expect(screen.getByRole('heading', { name: 'Trending right now' })).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
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
