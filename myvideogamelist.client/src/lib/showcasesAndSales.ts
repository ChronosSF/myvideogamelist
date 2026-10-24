import { eventDays, type DayEvent, type DayZone } from '@/lib/calendarEvents';
import { addDays, dayLabel, daysBetween } from '@/lib/daySpan';
import { LINE_DAYS } from '@/lib/releaseLine';
import type { CalendarEvents } from '@/types/releases';

/**
 * The home page's showcases and sales, for whoever has no two-week line
 * (`specs/release-timeline-and-calendar.md` §2.3): the line's events on their own, as a list that
 * counts down to each — "Summer Game Fest starts in 2 days".
 *
 * Pure, and handed its day rather than reading a clock, so that the server render and the render that
 * hydrates it can be given the same one, and everything after them the reader's own.
 */

/** Today and the thirteen days after it: the line's two weeks (L1), since the panel stands in for it. */
export const PANEL_DAYS = LINE_DAYS;

/** The instant a showcase starts, for ordering; a curated event is a whole day, so it comes first. */
function startInstant(event: DayEvent): number {
    return event.startsAt === null ? Number.NEGATIVE_INFINITY : Date.parse(event.startsAt);
}

/**
 * Everything on in the two weeks from `today`, earliest first: what is already on, then by the day each
 * starts, a whole day's event before a show at a time of that day, and by name among the rest.
 *
 * The names are compared in English, not in the runtime's own locale: this runs in the server render
 * and in the render hydrating it, and the two runtimes' locales need not agree. Czech puts "Ch" after
 * "H", Danish puts "Aa" last, and an order that differs between them is a page that will not hydrate.
 * The key settles two events of the same name, so the order is total.
 *
 * @param zone Whose calendar a showcase's instants are read on — see `DayZone`.
 */
export function panelEvents(today: string, events: CalendarEvents, zone: DayZone): DayEvent[] {
    const last = addDays(today, PANEL_DAYS - 1);

    return eventDays(events, zone)
        .filter(event => event.endsOn >= today && event.startsOn <= last)
        .sort((a, b) =>
            daysBetween(b.startsOn, a.startsOn)
            || startInstant(a) - startInstant(b)
            || a.name.localeCompare(b.name, 'en')
            || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** "Oct 19", from the string alone. */
function shortDay(day: string): string {
    const { month, date } = dayLabel(day);
    return `${month} ${date}`;
}

/** "Tue, Oct 20". */
function weekdayAndDay(day: string): string {
    const { weekday, month, date } = dayLabel(day);
    return `${weekday}, ${month} ${date}`;
}

/**
 * "Oct 19 – 26", "Oct 28 – Nov 2", "Dec 17 – Jan 4". No year: something on in the next two weeks is
 * never far enough off for its year to be in doubt.
 */
function shortSpan(startsOn: string, endsOn: string): string {
    const first = dayLabel(startsOn);
    const last = dayLabel(endsOn);
    const sameMonth = startsOn.slice(0, 7) === endsOn.slice(0, 7);

    return sameMonth
        ? `${first.month} ${first.date} – ${last.date}`
        : `${first.month} ${first.date} – ${last.month} ${last.date}`;
}

/** When an event is, as the panel says it. */
export interface EventWhen {
    /** Counted from `today`: "Starts in 2 days", "Starts tomorrow", "Today", "On now", "Ends today". */
    countdown: string;
    /**
     * The days it names, or null when the countdown has said all there is: "Tue, Oct 20" for a day,
     * "Oct 19 – 26" for a run of them, "until Oct 26" for one already on.
     */
    days: string | null;
    /** For a `<time>`: the day `days` names, when it names one day. */
    dateTime: string | null;
}

/**
 * The countdown to an event and the days it is on, said against `today`. Built from strings alone, so
 * it reads no clock: the countdown is as true as the day it is handed.
 */
export function eventWhen(today: string, event: DayEvent): EventWhen {
    const first = daysBetween(today, event.startsOn);
    const last = daysBetween(today, event.endsOn);
    const oneDay = event.startsOn === event.endsOn;

    // Begun before today, so where it started is history and when it stops is the news.
    if (first < 0) {
        if (last === 0) return { countdown: 'Ends today', days: null, dateTime: null };
        if (last === 1) return { countdown: 'Ends tomorrow', days: null, dateTime: null };
        return { countdown: 'On now', days: `until ${shortDay(event.endsOn)}`, dateTime: event.endsOn };
    }

    let countdown: string;
    if (first === 0) countdown = oneDay ? 'Today' : 'Starts today';
    else if (first === 1) countdown = 'Starts tomorrow';
    else countdown = `Starts in ${first} days`;

    if (!oneDay) return { countdown, days: shortSpan(event.startsOn, event.endsOn), dateTime: null };

    // A single day today needs no date beside "Today".
    if (first === 0) return { countdown, days: null, dateTime: null };
    return { countdown, days: weekdayAndDay(event.startsOn), dateTime: event.startsOn };
}
