import { describe, expect, it, vi } from 'vitest';
import {
    type SiteConfig,
    applyIndexingHeaders,
    pageMeta,
    resourceResponse,
    robotsTxt,
    siteConfig,
} from '@/lib/seo';

const PRODUCTION: SiteConfig = { siteUrl: 'https://myvideogamelist.net', indexable: true };
const STAGING: SiteConfig = { siteUrl: 'https://dev.myvideogamelist.net', indexable: false };
const UNCONFIGURED: SiteConfig = { siteUrl: null, indexable: false };

describe('siteConfig', () => {
    it('is not indexable until it is told to be', () => {
        // The direction that matters: a deployment nobody configured must not be the one that gets
        // indexed, because that deployment is staging.
        expect(siteConfig({})).toEqual(UNCONFIGURED);
        expect(siteConfig({ SITE_URL: 'https://dev.myvideogamelist.net' })).toEqual(STAGING);
    });

    it('is indexable only with both variables, and only on exactly "true"', () => {
        const SITE_URL = 'https://myvideogamelist.net';

        expect(siteConfig({ SITE_URL, SITE_INDEXABLE: 'true' })).toEqual(PRODUCTION);

        for (const SITE_INDEXABLE of ['True', '1', 'yes', ' true', '']) {
            expect(siteConfig({ SITE_URL, SITE_INDEXABLE }).indexable, SITE_INDEXABLE).toBe(false);
        }
    });

    it('keeps the origin and drops whatever else the URL carried', () => {
        // A trailing slash here would put a double one in every canonical URL on the site.
        expect(siteConfig({ SITE_URL: 'https://myvideogamelist.net/' }).siteUrl).toBe('https://myvideogamelist.net');
        expect(siteConfig({ SITE_URL: 'https://myvideogamelist.net/games?x=1' }).siteUrl)
            .toBe('https://myvideogamelist.net');
    });

    it('stays unindexed, and says why, when asked to be indexed at no address', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(siteConfig({ SITE_INDEXABLE: 'true' })).toEqual(UNCONFIGURED);
        expect(siteConfig({ SITE_INDEXABLE: 'true', SITE_URL: 'not a url' })).toEqual(UNCONFIGURED);
        expect(siteConfig({ SITE_INDEXABLE: 'true', SITE_URL: 'ftp://myvideogamelist.net' })).toEqual(UNCONFIGURED);

        // Once, not once per request.
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('applyIndexingHeaders', () => {
    it('says noindex on everything a deployment that is not for indexing serves', () => {
        expect(applyIndexingHeaders(new Headers(), STAGING).get('X-Robots-Tag')).toBe('noindex, nofollow');
        expect(applyIndexingHeaders(new Headers(), UNCONFIGURED).get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('says nothing in production, where each page decides for itself', () => {
        expect(applyIndexingHeaders(new Headers(), PRODUCTION).has('X-Robots-Tag')).toBe(false);
    });
});

describe('robotsTxt', () => {
    it('names the sitemap at the public origin in production', () => {
        expect(robotsTxt(PRODUCTION)).toContain('Sitemap: https://myvideogamelist.net/sitemap.xml');
    });

    it('disallows nothing, in either kind of deployment', () => {
        // A disallowed page is never requested, so its `noindex` is never seen — and a disallowed
        // `/api/` would hide what a page fetches from the crawler rendering it. An empty
        // `Disallow:` is the spelling of "everything is allowed" every parser understands.
        for (const site of [PRODUCTION, STAGING, UNCONFIGURED]) {
            const rules = robotsTxt(site).split('\n').filter(line => line.startsWith('Disallow'));
            expect(rules).toEqual(['Disallow:']);
        }
    });

    it('advertises no sitemap from a deployment that is not for indexing', () => {
        expect(robotsTxt(STAGING)).not.toContain('Sitemap:');
    });
});

describe('resourceResponse', () => {
    it('carries what entry.server.tsx would have added, since it never passes through there', () => {
        const response = resourceResponse('body', 'text/plain; charset=utf-8', 'private, no-store');

        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        // The test environment configures nothing, so this is a deployment not for indexing.
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });
});

describe('pageMeta', () => {
    const page = { title: 'Celeste (2018) - MyVideoGameList', description: 'A game about a mountain.' };

    it('gives the canonical URL and og:url from the configured origin', () => {
        const tags = pageMeta({ ...page, site: PRODUCTION, path: '/games/26226' });

        expect(tags).toContainEqual({ tagName: 'link', rel: 'canonical', href: 'https://myvideogamelist.net/games/26226' });
        expect(tags).toContainEqual({ property: 'og:url', content: 'https://myvideogamelist.net/games/26226' });
    });

    it('gives neither when there is no origin to build them from', () => {
        // A relative canonical URL is resolved against whatever address the page was reached at,
        // which is the thing a canonical URL exists to overrule.
        const tags = pageMeta({ ...page, site: UNCONFIGURED, path: '/games/26226' });

        expect(tags.some(tag => 'rel' in tag || ('property' in tag && tag.property === 'og:url'))).toBe(false);
    });

    it('still gives them on staging, so an unfurl can be tried there before launch', () => {
        const tags = pageMeta({ ...page, site: STAGING, path: '/' });

        expect(tags).toContainEqual({ tagName: 'link', rel: 'canonical', href: 'https://dev.myvideogamelist.net/' });
    });

    it('asks for the large card only for an image that survives its crop', () => {
        const card = (wide: boolean) => pageMeta({
            ...page, site: PRODUCTION, image: { url: 'https://images.example/a.jpg', alt: 'Celeste', wide },
        }).find(tag => 'name' in tag && tag.name === 'twitter:card');

        expect(card(true)).toEqual({ name: 'twitter:card', content: 'summary_large_image' });
        expect(card(false)).toEqual({ name: 'twitter:card', content: 'summary' });
    });

    it('uses a type Open Graph defines', () => {
        // `video.game` shipped here once. It is not in the list at https://ogp.me/#types.
        expect(pageMeta({ ...page, site: PRODUCTION })).toContainEqual({ property: 'og:type', content: 'website' });
        expect(pageMeta({ ...page, site: PRODUCTION, type: 'profile' }))
            .toContainEqual({ property: 'og:type', content: 'profile' });
    });
});
