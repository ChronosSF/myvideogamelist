import { localToday, utcDay } from '@/lib/daySpan';
import type { CuratedEventKind, CuratedEventStore } from '@/types/calendarAdmin';
import type { CalendarEvents } from '@/types/releases';

/**
 * The showcases and sales beside somebody's releases, as days on the reader's own calendar — what the
 * two-week line and the calendar both draw as bars, and the home page lists for whoever has no line
 * (`specs/release-timeline-and-calendar.md` §2.3, §5, §6).
 */

/** A sale, a fest or a showcase, as the days it runs on. */
export interface DayEvent {
    /** Unique across both kinds of source. */
    key: string;
    kind: CuratedEventKind;
    name: string;
    url: string | null;
    /** The store that runs it, for a curated event that names one; null for every showcase from IGDB. */
    store: CuratedEventStore | null;
    /** The days it runs on the reader's calendar, `YYYY-MM-DD`, the last inclusive. */
    startsOn: string;
    endsOn: string;
    /** A showcase's start, for its time on the reader's clock; null for a curated event, which is days. */
    startsAt: string | null;
}

/**
 * Whose calendar a showcase's instants are read on. The reader's own, everywhere a reader's clock is
 * known; UTC's in a server render, which has none, and in the hydrating render that has to match it.
 */
export type DayZone = 'local' | 'utc';

/**
 * The days an IGDB showcase is on (E4). The end is taken a millisecond early, so that a show ending at
 * midnight is not drawn across the day after it as well.
 */
function showcaseDays(startsAt: string, endsAt: string | null, zone: DayZone): { startsOn: string; endsOn: string } {
    const day = (instant: number) => (zone === 'utc' ? utcDay(new Date(instant)) : localToday(new Date(instant)));

    const starts = Date.parse(startsAt);
    const startsOn = day(starts);
    if (endsAt === null) return { startsOn, endsOn: startsOn };

    const endsOn = day(Math.max(starts, Date.parse(endsAt) - 1));
    return { startsOn, endsOn };
}

/**
 * Every event as days: a curated one as the days it was entered with (S3), a showcase on the reader's
 * days. The server asked IGDB for a day either side of the window, since it cannot know whose day it
 * is; what falls outside is for the caller to leave out, which here it knows.
 *
 * Read on the reader's timezone unless told otherwise, so only output rendered after hydration may
 * leave `zone` out.
 */
export function eventDays(events: CalendarEvents | null, zone: DayZone = 'local'): DayEvent[] {
    if (events === null) return [];

    return [
        ...events.curated.map(e => ({
            key: `curated-${e.id}`,
            kind: e.kind,
            name: e.name,
            url: e.url,
            store: e.store,
            startsOn: e.startsOn,
            endsOn: e.endsOn,
            startsAt: null,
        })),
        ...events.showcases.map(s => ({
            key: `igdb-${s.id}`,
            kind: 'showcase' as const,
            name: s.name,
            url: s.url,
            store: null,
            ...showcaseDays(s.startsAt, s.endsAt, zone),
            startsAt: s.startsAt,
        })),
    ];
}

/**
 * A showcase's start on the reader's clock, in their own locale — "9:00 PM", "21:00". Safe only in
 * output rendered after hydration: on the server it would format in Node's locale and timezone, and the
 * page would not hydrate.
 */
export function startTime(startsAt: string): string {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(startsAt));
}
