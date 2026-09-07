import { describe, expect, it } from 'vitest';
import { formatDate, formatHours, formatMonth, formatRate, isYearStart, tallyBy } from '@/lib/stats';
import { emptyLists, type ListEntryDto, type ListId } from '@/types/list';
import { entry, platform } from '@/test/factories';

describe('formatHours', () => {
    it('says so rather than inventing minutes for a short session', () => {
        // These are sums of real intervals, and "12 minutes" claims a precision that a status
        // change nudged twice in a row does not have.
        expect(formatHours(0.2)).toBe('under an hour');
    });

    it('reports hours below a day', () => {
        expect(formatHours(1)).toBe('1 hour');
        expect(formatHours(7.4)).toBe('7 hours');
        expect(formatHours(23.6)).toBe('24 hours');
    });

    it('switches to days once there are days of it', () => {
        expect(formatHours(24)).toBe('1 day');
        expect(formatHours(84)).toBe('3.5 days');
    });

    it('drops the decimal once a tenth of a day is noise', () => {
        // Nobody comparing a 40-day game to a 12-day one cares about 2.4 hours of it.
        expect(formatHours(24 * 40 + 3)).toBe('40 days');
    });
});

describe('formatRate', () => {
    it('rounds to a whole percentage', () => {
        expect(formatRate(0.75)).toBe('75%');
        expect(formatRate(0.666)).toBe('67%');
        expect(formatRate(1)).toBe('100%');
    });
});

describe('formatMonth', () => {
    it('names the month the key says, in UTC', () => {
        // Both hazards this avoids are real: `new Date('2026-01')` is UTC midnight and reads as
        // December west of Greenwich, and `toLocaleString({ month: 'short' })` is numeric in some
        // locales — this very assertion first failed with '01' on the machine it was written on.
        expect(formatMonth('2026-01')).toBe('Jan');
        expect(formatMonth('2026-12')).toBe('Dec');
    });

    it('passes an unparseable key through rather than rendering Invalid Date', () => {
        expect(formatMonth('nonsense')).toBe('nonsense');
    });

    it('marks January so an axis can repeat the year there', () => {
        expect(isYearStart('2026-01')).toBe(true);
        expect(isYearStart('2026-11')).toBe(false);
    });
});

describe('tallyBy', () => {
    function lists(entries: Partial<Record<ListId, ListEntryDto[]>>): Record<ListId, ListEntryDto[]> {
        return { ...emptyLists(), ...entries };
    }

    const pc = platform(6, 'PC');
    const switchConsole = platform(130, 'Nintendo Switch');
    const ps5 = platform(167, 'PlayStation 5');

    it('counts across every list, not just one', () => {
        const counted = tallyBy(
            lists({
                playing: [entry({ game: { id: 1, platforms: [pc] } })],
                finished: [entry({ game: { id: 2, platforms: [pc, ps5] } })],
            }),
            game => game.platforms,
        );

        expect(counted).toEqual([
            { id: 6, name: 'PC', count: 2 },
            { id: 167, name: 'PlayStation 5', count: 1 },
        ]);
    });

    it('counts a game once per platform even if it is listed twice', () => {
        const counted = tallyBy(
            lists({ playing: [entry({ game: { id: 1, platforms: [pc, pc] } })] }),
            game => game.platforms,
        );

        expect(counted).toEqual([{ id: 6, name: 'PC', count: 1 }]);
    });

    it('breaks a tie by name, so the order does not depend on which list loaded first', () => {
        const counted = tallyBy(
            lists({
                backlog: [entry({ game: { id: 1, platforms: [ps5] } })],
                playing: [entry({ game: { id: 2, platforms: [switchConsole] } })],
            }),
            game => game.platforms,
        );

        expect(counted.map(t => t.name)).toEqual(['Nintendo Switch', 'PlayStation 5']);
    });

    it('keeps only the top few, since this is a ranking and not an inventory', () => {
        const many = Array.from({ length: 9 }, (_, i) =>
            entry({ game: { id: i + 1, platforms: [platform(i + 1, `Platform ${i + 1}`)] } }));

        expect(tallyBy(lists({ playing: many }), game => game.platforms, 3)).toHaveLength(3);
    });

    it('returns nothing for lists whose games carry no platforms at all', () => {
        expect(tallyBy(lists({ playing: [entry({ game: { id: 1 } })] }), game => game.platforms))
            .toEqual([]);
    });

    it('reads genres through the same function', () => {
        const counted = tallyBy(
            lists({ playing: [entry({ game: { id: 1, genres: [{ id: 31, name: 'Adventure', description: null }] } })] }),
            game => game.genres,
        );

        expect(counted).toEqual([{ id: 31, name: 'Adventure', count: 1 }]);
    });
});

describe('formatDate', () => {
    it('reads as prose and in UTC, rather than in the browser locale', () => {
        // The month names are ours for the same reason the axis labels are: consistency with the
        // English copy around them, and a test that does not depend on the machine's locale.
        expect(formatDate('2026-08-25T14:16:17Z')).toBe('25 August 2026');
    });

    it('passes an unparseable value through', () => {
        expect(formatDate('not a date')).toBe('not a date');
    });
});
