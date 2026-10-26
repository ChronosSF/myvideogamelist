import { describe, expect, it } from 'vitest';
import { comingSoonWhen, gameIdIn, scheduleGroups } from '@/lib/comingSoon';
import type { ComingSoonGame } from '@/types/releases';

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

describe('scheduleGroups', () => {
    const game = (gameId: number, precision: ComingSoonGame['precision'], starts: string): ComingSoonGame => ({
        gameId, title: `Game ${gameId}`, coverImageUrl: null, precision, starts, platforms: [],
    });

    it('puts each game under the month it arrives in, in the order they came, naming a later year', () => {
        const groups = scheduleGroups([
            game(1, 'day', '2026-10-29'),
            game(2, 'day', '2026-11-05'),
            game(3, 'month', '2026-11-01'),
            game(4, 'day', '2027-01-15'),
        ], TODAY);

        expect(groups.map(g => [g.label, g.games.map(x => x.gameId)])).toEqual([
            ['October', [1]],
            ['November', [2, 3]],
            ['January 2027', [4]],
        ]);
    });

    it('keeps what is known only to a quarter under the quarter', () => {
        const groups = scheduleGroups([game(1, 'day', '2026-12-03'), game(2, 'quarter', '2027-01-01')], TODAY);

        expect(groups.map(g => g.label)).toEqual(['December', 'Q1 2027']);
    });
});
