import { describe, expect, it } from 'vitest';
import { escapeXml, sitemapFileFrom, sitemapFileNames, sitemapIndex, urlSet } from '@/lib/sitemap';

describe('urlSet', () => {
    it('writes one loc per URL and nothing else about it', () => {
        const xml = urlSet(['https://myvideogamelist.net/games/1', 'https://myvideogamelist.net/games/2']);

        expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        expect(xml).toContain('<url><loc>https://myvideogamelist.net/games/1</loc></url>');
        expect(xml).toContain('<url><loc>https://myvideogamelist.net/games/2</loc></url>');

        // A date that is sometimes wrong teaches a crawler to ignore all of them, and the other two
        // are ignored already.
        expect(xml).not.toMatch(/lastmod|changefreq|priority/);
    });

    it('escapes what XML reserves', () => {
        expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
        expect(urlSet(['https://myvideogamelist.net/games?a=1&b=2'])).toContain('a=1&amp;b=2');
    });
});

describe('sitemapIndex', () => {
    it('names files, not pages', () => {
        const xml = sitemapIndex(['https://myvideogamelist.net/sitemaps/pages.xml']);

        expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        expect(xml).toContain('<sitemap><loc>https://myvideogamelist.net/sitemaps/pages.xml</loc></sitemap>');
    });
});

describe('sitemapFileFrom', () => {
    it('reads the three kinds of file', () => {
        expect(sitemapFileFrom('pages.xml')).toEqual({ kind: 'pages' });
        expect(sitemapFileFrom('games-1.xml')).toEqual({ kind: 'games', page: 1 });
        expect(sitemapFileFrom('profiles-12.xml')).toEqual({ kind: 'profiles', page: 12 });
    });

    it('names no file for anything that would have to be repaired to mean one', () => {
        const junk = [
            undefined, '', 'games.xml', 'games-0.xml', 'games-01.xml', 'games--1.xml', 'games-1', 'games-1.xml.gz',
            'games-1e3.xml', 'reviews-1.xml', 'GAMES-1.xml', 'pages-1.xml', 'games-1234567890.xml',
        ];

        for (const name of junk) expect(sitemapFileFrom(name), String(name)).toBeNull();
    });
});

describe('sitemapFileNames', () => {
    it('always lists the static pages, and nothing of a kind there is none of', () => {
        // An empty urlset is not valid against the protocol's schema.
        expect(sitemapFileNames({ games: 0, profiles: 0, pageSize: 10_000 })).toEqual(['pages.xml']);
    });

    it('cuts each kind into as many files as it fills', () => {
        expect(sitemapFileNames({ games: 10_001, profiles: 10_000, pageSize: 10_000 }))
            .toEqual(['pages.xml', 'games-1.xml', 'games-2.xml', 'profiles-1.xml']);
    });

    it('lists no numbered files for a page size it cannot divide by', () => {
        expect(sitemapFileNames({ games: 5, profiles: 5, pageSize: 0 })).toEqual(['pages.xml']);
    });
});
