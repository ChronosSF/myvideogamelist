import { describe, expect, it } from 'vitest';
import {
    EMPTY_BROWSE,
    ESRB_RATINGS,
    browseFrom,
    browseParams,
    gamesApiPath,
    isFiltered,
    yearsFrom,
} from '@/lib/gameBrowse';

const params = (query: string) => new URLSearchParams(query);

describe('browseFrom', () => {
    it('reads every part of a browse from the query string', () => {
        expect(browseFrom(params('search=%20zelda%20&sort=newest&platform=130&genre=12&year=2024&minScore=80&esrb=m')))
            .toEqual({ search: 'zelda', sort: 'newest', platform: 130, genre: 12, year: 2024, minScore: 80, esrb: 'm' });
    });

    it('offers exactly the ESRB keys the API accepts', () => {
        // The server's EsrbRatingKeys, spelled out: a key offered here that the API refuses turns the
        // whole page into a 502, and one it accepts that is missing here cannot be chosen.
        expect(ESRB_RATINGS.map(rating => rating.key)).toEqual(['ec', 'e', 'e10', 't', 'm', 'ao']);
        for (const { key } of ESRB_RATINGS) expect(browseFrom(params(`esrb=${key}`)).esrb).toBe(key);
    });

    it('reads anything but a key as no ESRB rating', () => {
        // Rating Pending is not offered, the badge's own codes are not keys, and nor is IGDB's id: the
        // API answers each with a 400. An empty value it reads as no rating, as this does.
        for (const esrb of ['rp', 'M', 'E10%2B', '6', 'bogus', '']) {
            expect(browseFrom(params(`esrb=${esrb}`)).esrb).toBeNull();
        }
    });

    it('is the plain catalogue for an empty query', () => {
        expect(browseFrom(params(''))).toEqual(EMPTY_BROWSE);
    });

    it('drops what the API would refuse, rather than failing the page', () => {
        // A hand-edited or stale link still shows games; the API never sees the bad value.
        expect(browseFrom(params('sort=bogus&platform=abc&genre=-4&year=1900&minScore=101')))
            .toEqual(EMPTY_BROWSE);
    });

    it('drops an id too large for the API to bind, which it answers with a 400', () => {
        // The filters are 32-bit ints on the server. One digit over, and the request is refused
        // whole — which the loader renders as a 502 page rather than as a listing.
        expect(browseFrom(params('platform=2147483648')).platform).toBeNull();
        expect(browseFrom(params('genre=9007199254740991')).genre).toBeNull();
        expect(browseFrom(params('platform=2147483647')).platform).toBe(2147483647);
    });

    it('refuses what only looks like a number', () => {
        expect(browseFrom(params('platform=6.5&genre=1e3&year=2024abc')).platform).toBeNull();
        expect(browseFrom(params('genre=1e3')).genre).toBeNull();
        expect(browseFrom(params('year=2024abc')).year).toBeNull();
    });
});

describe('browseParams', () => {
    it('leaves every default out, so the plain catalogue has one URL', () => {
        expect(browseParams(EMPTY_BROWSE).toString()).toBe('');
        expect(browseParams({ ...EMPTY_BROWSE, sort: 'rating' }).toString()).toBe('');
    });

    it('round-trips through browseFrom', () => {
        const browse = {
            search: 'hades', sort: 'popular' as const, platform: 6, genre: null, year: 2020, minScore: 90, esrb: 't' as const,
        };

        expect(browseFrom(browseParams(browse))).toEqual(browse);
    });

    it('puts the ESRB rating in the URL as its key, after the other filters', () => {
        expect(browseParams({ ...EMPTY_BROWSE, platform: 130, esrb: 'e10' }).toString()).toBe('platform=130&esrb=e10');
        expect(browseParams({ ...EMPTY_BROWSE, esrb: null }).toString()).toBe('');
    });
});

describe('gamesApiPath', () => {
    it('asks the API for the same browse, at an offset', () => {
        expect(gamesApiPath(40, { ...EMPTY_BROWSE, sort: 'name', genre: 12 }))
            .toBe('/api/games?sort=name&genre=12&offset=40');
    });
});

describe('isFiltered', () => {
    it('does not count the order or a search as a filter', () => {
        expect(isFiltered({ ...EMPTY_BROWSE, sort: 'newest', search: 'x' })).toBe(false);
        expect(isFiltered({ ...EMPTY_BROWSE, year: 2001 })).toBe(true);
    });

    it('counts an ESRB rating as a filter', () => {
        expect(isFiltered({ ...EMPTY_BROWSE, esrb: 'ao' })).toBe(true);
    });
});

describe('yearsFrom', () => {
    it('offers this year back to the seventies, newest first, and not next year', () => {
        const years = yearsFrom(2026);

        expect(years[0]).toBe(2026);
        expect(years.at(-1)).toBe(1970);
        expect(years).not.toContain(2027);
    });
});
