import { describe, expect, it } from 'vitest';
import { releasingSoon } from '@/lib/releasingSoon';
import { game, platform } from '@/test/factories';
import type { GameDto } from '@/types/game';

const PC = platform(6, 'PC (Microsoft Windows)', 'PC');
const SWITCH = platform(130, 'Nintendo Switch', 'Switch');
const PS5 = platform(167, 'PlayStation 5', 'PS5');

/** One row of the upcoming endpoint: a game on one date, with only the platforms releasing then. */
function release(id: number, releaseDate: string, platforms = [PC], title = `Game ${id}`): GameDto {
    return game({ id, title, releaseDate, platforms });
}

const none = new Set<number>();

describe('releasingSoon', () => {
    it('keeps only games on the wishlist or in the backlog', () => {
        const items = releasingSoon(
            [release(1, '2026-09-20'), release(2, '2026-09-21'), release(3, '2026-09-22')],
            new Set([1]),
            new Set([3]),
            none,
        );

        expect(items.map(item => item.game.id)).toEqual([1, 3]);
        expect(items[0]).toMatchObject({ onWishlist: true, inBacklog: false });
        expect(items[1]).toMatchObject({ onWishlist: false, inBacklog: true });
    });

    it('says when a game is both', () => {
        const [item] = releasingSoon([release(1, '2026-09-20')], new Set([1]), new Set([1]), none);

        expect(item).toMatchObject({ onWishlist: true, inBacklog: true });
    });

    it('names a game once, at its soonest release', () => {
        // The endpoint returns a game once per date: out on PC this week, on Switch next month.
        const items = releasingSoon(
            [release(1, '2026-10-10', [SWITCH]), release(1, '2026-09-20', [PC])],
            new Set([1]),
            none,
            none,
        );

        expect(items).toHaveLength(1);
        expect(items[0].releaseDate).toBe('2026-09-20');
        expect(items[0].platforms).toEqual([PC]);
    });

    it('passes over a release only on hidden platforms, for a later one the user can see', () => {
        // Somebody who hid Switch is not waiting for the Switch release. Filtering before choosing
        // the soonest is what lets the PC release a week later still be the one shown.
        const items = releasingSoon(
            [release(1, '2026-09-20', [SWITCH]), release(1, '2026-09-27', [PC])],
            new Set([1]),
            none,
            new Set([SWITCH.id]),
        );

        expect(items.map(item => item.releaseDate)).toEqual(['2026-09-27']);
    });

    it('leaves nothing when every release is on a hidden platform', () => {
        const items = releasingSoon([release(1, '2026-09-20', [SWITCH])], new Set([1]), none, new Set([SWITCH.id]));

        expect(items).toEqual([]);
    });

    it('names only the releasing platforms the user has not hidden', () => {
        const [item] = releasingSoon([release(1, '2026-09-20', [PC, PS5])], new Set([1]), none, new Set([PS5.id]));

        expect(item.platforms).toEqual([PC]);
    });

    it('keeps a release that names no platform', () => {
        // The calendar's rule: IGDB not saying where is not the same as somewhere the user hid.
        const items = releasingSoon([release(1, '2026-09-20', [])], new Set([1]), none, new Set([PC.id]));

        expect(items).toHaveLength(1);
    });

    it('orders by date, then title, whatever order the response was in', () => {
        const items = releasingSoon(
            [
                release(1, '2026-09-22', [PC], 'Zeta'),
                release(2, '2026-09-20', [PC], 'Beta'),
                release(3, '2026-09-20', [PC], 'Alpha'),
            ],
            new Set([1, 2, 3]),
            none,
            none,
        );

        expect(items.map(item => item.game.title)).toEqual(['Alpha', 'Beta', 'Zeta']);
    });

    it('ignores a row with no date', () => {
        const items = releasingSoon([game({ id: 1, releaseDate: null })], new Set([1]), none, none);

        expect(items).toEqual([]);
    });
});
