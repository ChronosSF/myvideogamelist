import { agendaOf, eventDays, type AgendaItem, type DayEvent } from '@/lib/calendarEvents';
import { addDays, daysBetween } from '@/lib/daySpan';
import type { CalendarEvents, ReleaseEntry } from '@/types/releases';

/**
 * Where everything on the two-week line goes (`specs/release-timeline-and-calendar.md` §2.1): a ruler of
 * fourteen equal days with a mark on the day of each release (L3) and a bar across the days of each sale
 * and showcase, in as few rows as the bars need; and under it, the same things as a list in day order,
 * which is where they are read (ADR 0075).
 *
 * Pure, so that the placing is tested apart from the drawing; the component turns it into a CSS grid.
 */

/** Today and the thirteen days after it (L1). */
export const LINE_DAYS = 14;

/** The ruler's columns: a day each, all the same width, so that the line is a scale of the two weeks. */
export const LINE_COLUMNS = `repeat(${LINE_DAYS}, minmax(0, 1fr))`;

export interface LineDay {
    /** `YYYY-MM-DD`. */
    day: string;
    /** How many days after today it is: 0 for today. */
    index: number;
    /** What releases that day, in the order the API sent it. */
    entries: ReleaseEntry[];
}

export interface LineEvent extends DayEvent {
    /** The days it is on the line, as indexes from today: its first, and its last. */
    first: number;
    last: number;
    /** Its row among the bars, from 0. */
    lane: number;
}

export interface LineLayout {
    days: LineDay[];
    events: LineEvent[];
    /** How many rows the bars take. */
    lanes: number;
}

/** The line's days: today and the thirteen after it. */
export function lineDays(today: string): string[] {
    return Array.from({ length: LINE_DAYS }, (_, index) => addDays(today, index));
}

/** Every event that is on the line, clipped to it, earliest first and the longest first among those. */
function place(today: string, events: CalendarEvents | null): Omit<LineEvent, 'lane'>[] {
    const placed: Omit<LineEvent, 'lane'>[] = [];
    for (const event of eventDays(events)) {
        const first = daysBetween(today, event.startsOn);
        const last = daysBetween(today, event.endsOn);
        if (last < 0 || first >= LINE_DAYS) continue;

        placed.push({
            ...event,
            first: Math.max(first, 0),
            last: Math.min(last, LINE_DAYS - 1),
        });
    }

    return placed.sort((a, b) => a.first - b.first || b.last - a.last || a.name.localeCompare(b.name));
}

/**
 * Where everything goes.
 *
 * @param today The line's first day, on the reader's calendar.
 * @param entries What `/api/user/releases` answered. Only releases known to the day, inside the
 * line, are drawn (L2) — the line asks for nothing else, so the rest is a guard.
 */
export function layoutLine(
    today: string,
    entries: readonly ReleaseEntry[],
    events: CalendarEvents | null,
): LineLayout {
    const placed = place(today, events);

    // Rows for the bars, filled greedily in the order they start: each takes the first row whose
    // last bar has ended by the day it begins.
    const rowEnds: number[] = [];
    const lanes = placed.map(({ first, last }) => {
        let lane = rowEnds.findIndex(end => end < first);
        if (lane === -1) lane = rowEnds.push(last) - 1;
        else rowEnds[lane] = last;
        return lane;
    });

    const days = lineDays(today).map((day, index): LineDay => ({
        day,
        index,
        entries: entries.filter(e => e.precision === 'day' && e.starts === day),
    }));

    return {
        days,
        events: placed.map((event, index) => ({ ...event, lane: lanes[index] })),
        lanes: rowEnds.length,
    };
}

/** The list under the ruler: each sale and showcase at the first of its days on the line (`agendaOf`). */
export function lineAgenda(layout: LineLayout): AgendaItem<LineEvent, LineDay>[] {
    return agendaOf(layout.events, event => layout.days[event.first].day, layout.days);
}
