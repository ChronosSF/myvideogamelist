import { describe, expect, it } from 'vitest';
import { LINE_DAYS, layoutLine, lineAgenda, lineDays } from '@/lib/releaseLine';
import { calendarEvents, connectedRelease, releaseEntry } from '@/test/factories';
import type { CalendarCuratedEvent, CalendarShowcase } from '@/types/releases';

const TODAY = '2026-10-06';

function sale(overrides: Partial<CalendarCuratedEvent> = {}): CalendarCuratedEvent {
    return {
        id: 1,
        kind: 'sale',
        store: 'steam',
        name: 'Steam Autumn Sale',
        startsOn: '2026-10-08',
        endsOn: '2026-10-10',
        url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
        ...overrides,
    };
}

/**
 * A showcase starting at a local hour on a local day. Built from local components, so the test means
 * the same thing in every timezone it runs in.
 */
function showcase(id: number, day: number, hour: number, endHour: number | null = hour + 1): CalendarShowcase {
    return {
        id,
        name: `Showcase ${id}`,
        startsAt: new Date(2026, 9, day, hour).toISOString(),
        endsAt: endHour === null ? null : new Date(2026, 9, day, endHour).toISOString(),
        url: null,
    };
}

describe('lineDays', () => {
    it('is today and the thirteen days after it', () => {
        const days = lineDays(TODAY);

        expect(days).toHaveLength(LINE_DAYS);
        expect(days[0]).toBe(TODAY);
        expect(days[13]).toBe('2026-10-19');
    });
});

describe('layoutLine, the releases', () => {
    it('puts a release on its day, counted from today', () => {
        const layout = layoutLine(TODAY, [releaseEntry('2026-10-08')], null);

        expect(layout.days).toHaveLength(LINE_DAYS);
        expect(layout.days[2]).toMatchObject({ day: '2026-10-08', index: 2 });
        expect(layout.days[2].entries).toHaveLength(1);
        expect(layout.days[0].entries).toHaveLength(0);
    });

    it('keeps the releases of one day together, in the order they came', () => {
        const layout = layoutLine(TODAY, [
            releaseEntry('2026-10-08', [connectedRelease({ gameId: 1 })]),
            releaseEntry('2026-10-08', [connectedRelease({ gameId: 2 })]),
        ], null);

        expect(layout.days[2].entries.map(e => e.releases[0].gameId)).toEqual([1, 2]);
    });

    it('draws only what is known to the day and inside the two weeks (L2)', () => {
        // The line asks for days only, so none of these should arrive; this is the guard if one does.
        const layout = layoutLine(TODAY, [
            { ...releaseEntry('2026-10-08'), precision: 'month' },
            releaseEntry('2026-10-20'),
            releaseEntry('2026-10-05'),
        ], null);

        expect(layout.days.every(day => day.entries.length === 0)).toBe(true);
    });
});

describe('layoutLine, the sales and showcases', () => {
    it('spans a sale across its days, from its first to its last', () => {
        const layout = layoutLine(TODAY, [], calendarEvents({ curated: [sale()] }));

        const [bar] = layout.events;
        expect(bar).toMatchObject({ key: 'curated-1', kind: 'sale', first: 2, last: 4, lane: 0 });
    });

    it('cuts a sale off at the line, keeping all of its dates', () => {
        const layout = layoutLine(TODAY, [], calendarEvents({
            curated: [sale({ startsOn: '2026-10-01', endsOn: '2026-10-25' })],
        }));

        const [bar] = layout.events;
        expect(bar).toMatchObject({ first: 0, last: LINE_DAYS - 1, startsOn: '2026-10-01', endsOn: '2026-10-25' });
    });

    it('puts overlapping bars on rows of their own, and reuses a row once it is free', () => {
        const layout = layoutLine(TODAY, [], calendarEvents({
            curated: [
                sale({ id: 1, startsOn: '2026-10-06', endsOn: '2026-10-12' }),
                sale({ id: 2, kind: 'fest', startsOn: '2026-10-09', endsOn: '2026-10-16' }),
                sale({ id: 3, startsOn: '2026-10-14', endsOn: '2026-10-15' }),
            ],
        }));

        expect(layout.lanes).toBe(2);
        expect(layout.events.map(e => [e.key, e.lane])).toEqual([
            ['curated-1', 0],
            ['curated-2', 1],
            ['curated-3', 0],
        ]);
    });

    it("puts a showcase on the reader's own day, and a show ending at midnight on one day only", () => {
        const layout = layoutLine(TODAY, [], calendarEvents({
            showcases: [showcase(1050, 9, 21), showcase(1121, 10, 22, 24)],
        }));

        expect(layout.events.map(e => [e.key, e.startsOn, e.endsOn])).toEqual([
            ['igdb-1050', '2026-10-09', '2026-10-09'],
            ['igdb-1121', '2026-10-10', '2026-10-10'],
        ]);
        expect(layout.events[0].startsAt).toBe(new Date(2026, 9, 9, 21).toISOString());
    });

    it('takes a showcase with no end to be the day it starts', () => {
        const layout = layoutLine(TODAY, [], calendarEvents({ showcases: [showcase(500, 12, 18, null)] }));

        expect(layout.events[0]).toMatchObject({ startsOn: '2026-10-12', endsOn: '2026-10-12' });
    });

    it('leaves out what the server sent from the day either side of the line', () => {
        // The server asks IGDB for a day more at each end, since it cannot know whose day it is.
        const layout = layoutLine(TODAY, [], calendarEvents({
            showcases: [showcase(1, 5, 23), showcase(2, 20, 1)],
        }));

        expect(layout.events).toEqual([]);
        expect(layout.lanes).toBe(0);
    });
});

describe('lineAgenda', () => {
    it('lists each event once and each day with a release, in day order, leaving out the empty days', () => {
        const layout = layoutLine(TODAY, [releaseEntry('2026-10-09'), releaseEntry('2026-10-12')], calendarEvents({
            curated: [sale({ id: 1, startsOn: '2026-10-08', endsOn: '2026-10-10' })],
        }));

        expect(lineAgenda(layout).map(item => [item.type, item.date])).toEqual([
            ['event', '2026-10-08'],
            ['day', '2026-10-09'],
            ['day', '2026-10-12'],
        ]);
    });

    it('puts an event already on at today, and a day’s events before its releases', () => {
        const layout = layoutLine(TODAY, [releaseEntry('2026-10-06')], calendarEvents({
            curated: [sale({ id: 1, startsOn: '2026-10-01', endsOn: '2026-10-07' })],
        }));

        expect(lineAgenda(layout).map(item => [item.type, item.date])).toEqual([
            ['event', TODAY],
            ['day', TODAY],
        ]);
    });

    it('is empty when nothing is on', () => {
        expect(lineAgenda(layoutLine(TODAY, [], null))).toEqual([]);
    });
});
