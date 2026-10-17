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
 * The reader's calendar day of an instant, as `yyyy-MM-dd`.
 *
 * **In the reader's own zone, so browser-only**: a server would answer in its own, and a move made
 * at 23:30 in Sofia is the next day in UTC. The history renders only once the page knows who is
 * signed in, which is never during a server render, and it waits for `useHydrated` besides.
 */
export function localDay(iso: string): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso.slice(0, 10);

    const month = String(at.getMonth() + 1).padStart(2, '0');
    const day = String(at.getDate()).padStart(2, '0');
    return `${at.getFullYear()}-${month}-${day}`;
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
export function historyDays(items: HistoryItem[]): HistoryDay[] {
    const days: HistoryDay[] = [];

    for (const item of items) {
        if (!KNOWN_KINDS.has(item.kind)) continue;

        const key = item.at === null ? item.on : localDay(item.at);
        const last = days.at(-1);

        if (last?.key === key) last.items.push(item);
        else days.push({ key, label: formatDay(key), items: [item] });
    }

    return days;
}
