import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, SORT_OPTIONS, sortEntries, sortOption, type SortKey } from '@/lib/listSort';
import { entry } from '@/test/factories';

/** Titles in the order the comparator produced them, which is what every assertion here checks. */
function order(entries: ReturnType<typeof entry>[], key: SortKey, descending: boolean): string[] {
    return sortEntries(entries, { key, descending }).map(e => e.game.title);
}

describe('sortEntries', () => {
    it('leaves the input array untouched', () => {
        const entries = [entry({ game: { title: 'B' } }), entry({ game: { title: 'A' } })];

        sortEntries(entries, { key: 'title', descending: false });

        expect(entries.map(e => e.game.title)).toEqual(['B', 'A']);
    });

    describe('by title', () => {
        it('sorts case-insensitively', () => {
            const entries = [
                entry({ game: { title: 'banjo' } }),
                entry({ game: { title: 'Apex' } }),
                entry({ game: { title: 'Celeste' } }),
            ];

            expect(order(entries, 'title', false)).toEqual(['Apex', 'banjo', 'Celeste']);
        });

        it('orders embedded numbers naturally rather than lexically', () => {
            // Lexical ordering would put "Portal 10" before "Portal 2".
            const entries = [
                entry({ game: { title: 'Portal 10' } }),
                entry({ game: { title: 'Portal 2' } }),
            ];

            expect(order(entries, 'title', false)).toEqual(['Portal 2', 'Portal 10']);
        });
    });

    describe('by score', () => {
        it('puts the highest first when descending', () => {
            const entries = [
                entry({ score: 6, game: { title: 'Six' } }),
                entry({ score: 10, game: { title: 'Ten' } }),
                entry({ score: 8, game: { title: 'Eight' } }),
            ];

            expect(order(entries, 'score', true)).toEqual(['Ten', 'Eight', 'Six']);
        });

        it('breaks ties on title, so equal scores do not reshuffle between renders', () => {
            const entries = [
                entry({ score: 9, game: { title: 'Zelda' } }),
                entry({ score: 9, game: { title: 'Alan Wake' } }),
                entry({ score: 9, game: { title: 'Metroid' } }),
            ];

            expect(order(entries, 'score', true)).toEqual(['Alan Wake', 'Metroid', 'Zelda']);
        });
    });

    describe('entries with no value', () => {
        // The rule that is easiest to get wrong: "no score" is not a low score, so flipping to
        // ascending must not promote every unscored game to the top of the list.
        it('sorts last when descending', () => {
            const entries = [
                entry({ score: null, game: { title: 'Unscored' } }),
                entry({ score: 4, game: { title: 'Low' } }),
                entry({ score: 9, game: { title: 'High' } }),
            ];

            expect(order(entries, 'score', true)).toEqual(['High', 'Low', 'Unscored']);
        });

        it('still sorts last when ascending', () => {
            const entries = [
                entry({ score: null, game: { title: 'Unscored' } }),
                entry({ score: 4, game: { title: 'Low' } }),
                entry({ score: 9, game: { title: 'High' } }),
            ];

            expect(order(entries, 'score', false)).toEqual(['Low', 'High', 'Unscored']);
        });

        it('orders the valueless group among itself by title', () => {
            const entries = [
                entry({ score: null, game: { title: 'Yakuza' } }),
                entry({ score: null, game: { title: 'Bastion' } }),
            ];

            expect(order(entries, 'score', true)).toEqual(['Bastion', 'Yakuza']);
        });

        it('applies to every nullable key, not just score', () => {
            const entries = [
                entry({ statusChangedAt: null, game: { title: 'NeverMoved' } }),
                entry({ statusChangedAt: '2026-05-01T00:00:00+00:00', game: { title: 'Moved' } }),
            ];

            expect(order(entries, 'status_changed', true)).toEqual(['Moved', 'NeverMoved']);
            expect(order(entries, 'status_changed', false)).toEqual(['Moved', 'NeverMoved']);
        });

        it('treats a missing release date as valueless rather than as year zero', () => {
            const entries = [
                entry({ game: { title: 'Unannounced', releaseDate: null } }),
                entry({ game: { title: 'Old', releaseDate: '1998-11-23' } }),
            ];

            expect(order(entries, 'release_date', false)).toEqual(['Old', 'Unannounced']);
        });
    });

    describe('by date', () => {
        it('puts the most recently added first when descending', () => {
            const entries = [
                entry({ addedAt: '2026-01-01T00:00:00+00:00', game: { title: 'Oldest' } }),
                entry({ addedAt: '2026-06-01T00:00:00+00:00', game: { title: 'Newest' } }),
                entry({ addedAt: '2026-03-01T00:00:00+00:00', game: { title: 'Middle' } }),
            ];

            expect(order(entries, 'added', true)).toEqual(['Newest', 'Middle', 'Oldest']);
        });

        it('compares instants rather than strings, across offsets', () => {
            // Same moment, written two ways. A string comparison would order these arbitrarily.
            const entries = [
                entry({ addedAt: '2026-01-01T12:00:00+00:00', game: { title: 'Utc' } }),
                entry({ addedAt: '2026-01-01T09:00:00-03:00', game: { title: 'Offset' } }),
            ];

            // Equal instants fall through to the title tie-break.
            expect(order(entries, 'added', true)).toEqual(['Offset', 'Utc']);
        });
    });

    describe('by the IGDB-sourced keys', () => {
        it('sorts on the blended rating', () => {
            const entries = [
                entry({ game: { title: 'Good', rating: 8.1 } }),
                entry({ game: { title: 'Great', rating: 9.4 } }),
            ];

            expect(order(entries, 'rating', true)).toEqual(['Great', 'Good']);
        });

        it('sorts on the critic score independently of the rating', () => {
            const entries = [
                entry({ game: { title: 'CriticsLove', rating: 7.0, criticScore: 95 } }),
                entry({ game: { title: 'UsersLove', rating: 9.5, criticScore: 70 } }),
            ];

            expect(order(entries, 'critic_score', true)).toEqual(['CriticsLove', 'UsersLove']);
        });
    });

    it('handles an empty list', () => {
        expect(sortEntries([], DEFAULT_SORT)).toEqual([]);
    });
});

describe('the sort catalogue', () => {
    it('defaults to newest added first', () => {
        expect(DEFAULT_SORT).toEqual({ key: 'added', descending: true });
    });

    it('has a default direction and both labels for every option', () => {
        for (const option of SORT_OPTIONS) {
            expect(option.label, `label for ${option.key}`).toBeTruthy();
            expect(option.columnLabel, `columnLabel for ${option.key}`).toBeTruthy();
            expect(typeof option.defaultDescending).toBe('boolean');
        }
    });

    it('reads "best first" as descending everywhere except title', () => {
        // A-Z is what people expect from a title column; every other key leads with the best.
        for (const option of SORT_OPTIONS) {
            expect(option.defaultDescending, option.key).toBe(option.key !== 'title');
        }
    });

    it('falls back to the first option for an unrecognised key', () => {
        // Keys are persisted server-side, so a stale or hand-edited preference must not crash.
        expect(sortOption('nonsense' as SortKey)).toBe(SORT_OPTIONS[0]);
    });
});
