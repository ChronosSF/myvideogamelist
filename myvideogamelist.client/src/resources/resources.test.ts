import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader as robotsLoader } from '@/resources/robotsTxt';
import { loader as indexLoader } from '@/resources/sitemapIndex';
import { loader as fileLoader } from '@/resources/sitemapFile';
import { CACHE_NOT_FOUND, CACHE_PROFILE, CACHE_SITEMAP, PRIVATE_NO_STORE } from '@/lib/cache';
import type { Route as IndexRoute } from './+types/sitemapIndex';
import type { Route as FileRoute } from './+types/sitemapFile';

/** The feeds `SitemapController` serves, by path. Anything not listed answers 500. */
function stubApi(feeds: Record<string, unknown>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        return path in feeds
            ? new Response(JSON.stringify(feeds[path]), { status: 200 })
            : new Response('nope', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const index = () =>
    indexLoader({ request: new Request('https://internal.example/sitemap.xml') } as unknown as IndexRoute.LoaderArgs);

const file = (name: string) =>
    fileLoader({
        request: new Request(`https://internal.example/sitemaps/${name}`),
        params: { file: name },
    } as unknown as FileRoute.LoaderArgs);

function asProduction() {
    vi.stubEnv('SITE_URL', 'https://myvideogamelist.net');
    vi.stubEnv('SITE_INDEXABLE', 'true');
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('/robots.txt', () => {
    it('names the sitemap in production and is not itself marked noindex', async () => {
        asProduction();

        const response = robotsLoader();

        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(response.headers.has('X-Robots-Tag')).toBe(false);
        expect(await response.text()).toContain('Sitemap: https://myvideogamelist.net/sitemap.xml');
    });

    it('carries the noindex header anywhere else, and states a cache policy either way', async () => {
        const response = robotsLoader();

        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
        expect(response.headers.get('Cache-Control')).toContain('s-maxage=');
        expect(await response.text()).not.toContain('Sitemap:');
    });
});

describe('/sitemap.xml', () => {
    it('names every file at the configured origin, never at the address the request arrived on', async () => {
        asProduction();
        stubApi({ '/api/sitemap': { games: 10_001, profiles: 1, pageSize: 10_000 } });

        const response = await index();
        const xml = await response.text();

        expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
        expect(response.headers.get('Cache-Control')).toBe(CACHE_SITEMAP);
        for (const name of ['pages.xml', 'games-1.xml', 'games-2.xml', 'profiles-1.xml']) {
            expect(xml).toContain(`<loc>https://myvideogamelist.net/sitemaps/${name}</loc>`);
        }
        expect(xml).not.toContain('internal.example');
    });

    it('is an uncached error when the API does not answer, not a sitemap with nothing in it', async () => {
        // An empty list is an answer, and the answer would be that the site has no pages.
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

        const response = await index();

        expect(response.status).toBe(502);
        expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE);
    });
});

describe('/sitemaps/:file', () => {
    it('lists the static pages without asking the API for anything', async () => {
        asProduction();
        const fetchMock = stubApi({});

        const xml = await (await file('pages.xml')).text();

        expect(xml).toContain('<loc>https://myvideogamelist.net/</loc>');
        expect(xml).toContain('<loc>https://myvideogamelist.net/games</loc>');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lists a game by the URL its own page gives as canonical', async () => {
        asProduction();
        stubApi({ '/api/sitemap/games?page=2': [7346, 26226] });

        const response = await file('games-2.xml');
        const xml = await response.text();

        expect(response.headers.get('Cache-Control')).toBe(CACHE_SITEMAP);
        expect(xml).toContain('<loc>https://myvideogamelist.net/games/7346</loc>');
        expect(xml).toContain('<loc>https://myvideogamelist.net/games/26226</loc>');
    });

    it('holds a file of profiles no longer than a profile page is held', async () => {
        // A profile switched back to private has to leave this file as soon as it leaves the edge.
        asProduction();
        stubApi({ '/api/sitemap/profiles?page=1': ['AliceInChains'] });

        const response = await file('profiles-1.xml');

        expect(response.headers.get('Cache-Control')).toBe(CACHE_PROFILE);
        expect(await response.text()).toContain('<loc>https://myvideogamelist.net/u/AliceInChains</loc>');
    });

    it('falls back to the request origin on a machine with no SITE_URL', async () => {
        stubApi({ '/api/sitemap/games?page=1': [1] });

        expect(await (await file('games-1.xml')).text()).toContain('<loc>https://internal.example/games/1</loc>');
    });

    it('is a 404 for a name that is no file, and for a file past the last', async () => {
        stubApi({ '/api/sitemap/games?page=9': [] });

        for (const name of ['games-01.xml', 'reviews-1.xml', 'games-9.xml']) {
            const response = await file(name);

            expect(response.status, name).toBe(404);
            expect(response.headers.get('Cache-Control'), name).toBe(CACHE_NOT_FOUND);
        }
    });

    it('is an uncached 502 when the API fails', async () => {
        stubApi({});

        const response = await file('profiles-1.xml');

        expect(response.status).toBe(502);
        expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE);
    });
});
