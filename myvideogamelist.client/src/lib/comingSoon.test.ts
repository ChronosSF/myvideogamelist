import { describe, expect, it } from 'vitest';
import { comingSoonWhen, gameIdIn } from '@/lib/comingSoon';

const TODAY = '2026-10-25';

describe('comingSoonWhen', () => {
    it('says a day this year as the month and the day', () => {
        expect(comingSoonWhen({ precision: 'day', starts: '2026-11-19' }, TODAY)).toBe('Nov 19');
    });

    it('adds the year to a day in another one', () => {
        expect(comingSoonWhen({ precision: 'day', starts: '2027-01-15' }, TODAY)).toBe('Jan 15, 2027');
    });

    it('says a month by its name, with the year only when it is not this one', () => {
        expect(comingSoonWhen({ precision: 'month', starts: '2026-12-01' }, TODAY)).toBe('December');
        expect(comingSoonWhen({ precision: 'month', starts: '2027-01-01' }, TODAY)).toBe('January 2027');
    });

    it('says a quarter with its year always', () => {
        expect(comingSoonWhen({ precision: 'quarter', starts: '2026-10-01' }, TODAY)).toBe('Q4 2026');
        expect(comingSoonWhen({ precision: 'quarter', starts: '2027-01-01' }, TODAY)).toBe('Q1 2027');
    });
});

describe('gameIdIn', () => {
    it("reads an id, or the id at the end of a game page's address", () => {
        expect(gameIdIn('52189')).toBe(52189);
        expect(gameIdIn(' 52189 ')).toBe(52189);
        expect(gameIdIn('https://myvideogamelist.net/games/52189')).toBe(52189);
        expect(gameIdIn('/games/52189/')).toBe(52189);
    });

    it('reads nothing from anything else', () => {
        expect(gameIdIn('Grand Theft Auto VI')).toBeNull();
        expect(gameIdIn('https://myvideogamelist.net/u/alice')).toBeNull();
        expect(gameIdIn('0')).toBeNull();
        expect(gameIdIn('99999999999999999999')).toBeNull();
        expect(gameIdIn('')).toBeNull();
    });
});
