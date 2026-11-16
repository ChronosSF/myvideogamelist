import { describe, expect, it } from 'vitest';
import { isPublicId, profilePath } from '@/lib/profilePath';

describe('profilePath', () => {
    it('is the id, then the name as its owner wrote it', () => {
        expect(profilePath({ publicId: 'b4kz9q2mxw7c', userName: 'AliceInChains' })).toBe('/u/b4kz9q2mxw7c/AliceInChains');
    });

    it('adds a page of reviews past the first, and nothing for the first', () => {
        expect(profilePath({ publicId: 'b4kz9q2mxw7c', userName: 'alex' }, 3)).toBe('/u/b4kz9q2mxw7c/alex?page=3');
        expect(profilePath({ publicId: 'b4kz9q2mxw7c', userName: 'alex' }, 1)).toBe('/u/b4kz9q2mxw7c/alex');
    });

    it('escapes the name, so that the day the alphabet grows the path still names one page', () => {
        expect(profilePath({ publicId: 'b4kz9q2mxw7c', userName: 'a/b?c' })).toBe('/u/b4kz9q2mxw7c/a%2Fb%3Fc');
    });
});

describe('isPublicId', () => {
    it.each([
        ['b4kz9q2mxw7c', true],
        ['000000000000', true],
        ['b4kz9q2mxw7', false],
        ['b4kz9q2mxw7cc', false],
        ['B4KZ9Q2MXW7C', false],
        ['b4kz9q2mxw7a', false],
        ['b4kz9q2mxw7l', false],
        ['ChronosSF', false],
        ['', false],
    ])('%s is %s', (value, expected) => {
        expect(isPublicId(value)).toBe(expected);
    });
});
