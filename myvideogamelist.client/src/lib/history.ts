import type { HistoryItem } from '@/types/history';
import { formatDay } from '@/lib/stats';

/** The kinds this client knows how to say. A kind added later is passed over rather than misread. */
const KNOWN_KINDS = new Set<string>(['status', 'score', 'playthrough_started', 'playthrough_finished']);

/** One day of the history, headed by its date, its items in the server's order. */
export interface HistoryDay {
    /** `yyyy-MM-dd`, on the reader's own calendar for an instant and as written for a day. */
    key: string;
    label: string;
    items: HistoryItem[];
}

/**
 * The calendar day of an instant in a zone, as `yyyy-MM-dd` — by default the reader's own.
 *
 * **The default is the runtime's zone, so it is browser-only**: a server would answer in its own,
 * and a move made at 23:30 in Sofia is the next day in UTC. The history renders only once the page
 * knows who is signed in, which is never during a server render, and it waits for `useHydrated`
 * besides. The zone can be named so that a test can pin one either side of Greenwich whatever the
 * machine it runs on — CI's is UTC, where reading the day in UTC by mistake would pass unnoticed.
 *
 * The parts are read from `Intl` rather than from a formatted string, whose order and separators
 * belong to the locale.
 */
export function localDay(iso: string, timeZone?: string): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso.slice(0, 10);

    const parts = dayFormat(timeZone).formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';

    return `${part('year')}-${part('month')}-${part('day')}`;
}

/** One formatter per zone, because a history of hundreds of items would otherwise build hundreds. */
const dayFormats = new Map<string, Intl.DateTimeFormat>();

function dayFormat(timeZone: string | undefined): Intl.DateTimeFormat {
    const key = timeZone ?? '';
    let format = dayFormats.get(key);
    if (format === undefined) {
        format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        dayFormats.set(key, format);
    }
    return format;
}

/**
 * The items under day headings, in the order the server sent them.
 *
 * A run of consecutive items sharing a day is one heading. The days are not re-sorted, and do not
 * need to be: the server places a playthrough's date at noon UTC, which falls inside that day for
 * every reader from UTC−12 to just short of UTC+12 (ADR 0062). Further east than that, a dated
 * item can sit among the next morning's moves; it then gets a heading of its own rather than being
 * moved, because the order is the server's and a page boundary could fall anywhere.
 */
export function historyDays(items: HistoryItem[], timeZone?: string): HistoryDay[] {
    const days: HistoryDay[] = [];

    for (const item of items) {
        if (!KNOWN_KINDS.has(item.kind)) continue;

        const key = item.at === null ? item.on : localDay(item.at, timeZone);
        const last = days.at(-1);

        if (last?.key === key) last.items.push(item);
        else days.push({ key, label: formatDay(key), items: [item] });
    }

    return days;
}
