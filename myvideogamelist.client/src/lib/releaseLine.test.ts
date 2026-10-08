import { describe, expect, it } from 'vitest';
import { CARD_TRACK, LINE_DAYS, NARROW_TRACK, layoutLine, lineDays } from '@/lib/releaseLine';
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
    it('gives a release a card-wide column on its day and an empty day a narrow one', () => {
        const layout = layoutLine(TODAY, [releaseEntry('2026-10-08')], null);

        const tracks = layout.columns.split(/ (?=var|minmax)/);
        expect(tracks).toHaveLength(LINE_DAYS);
        expect(tracks[2]).toBe(CARD_TRACK);
        expect(tracks[0]).toBe(NARROW_TRACK);
        expect(layout.days[2].entries).toHaveLength(1);
    });

    it('puts the releases of one day side by side, a column each', () => {
        const layout = layoutLine(TODAY, [
            releaseEntry('2026-10-08', [connectedRelease({ gameId: 1 })]),
            releaseEntry('2026-10-08', [connectedRelease({ gameId: 2 })]),
        ], null);

        const [, , thursday, friday] = layout.days;
        expect(thursday).toMatchObject({ column: 3, span: 2 });
        expect(friday.column).toBe(5);
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
    it('spans a sale across its days, from the column its first day starts at', () => {
        const layout = layoutLine(TODAY, [], calendarEvents({ curated: [sale()] }));

        const [bar] = layout.events;
        expect(bar).toMatchObject({ key: 'curated-1', kind: 'sale', columnStart: 3, columnEnd: 6, lane: 0 });
        expect(bar.continuesBefore || bar.continuesAfter).toBe(false);
    });

    it('cuts a sale off at the line, and says that it goes on', () => {
        const layout = layoutLine(TODAY, [], calendarEvents({
            curated: [sale({ startsOn: '2026-10-01', endsOn: '2026-10-25' })],
        }));

        const [bar] = layout.events;
        expect(bar).toMatchObject({ columnStart: 1, columnEnd: LINE_DAYS + 1, continuesBefore: true, continuesAfter: true });
    });

    it('widens the day a bar starts on, so that its name can be read', () => {
        const layout = layoutLine(TODAY, [], calendarEvents({ curated: [sale()] }));

        const tracks = layout.columns.split(/ (?=var|minmax)/);
        expect(tracks[2]).toBe(CARD_TRACK);
        expect(tracks[3]).toBe(NARROW_TRACK);
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
