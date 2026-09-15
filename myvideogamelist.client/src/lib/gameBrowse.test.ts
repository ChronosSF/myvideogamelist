import { describe, expect, it } from 'vitest';
import {
    EMPTY_BROWSE,
    browseFrom,
    browseParams,
    gamesApiPath,
    isDefaultBrowse,
    isFiltered,
    yearsFrom,
} from '@/lib/gameBrowse';

const params = (query: string) => new URLSearchParams(query);

describe('browseFrom', () => {
    it('reads every part of a browse from the query string', () => {
        expect(browseFrom(params('search=%20zelda%20&sort=newest&platform=130&genre=12&year=2024&minScore=80')))
            .toEqual({ search: 'zelda', sort: 'newest', platform: 130, genre: 12, year: 2024, minScore: 80 });
    });

    it('is the plain catalogue for an empty query', () => {
        expect(browseFrom(params(''))).toEqual(EMPTY_BROWSE);
    });

    it('drops what the API would refuse, rather than failing the page', () => {
        // A hand-edited or stale link still shows games; the API never sees the bad value.
        expect(browseFrom(params('sort=bogus&platform=abc&genre=-4&year=1900&minScore=101')))
            .toEqual(EMPTY_BROWSE);
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
        const browse = { search: 'hades', sort: 'popular' as const, platform: 6, genre: null, year: 2020, minScore: 90 };

        expect(browseFrom(browseParams(browse))).toEqual(browse);
    });
});

describe('gamesApiPath', () => {
    it('asks the API for the same browse, at an offset', () => {
        expect(gamesApiPath(40, { ...EMPTY_BROWSE, sort: 'name', genre: 12 }))
            .toBe('/api/games?sort=name&genre=12&offset=40');
    });
});

describe('isFiltered and isDefaultBrowse', () => {
    it('does not count the order or a search as a filter', () => {
        expect(isFiltered({ ...EMPTY_BROWSE, sort: 'newest', search: 'x' })).toBe(false);
        expect(isFiltered({ ...EMPTY_BROWSE, year: 2001 })).toBe(true);
    });

    it('counts anything but the plain catalogue as not the default, the order included', () => {
        expect(isDefaultBrowse(EMPTY_BROWSE)).toBe(true);
        expect(isDefaultBrowse({ ...EMPTY_BROWSE, sort: 'popular' })).toBe(false);
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
