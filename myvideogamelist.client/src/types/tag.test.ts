import { describe, expect, it } from 'vitest';
import { gamesCarrying, normaliseTagName, sameTagName, sortTags, tagsFor } from '@/types/tag';
import { tag } from '@/test/factories';

describe('normaliseTagName', () => {
    it('tidies a name the way the server stores it', () => {
        expect(normaliseTagName('  couch \t  co-op  ')).toBe('couch co-op');
        // Composed, so an accent typed as its own mark and the accented letter are one name, as on the server.
        expect(normaliseTagName('cafe\u0301')).toBe('caf\u00e9');
    });
});

describe('sameTagName', () => {
    it('ignores case and stray whitespace, as the server does', () => {
        expect(sameTagName('Co-op', ' co-OP ')).toBe(true);
        expect(sameTagName('co-op', 'couch co-op')).toBe(false);
    });
});

describe('sortTags', () => {
    it('orders by name without regard to case, and numbers by value', () => {
        const sorted = sortTags([
            tag({ id: 1, name: 'short' }),
            tag({ id: 2, name: '10 hours' }),
            tag({ id: 3, name: 'Co-op' }),
            tag({ id: 4, name: '2 hours' }),
        ]);

        expect(sorted.map(t => t.name)).toEqual(['2 hours', '10 hours', 'Co-op', 'short']);
    });

    it('does not reorder what it was given', () => {
        const given = [tag({ id: 1, name: 'b' }), tag({ id: 2, name: 'a' })];

        sortTags(given);

        expect(given.map(t => t.name)).toEqual(['b', 'a']);
    });
});

describe('tagsFor', () => {
    const byId = new Map([
        [1, tag({ id: 1, name: 'short' })],
        [2, tag({ id: 2, name: 'Co-op' })],
    ]);

    it('resolves a row’s ids to its tags, in name order', () => {
        expect(tagsFor([1, 2], byId).map(t => t.name)).toEqual(['Co-op', 'short']);
    });

    it('leaves out an id the account’s tags do not have, rather than drawing a blank chip', () => {
        // A tag deleted since the lists loaded.
        expect(tagsFor([1, 99], byId).map(t => t.name)).toEqual(['short']);
    });
});

describe('gamesCarrying', () => {
    it('says how many games, in the singular for one', () => {
        expect(gamesCarrying(0)).toBe('0 games');
        expect(gamesCarrying(1)).toBe('1 game');
        expect(gamesCarrying(1200)).toBe('1,200 games');
    });
});
