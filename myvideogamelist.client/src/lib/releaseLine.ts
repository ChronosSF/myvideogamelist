import { addDays, daysBetween, localToday } from '@/lib/daySpan';
import type { CuratedEventKind } from '@/types/calendarAdmin';
import type { CalendarEvents, ReleaseEntry } from '@/types/releases';

/**
 * Where everything on the two-week line goes (`specs/release-timeline-and-calendar.md` §2.1): a
 * column per release on its day (L3), a narrow column for a day with nothing on it, and a bar across
 * the days of each sale and showcase, in as few rows as the bars need.
 *
 * Pure, so that the placing is tested apart from the drawing; the component turns it into a CSS grid.
 */

/** Today and the thirteen days after it (L1). */
export const LINE_DAYS = 14;

/** A track for a day with something on it, wide enough for a cover and why it is there. */
export const CARD_TRACK = 'var(--line-card)';

/**
 * A track for a day with nothing on it: narrow, so that two weeks of a small library fit without a
 * scroll, and stretching to fill the line when they do.
 */
export const NARROW_TRACK = 'minmax(var(--line-narrow), 1fr)';

export interface LineDay {
    /** `YYYY-MM-DD`. */
    day: string;
    /** What releases that day, in the order the API sent it. */
    entries: ReleaseEntry[];
    /** The first grid column the day takes, counting from 1 as CSS does. */
    column: number;
    /** How many columns it takes: one per entry, and one for a day with none. */
    span: number;
}

export interface LineEvent {
    /** Unique across both kinds of source. */
    key: string;
    kind: CuratedEventKind;
    name: string;
    url: string | null;
    /** The days it runs on the reader's calendar, `YYYY-MM-DD`, the last inclusive. */
    startsOn: string;
    endsOn: string;
    /** A showcase's start, for its time on the reader's clock; null for a curated event, which is days. */
    startsAt: string | null;
    /** Whether it began before the line does, or goes on after it ends. */
    continuesBefore: boolean;
    continuesAfter: boolean;
    /** The grid columns it spans, as CSS lines: the first, and the one after its last. */
    columnStart: number;
    columnEnd: number;
    /** Its row among the events, from 0. */
    lane: number;
}

export interface LineLayout {
    days: LineDay[];
    events: LineEvent[];
    /** How many rows the events take. */
    lanes: number;
    /** The grid's `grid-template-columns`. */
    columns: string;
}

/** An event placed on the line's days, before it has a row. */
interface Placed {
    event: Omit<LineEvent, 'columnStart' | 'columnEnd' | 'lane'>;
    first: number;
    last: number;
}

/** The line's days: today and the thirteen after it. */
export function lineDays(today: string): string[] {
    return Array.from({ length: LINE_DAYS }, (_, index) => addDays(today, index));
}

/**
 * The days an IGDB showcase is on, on the reader's own calendar. The end is taken a millisecond
 * early, so that a show ending at midnight is not drawn across the day after it as well.
 */
function showcaseDays(startsAt: string, endsAt: string | null): { startsOn: string; endsOn: string } {
    const starts = Date.parse(startsAt);
    const startsOn = localToday(new Date(starts));
    if (endsAt === null) return { startsOn, endsOn: startsOn };

    const endsOn = localToday(new Date(Math.max(starts, Date.parse(endsAt) - 1)));
    return { startsOn, endsOn };
}

/** Every event that is on the line, clipped to it, earliest first and the longest first among those. */
function place(today: string, events: CalendarEvents | null): Placed[] {
    if (events === null) return [];

    const all: Placed['event'][] = [
        ...events.curated.map(e => ({
            key: `curated-${e.id}`,
            kind: e.kind,
            name: e.name,
            url: e.url,
            startsOn: e.startsOn,
            endsOn: e.endsOn,
            startsAt: null,
            continuesBefore: false,
            continuesAfter: false,
        })),
        // Asked for a day either side of the line, since the server cannot know whose day it is.
        // Here it is known, and what falls outside is left out below.
        ...events.showcases.map(s => ({
            key: `igdb-${s.id}`,
            kind: 'showcase' as const,
            name: s.name,
            url: s.url,
            ...showcaseDays(s.startsAt, s.endsAt),
            startsAt: s.startsAt,
            continuesBefore: false,
            continuesAfter: false,
        })),
    ];

    const placed: Placed[] = [];
    for (const event of all) {
        const first = daysBetween(today, event.startsOn);
        const last = daysBetween(today, event.endsOn);
        if (last < 0 || first >= LINE_DAYS) continue;

        placed.push({
            event: { ...event, continuesBefore: first < 0, continuesAfter: last >= LINE_DAYS },
            first: Math.max(first, 0),
            last: Math.min(last, LINE_DAYS - 1),
        });
    }

    return placed.sort((a, b) =>
        a.first - b.first || b.last - a.last || a.event.name.localeCompare(b.event.name));
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

    // A bar's label starts on its first day, so that day is as wide as a card even with nothing
    // releasing on it — a one-day showcase in a narrow column would be a name nobody could read.
    const labelDays = new Set(placed.map(p => p.first));

    const tracks: string[] = [];
    const days = lineDays(today).map((day, index): LineDay => {
        const onDay = entries.filter(e => e.precision === 'day' && e.starts === day);
        const span = Math.max(onDay.length, 1);
        const wide = onDay.length > 0 || labelDays.has(index);

        const column = tracks.length + 1;
        for (let i = 0; i < span; i++) tracks.push(wide ? CARD_TRACK : NARROW_TRACK);

        return { day, entries: onDay, column, span };
    });

    return {
        days,
        events: placed.map(({ event, first, last }, index) => ({
            ...event,
            columnStart: days[first].column,
            columnEnd: days[last].column + days[last].span,
            lane: lanes[index],
        })),
        lanes: rowEnds.length,
        columns: tracks.join(' '),
    };
}
