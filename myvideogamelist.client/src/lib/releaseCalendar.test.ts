import { describe, expect, it } from 'vitest';
import { daysBetween } from '@/lib/daySpan';
import {
    CALENDAR_MONTHS,
    addMonths,
    calendarMonths,
    calendarWindow,
    layoutMonth,
    monthBands,
    monthTotals,
    undatedBands,
} from '@/lib/releaseCalendar';
import { calendarEvents, connectedRelease, releaseEntry } from '@/test/factories';
import type { CalendarCuratedEvent, ReleaseEntry, ReleaseKind, ReleasePrecision, ReleaseRelation, UndatedEntry } from '@/types/releases';

function sale(startsOn: string, endsOn: string, id = 1): CalendarCuratedEvent {
    return {
        id,
        kind: 'sale',
        store: 'steam',
        name: `Sale ${id}`,
        startsOn,
        endsOn,
        url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
    };
}

function entry(precision: ReleasePrecision, starts: string, gameId = 1): ReleaseEntry {
    return { ...releaseEntry(starts, [connectedRelease({ gameId })]), precision };
}

describe('the months', () => {
    it('are the month today is in and the twelve after it', () => {
        const months = calendarMonths('2026-10-08');

        expect(months).toHaveLength(CALENDAR_MONTHS);
        expect(months[0]).toBe('2026-10');
        expect(months[3]).toBe('2027-01');
        expect(months.at(-1)).toBe('2027-10');
    });

    it('step across a year either way', () => {
        expect(addMonths('2026-12', 1)).toBe('2027-01');
        expect(addMonths('2027-01', -1)).toBe('2026-12');
        expect(addMonths('2026-10', 13)).toBe('2027-11');
    });

    it('are asked about from the first of the month to the first after the last, which the API takes', () => {
        expect(calendarWindow('2026-10-08')).toEqual({ from: '2026-10-01', to: '2027-11-01' });

        // The longest a window can be is a December followed by a leap year: still inside the API's 400 days.
        for (const month of calendarMonths('2027-01-15')) {
            const { from, to } = calendarWindow(`${month}-15`);
            expect(daysBetween(from, to)).toBeLessThanOrEqual(400);
        }
    });
});

describe('layoutMonth, the days', () => {
    it('starts the grid on the Monday of the first week, filling it with the month before', () => {
        // 1 October 2026 is a Thursday.
        const layout = layoutMonth('2026-10', [], null);

        expect(layout.days).toHaveLength(31);
        expect(layout.days[0]).toMatchObject({ day: '2026-10-01', week: 0, column: 4 });
        expect(layout.days[7]).toMatchObject({ day: '2026-10-08', week: 1, column: 4 });
        expect(layout.weeks).toHaveLength(5);
        expect(layout.pads.map(p => p.day)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-11-01']);
    });

    it('needs no padding for a month that starts on a Monday and is four weeks long', () => {
        const layout = layoutMonth('2027-02', [], null);

        expect(layout.weeks).toHaveLength(4);
        expect(layout.pads).toEqual([]);
    });

    it('puts a release known to the day in its day, and nothing known only to a period', () => {
        const layout = layoutMonth('2026-10', [
            entry('day', '2026-10-16'),
            entry('month', '2026-10-01', 2),
            entry('quarter', '2026-10-01', 3),
        ], null);

        expect(layout.days[15].entries.map(e => e.releases[0].gameId)).toEqual([1]);
        expect(layout.days[0].entries).toEqual([]);
    });
});

describe('layoutMonth, the bars', () => {
    it('draws a sale across weeks as a piece in each, read out once', () => {
        const layout = layoutMonth('2026-10', [], calendarEvents({ curated: [sale('2026-10-01', '2026-10-15')] }));

        expect(layout.bars.map(b => [b.week, b.columnStart, b.columnEnd])).toEqual([[0, 4, 8], [1, 1, 8], [2, 1, 5]]);
        expect(layout.bars.map(b => b.first)).toEqual([true, false, false]);
        expect(layout.bars.map(b => [b.continuesBefore, b.continuesAfter])).toEqual([[false, true], [true, true], [true, false]]);
    });

    it('starts a sale already running on the first of the month, square where it began before', () => {
        const layout = layoutMonth('2026-10', [], calendarEvents({ curated: [sale('2026-09-24', '2026-10-02')] }));

        const [bar] = layout.bars;
        expect(layout.bars).toHaveLength(1);
        expect(bar).toMatchObject({ week: 0, columnStart: 4, columnEnd: 6, first: true, continuesBefore: true, continuesAfter: false });
    });

    it('leaves out what is over before the month starts or begins after it ends', () => {
        const layout = layoutMonth('2026-10', [], calendarEvents({
            curated: [sale('2026-09-20', '2026-09-30', 1), sale('2026-11-01', '2026-11-08', 2)],
        }));

        expect(layout.bars).toEqual([]);
    });

    it('stacks overlapping bars in as few rows as they need, a week at a time', () => {
        const layout = layoutMonth('2026-10', [], calendarEvents({
            curated: [sale('2026-10-05', '2026-10-07', 1), sale('2026-10-06', '2026-10-09', 2), sale('2026-10-08', '2026-10-09', 3)],
        }));

        // Week 1 is 5 to 11 October: the second overlaps the first, and the third fits after the first.
        expect(layout.bars.map(b => [b.name, b.lane])).toEqual([['Sale 1', 0], ['Sale 2', 1], ['Sale 3', 0]]);
        expect(layout.weeks.map(w => w.lanes)).toEqual([0, 2, 0, 0, 0]);
        // Each week's rows: its dates, a row per lane, its releases.
        expect(layout.weeks.map(w => w.row)).toEqual([1, 3, 7, 9, 11]);
    });

    it("puts a showcase on the reader's own day", () => {
        // Built from local parts, so that the test means the same in every timezone it runs in.
        const layout = layoutMonth('2026-10', [], calendarEvents({
            showcases: [{
                id: 7,
                name: 'A Direct',
                startsAt: new Date(2026, 9, 6, 23, 30).toISOString(),
                endsAt: new Date(2026, 9, 7, 0, 30).toISOString(),
                url: null,
            }],
        }));

        // Half an hour either side of midnight: the Tuesday and the Wednesday, in one week.
        expect(layout.bars).toHaveLength(1);
        expect(layout.bars[0]).toMatchObject({ startsOn: '2026-10-06', endsOn: '2026-10-07', columnStart: 2, columnEnd: 4 });
    });
});

describe('monthBands', () => {
    const entries = [
        entry('month', '2026-10-01', 1),
        entry('quarter', '2026-10-01', 2),
        entry('year', '2026-01-01', 3),
        entry('day', '2026-10-16', 4),
    ];

    it("gives a month its own band, its quarter's and its year's, finest first", () => {
        const bands = monthBands('2026-10', entries);

        expect(bands.map(b => [b.precision, b.label, b.months])).toEqual([
            ['month', 'Sometime in October 2026', null],
            ['quarter', 'Sometime in Q4 2026', 'October to December'],
            ['year', 'Sometime in 2026', null],
        ]);
        expect(bands.map(b => b.entries[0].releases[0].gameId)).toEqual([1, 2, 3]);
    });

    it("puts a quarter's band in each of its months, and leaves out an empty one", () => {
        const bands = monthBands('2026-12', entries);

        expect(bands.map(b => b.precision)).toEqual(['quarter', 'year']);
    });

    it('has nothing for a month in another quarter and year', () => {
        expect(monthBands('2027-01', entries)).toEqual([]);
    });
});

describe('undatedBands', () => {
    function undated(gameId: number, relation: ReleaseRelation, kind: ReleaseKind = 'game'): UndatedEntry {
        return { groupName: null, releases: [connectedRelease({ gameId, kind, reason: { relation } })] };
    }

    const ids = (entries: UndatedEntry[]) => entries.map(e => e.releases[0].gameId);

    it("puts each entry in the band for what it is to the user's game, the game itself first", () => {
        const bands = undatedBands([
            undated(1, 'itself'),
            undated(2, 'child', 'dlc'),
            undated(3, 'child', 'remake'),
            undated(4, 'child', 'expansion'),
            undated(5, 'child', 'port'),
            undated(6, 'series'),
            undated(7, 'series', 'remake'),
        ]);

        expect(bands.map(b => [b.kind, b.label, ids(b.entries)])).toEqual([
            ['yours', 'Your games', [1]],
            ['addons', 'DLC and expansions', [2, 4]],
            ['versions', 'Remakes, remasters and ports', [3, 5]],
            ['series', 'From the same series', [6, 7]],
        ]);
    });

    it('counts every add-on as one, and every other child as the game made again', () => {
        const addOns: ReleaseKind[] = ['dlc', 'expansion', 'standalone_expansion', 'episode', 'season'];
        const madeAgain: ReleaseKind[] = ['game', 'remake', 'remaster', 'expanded_game', 'port'];

        const bands = undatedBands([...addOns, ...madeAgain].map((kind, index) => undated(index + 1, 'child', kind)));

        expect(bands.map(b => [b.kind, b.entries.map(e => e.releases[0].kind)])).toEqual([
            ['addons', addOns],
            ['versions', madeAgain],
        ]);
    });

    it('keeps a game the user tracks among their games, whatever IGDB calls it', () => {
        expect(undatedBands([undated(1, 'itself', 'dlc')]).map(b => b.kind)).toEqual(['yours']);
    });

    it('puts a group where its strongest release goes, which is the reason its card gives', () => {
        const group: UndatedEntry = {
            groupName: 'Street Fighter',
            releases: [
                connectedRelease({ gameId: 1, kind: 'dlc', reason: { relation: 'child' } }),
                connectedRelease({ gameId: 2, reason: { relation: 'series' } }),
            ],
        };

        expect(undatedBands([group]).map(b => [b.kind, b.entries])).toEqual([['addons', [group]]]);
    });

    it('leaves out a band with nothing in it, and has none for an empty list', () => {
        expect(undatedBands([undated(1, 'series')]).map(b => b.kind)).toEqual(['series']);
        expect(undatedBands([])).toEqual([]);
    });
});

describe('monthTotals', () => {
    it("counts each month's days and its own band, and no quarter or year", () => {
        const totals = monthTotals([
            entry('day', '2026-10-16', 1),
            entry('day', '2026-10-20', 2),
            entry('month', '2026-11-01', 3),
            entry('quarter', '2026-10-01', 4),
            entry('year', '2026-01-01', 5),
        ]);

        expect(Object.fromEntries(totals)).toEqual({ '2026-10': 2, '2026-11': 1 });
    });
});
