import { agendaOf, eventDays, type AgendaItem, type DayEvent } from '@/lib/calendarEvents';
import { addDays, daysBetween } from '@/lib/daySpan';
import type { CalendarEvents, ReleaseEntry, ReleaseKind, ReleasePrecision, UndatedEntry } from '@/types/releases';

/**
 * Where everything on the calendar goes (`specs/release-timeline-and-calendar.md` §2.2): a month as its
 * days in their weeks, Monday first, for the index, and as a list of what is on them, each release on its
 * day and each sale and showcase once (K2); what is known only to the month, the quarter or the year in a
 * band for that period (K3); and what is announced with no date at all in a band for what it is to the
 * user's game (K4).
 *
 * Pure, and reads no clock, so that the placing is tested apart from the drawing.
 */

/**
 * The month the calendar opens on and the twelve after it (K1): the horizon §9's fourth question asked
 * for, at the year it leaned to. It is also what one request may ask for — `/api/user/releases` takes
 * at most 400 days, a year and the month it opens on.
 */
export const CALENDAR_MONTHS = 13;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** The month a day is in, `YYYY-MM`. */
export function monthOf(day: string): string {
    return day.slice(0, 7);
}

/** The month `count` months after `month`, or before it for a negative count, as `YYYY-MM`. */
export function addMonths(month: string, count: number): string {
    const [year, number] = month.split('-').map(Number);
    const index = year * 12 + number - 1 + count;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The calendar's months, from the one `today` is in. */
export function calendarMonths(today: string): string[] {
    const first = monthOf(today);
    return Array.from({ length: CALENDAR_MONTHS }, (_, index) => addMonths(first, index));
}

/**
 * The days the calendar asks the API about: from the first of the month it opens on to the first day
 * after its last month, which is exclusive, as the API's `to` is.
 */
export function calendarWindow(today: string): { from: string; to: string } {
    const first = monthOf(today);
    return { from: `${first}-01`, to: `${addMonths(first, CALENDAR_MONTHS)}-01` };
}

/** "October 2026", and its parts. */
export function monthName(month: string): { name: string; short: string; year: number; label: string } {
    const [year, number] = month.split('-').map(Number);
    const name = MONTH_NAMES[number - 1];
    return { name, short: name.slice(0, 3), year, label: `${name} ${year}` };
}

/** The weekday of a day, Monday 0 to Sunday 6. */
function weekday(day: string): number {
    const [year, month, date] = day.split('-').map(Number);
    return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

export interface CalendarDay {
    /** `YYYY-MM-DD`. */
    day: string;
    /** Its week in the index, from 0, and its column, from 1 as CSS counts them. */
    week: number;
    column: number;
    /** What releases that day, in the order the API sent it. */
    entries: ReleaseEntry[];
}

/** A day of the month before or after, filling the first or the last week. Drawn, never read out. */
export interface CalendarPad {
    day: string;
    week: number;
    column: number;
}

export interface MonthLayout {
    days: CalendarDay[];
    pads: CalendarPad[];
    /**
     * The sales, fests and showcases on any of the month's days, each once with all of its dates, in the
     * order they start, the longer first.
     */
    events: DayEvent[];
}

/**
 * Where everything in a month goes.
 *
 * @param month `YYYY-MM`.
 * @param entries What `/api/user/releases` answered. Only releases known to the day go on a day (K2); the
 * rest are `monthBands`'.
 */
export function layoutMonth(month: string, entries: readonly ReleaseEntry[], events: CalendarEvents | null): MonthLayout {
    const first = `${month}-01`;
    const length = daysBetween(first, `${addMonths(month, 1)}-01`);
    const lastDay = addDays(first, length - 1);

    // Cells are counted from the Monday the index starts on.
    const offset = weekday(first);
    const weekCount = Math.ceil((offset + length) / 7);
    const at = (cell: number) => ({ week: Math.floor(cell / 7), column: (cell % 7) + 1 });

    const days = Array.from({ length }, (_, index): CalendarDay => {
        const day = addDays(first, index);
        return {
            day,
            ...at(offset + index),
            entries: entries.filter(e => e.precision === 'day' && e.starts === day),
        };
    });

    const pads: CalendarPad[] = [];
    for (let cell = 0; cell < weekCount * 7; cell++) {
        if (cell < offset || cell >= offset + length) pads.push({ day: addDays(first, cell - offset), ...at(cell) });
    }

    const inMonth = eventDays(events)
        .filter(event => event.endsOn >= first && event.startsOn <= lastDay)
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || b.endsOn.localeCompare(a.endsOn) || a.name.localeCompare(b.name));

    return { days, pads, events: inMonth };
}

/** A band for a period: what is known only to the month, the quarter or the year a month is in (K3). */
export interface MonthBand {
    precision: Exclude<ReleasePrecision, 'day'>;
    /** The first day of the period, `YYYY-MM-DD`, as the API's entries carry it. */
    starts: string;
    /** "Sometime in Q4 2026". */
    label: string;
    /** For a quarter, the months it is: "October to December". */
    months: string | null;
    entries: ReleaseEntry[];
}

/**
 * The bands a month is in, finest first, leaving out any with nothing in it.
 *
 * A quarter's band is in each of its three months, and a year's in each of its twelve: "sometime in
 * 2027" is as true of March as of June, and an entry is never put on a day IGDB has not named (§4).
 */
export function monthBands(month: string, entries: readonly ReleaseEntry[]): MonthBand[] {
    const { name, year } = monthName(month);
    const quarter = Math.floor((Number(month.slice(5, 7)) - 1) / 3);
    const quarterStarts = addMonths(`${year}-01`, quarter * 3);

    const bands: Omit<MonthBand, 'entries'>[] = [
        { precision: 'month', starts: `${month}-01`, label: `Sometime in ${name} ${year}`, months: null },
        {
            precision: 'quarter',
            starts: `${quarterStarts}-01`,
            label: `Sometime in Q${quarter + 1} ${year}`,
            months: `${monthName(quarterStarts).name} to ${monthName(addMonths(quarterStarts, 2)).name}`,
        },
        { precision: 'year', starts: `${year}-01-01`, label: `Sometime in ${year}`, months: null },
    ];

    return bands
        .map(band => ({ ...band, entries: entries.filter(e => e.precision === band.precision && e.starts === band.starts) }))
        .filter(band => band.entries.length > 0);
}

/** What a game announced with no date is to the user's game, which decides its band (K4). */
export type UndatedKind = 'yours' | 'addons' | 'versions' | 'series';

/** A band of the undated list: the entries that are one kind of thing to the user's games. */
export interface UndatedBand {
    kind: UndatedKind;
    /** "DLC and expansions". */
    label: string;
    entries: UndatedEntry[];
}

/**
 * The bands in the order the list reads: the game itself, its children, its series — the order the server
 * sends the entries in — with what is added to a game before the game made again.
 */
const UNDATED_BANDS: readonly { kind: UndatedKind; label: string }[] = [
    { kind: 'yours', label: 'Your games' },
    { kind: 'addons', label: 'DLC and expansions' },
    { kind: 'versions', label: 'Remakes, remasters and ports' },
    { kind: 'series', label: 'From the same series' },
];

/**
 * What each kind of child is to its game: something added to it, or the game made again. A record rather
 * than a list of the add-ons, so that a new kind does not compile until somebody has said which it is.
 */
const CHILD_BAND: Record<ReleaseKind, Extract<UndatedKind, 'addons' | 'versions'>> = {
    // A main game is a child only as an edition, which F3 folds.
    game: 'versions',
    dlc: 'addons',
    expansion: 'addons',
    standalone_expansion: 'addons',
    episode: 'addons',
    season: 'addons',
    remake: 'versions',
    remaster: 'versions',
    expanded_game: 'versions',
    port: 'versions',
    update: 'addons',
};

/**
 * The band an entry goes in, from its strongest release — the one whose reason a group is shown with, so
 * that a group's band and what its card says agree. The relation decides (§3.2): the game itself, a child
 * of it, or a game from its series. A child is then what it is: something added to the game, or the game
 * made again — remade, remastered, ported, or a new edition of it.
 */
function undatedKind(entry: UndatedEntry): UndatedKind {
    const [strongest] = entry.releases;
    switch (strongest.reason.relation) {
        case 'itself':
            return 'yours';
        case 'child':
            return CHILD_BAND[strongest.kind];
        case 'series':
            return 'series';
    }
}

/**
 * The undated list in bands for what each entry is to the user's game, leaving out any with nothing in
 * it. Each band keeps the order the entries came in.
 */
export function undatedBands(entries: readonly UndatedEntry[]): UndatedBand[] {
    return UNDATED_BANDS
        .map(band => ({ ...band, entries: entries.filter(e => undatedKind(e) === band.kind) }))
        .filter(band => band.entries.length > 0);
}

/**
 * How many entries each month holds on its days and in its own band — the count beside each month in
 * the calendar's list of months. A quarter or a year is no one month's, so its bands are not counted.
 */
export function monthTotals(entries: readonly ReleaseEntry[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const entry of entries) {
        if (entry.precision !== 'day' && entry.precision !== 'month') continue;
        const month = monthOf(entry.starts);
        totals.set(month, (totals.get(month) ?? 0) + 1);
    }
    return totals;
}

/** A month as the list beside its index: each sale and showcase at the first of its days in the month. */
export function monthAgenda(month: string, layout: MonthLayout): AgendaItem<DayEvent, CalendarDay>[] {
    const first = `${month}-01`;
    return agendaOf(layout.events, event => (event.startsOn < first ? first : event.startsOn), layout.days);
}

/** The kinds of event on a day, for the index's marks under it, in the order the month's events start. */
export function eventKindsOn(day: string, layout: MonthLayout): DayEvent['kind'][] {
    return layout.events
        .filter(event => event.startsOn <= day && day <= event.endsOn)
        .map(event => event.kind);
}
