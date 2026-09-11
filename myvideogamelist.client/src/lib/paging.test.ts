import { describe, expect, it } from 'vitest';
import { lastPage, pageFrom, pageSearch } from '@/lib/paging';

describe('pageFrom', () => {
    it('reads no parameter as the first page', () => {
        expect(pageFrom(null)).toBe(1);
    });

    it.each(['1', '2', '20', '999999999'])('reads %s as a page', raw => {
        expect(pageFrom(raw)).toBe(Number(raw));
    });

    it.each(['0', '-1', '1.5', '1e3', '01', ' 2', '2 ', 'abc', '', '1000000000'])(
        'names no page for %j rather than repairing it',
        raw => {
            expect(pageFrom(raw)).toBeNull();
        },
    );
});

describe('lastPage', () => {
    it('is one for an empty set', () => {
        expect(lastPage(0, 20)).toBe(1);
    });

    it('rounds a partial page up', () => {
        expect(lastPage(41, 20)).toBe(3);
    });

    it('adds no page for an exact fit', () => {
        expect(lastPage(40, 20)).toBe(2);
    });

    it('never divides by zero', () => {
        expect(lastPage(5, 0)).toBe(1);
    });
});

describe('pageSearch', () => {
    it('gives the first page no query string, so it has one URL', () => {
        expect(pageSearch(1)).toBe('');
    });

    it('names every other page', () => {
        expect(pageSearch(3)).toBe('?page=3');
    });
});
