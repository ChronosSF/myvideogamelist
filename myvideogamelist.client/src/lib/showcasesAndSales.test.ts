import { describe, expect, it } from 'vitest';
import type { DayEvent } from '@/lib/calendarEvents';
import { PANEL_DAYS, eventWhen, panelEvents } from '@/lib/showcasesAndSales';
import { LINE_DAYS } from '@/lib/releaseLine';
import { calendarEvents } from '@/test/factories';
import type { CalendarCuratedEvent, CalendarShowcase } from '@/types/releases';

const TODAY = '2026-10-17';

function curated(id: number, startsOn: string, endsOn: string, overrides: Partial<CalendarCuratedEvent> = {}): CalendarCuratedEvent {
    return {
        id,
        kind: 'sale',
        store: 'steam',
        name: `Sale ${id}`,
        startsOn,
        endsOn,
        url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
        ...overrides,
    };
}

function showcase(id: number, startsAt: string, endsAt: string | null = null): CalendarShowcase {
    return { id, name: `Showcase ${id}`, startsAt, endsAt, url: null };
}

/** A showcase at a local hour on a local October day, so the test means the same in every timezone. */
function localShowcase(id: number, day: number, hour: number): CalendarShowcase {
    return showcase(id, new Date(2026, 9, day, hour).toISOString(), new Date(2026, 9, day, hour + 1).toISOString());
}

/** An event as the panel holds one, from its days alone. */
function dayEvent(startsOn: string, endsOn: string = startsOn, startsAt: string | null = null): DayEvent {
    return { key: 'curated-1', kind: 'sale', name: 'Sale', url: null, store: null, startsOn, endsOn, startsAt };
}

describe('panelEvents', () => {
    it('covers the two-week line’s days, since it stands in for the line', () => {
        expect(PANEL_DAYS).toBe(LINE_DAYS);
    });

    it('keeps what is on in today and the thirteen days after it, and nothing either side', () => {
        const events = calendarEvents({
            curated: [
                curated(1, '2026-10-01', '2026-10-16'), // ended yesterday
                curated(2, '2026-10-01', '2026-10-17'), // ends today
                curated(3, '2026-10-30', '2026-11-05'), // starts on the last day
                curated(4, '2026-10-31', '2026-11-05'), // starts the day after
            ],
        });

        expect(panelEvents(TODAY, events, 'local').map(e => e.key)).toEqual(['curated-2', 'curated-3']);
    });

    it('puts what is already on first, then by day, a whole day before a show that day, then by time', () => {
        const events = calendarEvents({
            curated: [
                curated(1, '2026-10-19', '2026-10-26', { name: 'Steam Next Fest', kind: 'fest' }),
                curated(2, '2026-10-01', '2026-10-20', { name: 'Steam Autumn Sale' }),
            ],
            showcases: [localShowcase(11, 19, 21), localShowcase(12, 19, 18), localShowcase(13, 18, 20)],
        });

        expect(panelEvents(TODAY, events, 'local').map(e => e.key)).toEqual([
            'curated-2', 'igdb-13', 'curated-1', 'igdb-12', 'igdb-11',
        ]);
    });

    it('carries the store a curated event names, and none for a showcase', () => {
        const events = calendarEvents({
            curated: [curated(1, '2026-10-19', '2026-10-26', { store: 'epic' })],
            showcases: [localShowcase(11, 20, 19)],
        });

        expect(panelEvents(TODAY, events, 'local').map(e => [e.key, e.store])).toEqual([
            ['curated-1', 'epic'], ['igdb-11', null],
        ]);
    });

    it('reads a showcase on the reader’s own day once told to', () => {
        const events = calendarEvents({ showcases: [localShowcase(11, 20, 23)] });

        expect(panelEvents(TODAY, events, 'local')[0]).toMatchObject({ startsOn: '2026-10-20', endsOn: '2026-10-20' });
    });

    it('reads a showcase on UTC’s day for a render that cannot know the reader’s', () => {
        // 23:30 in UTC on the 20th is the 21st in Sofia and still the 20th in Los Angeles; the server
        // render says the 20th to everybody until the reader's own clock can be asked.
        const events = calendarEvents({ showcases: [showcase(11, '2026-10-20T23:30:00Z', '2026-10-21T00:30:00Z')] });

        expect(panelEvents(TODAY, events, 'utc')[0]).toMatchObject({ startsOn: '2026-10-20', endsOn: '2026-10-21' });
    });

    it('leaves out a show the server sent from the day before the two weeks', () => {
        // The composite is asked about a day either side of everybody's two weeks; a reader keeps theirs.
        const events = calendarEvents({ showcases: [showcase(11, '2026-10-16T20:00:00Z', '2026-10-16T21:00:00Z')] });

        expect(panelEvents(TODAY, events, 'utc')).toEqual([]);
    });
});

describe('eventWhen', () => {
    it('counts down to a day still to come, and names it', () => {
        expect(eventWhen(TODAY, dayEvent('2026-10-20'))).toEqual({
            countdown: 'Starts in 3 days', days: 'Tue, Oct 20', dateTime: '2026-10-20',
        });
        expect(eventWhen(TODAY, dayEvent('2026-10-19'))).toMatchObject({ countdown: 'Starts in 2 days' });
    });

    it('says tomorrow rather than in one day, and gives a run its days', () => {
        expect(eventWhen(TODAY, dayEvent('2026-10-18', '2026-10-26'))).toEqual({
            countdown: 'Starts tomorrow', days: 'Oct 18 – 26', dateTime: null,
        });
    });

    it('says only "Today" for a single day that is today', () => {
        expect(eventWhen(TODAY, dayEvent(TODAY))).toEqual({ countdown: 'Today', days: null, dateTime: null });
    });

    it('says a run starting today starts today, with its days', () => {
        expect(eventWhen(TODAY, dayEvent(TODAY, '2026-10-24'))).toEqual({
            countdown: 'Starts today', days: 'Oct 17 – 24', dateTime: null,
        });
    });

    it('says when something already on stops, rather than when it started', () => {
        expect(eventWhen(TODAY, dayEvent('2026-10-01', '2026-10-26'))).toEqual({
            countdown: 'On now', days: 'until Oct 26', dateTime: '2026-10-26',
        });
        expect(eventWhen(TODAY, dayEvent('2026-10-01', '2026-10-18'))).toEqual({
            countdown: 'Ends tomorrow', days: null, dateTime: null,
        });
        expect(eventWhen(TODAY, dayEvent('2026-10-01', TODAY))).toEqual({
            countdown: 'Ends today', days: null, dateTime: null,
        });
    });

    it('names a month once inside it, and both across two, with no year', () => {
        expect(eventWhen(TODAY, dayEvent('2026-10-28', '2026-11-02')).days).toBe('Oct 28 – Nov 2');
        expect(eventWhen('2026-12-10', dayEvent('2026-12-17', '2027-01-04')).days).toBe('Dec 17 – Jan 4');
    });
});
