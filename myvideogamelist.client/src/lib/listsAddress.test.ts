import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST, listFromAddress, withList } from '@/lib/listsAddress';
import { LIST_IDS } from '@/types/list';

describe('listFromAddress', () => {
    it('reads each of the five lists by its id', () => {
        for (const id of LIST_IDS) {
            expect(listFromAddress(new URLSearchParams({ list: id }))).toBe(id);
        }
    });

    it('opens the default where the address names no list', () => {
        expect(listFromAddress(new URLSearchParams())).toBe(DEFAULT_LIST);
    });

    it('opens the default for a value that is not a list, a renamed list\'s name included', () => {
        // A name is its owner's and can change (ADR 0031), so it is never what an address holds.
        expect(listFromAddress(new URLSearchParams({ list: 'Beaten' }))).toBe(DEFAULT_LIST);
        expect(listFromAddress(new URLSearchParams({ list: 'Finished' }))).toBe(DEFAULT_LIST);
        expect(listFromAddress(new URLSearchParams({ list: '' }))).toBe(DEFAULT_LIST);
    });
});

describe('withList', () => {
    it('names the list in the address', () => {
        expect(withList(new URLSearchParams(), 'on_hold').toString()).toBe('list=on_hold');
    });

    it('gives the default list no parameter, so it has one address', () => {
        expect(withList(new URLSearchParams({ list: 'finished' }), DEFAULT_LIST).toString()).toBe('');
    });

    it('keeps whatever else the address carries, and does not change what it was given', () => {
        const given = new URLSearchParams({ from: 'home', list: 'backlog' });

        expect(withList(given, 'dropped').toString()).toBe('from=home&list=dropped');
        expect(given.toString()).toBe('from=home&list=backlog');
    });
});
