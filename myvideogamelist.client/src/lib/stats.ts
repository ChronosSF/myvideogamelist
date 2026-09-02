import type { GameDto } from '@/types/game';
import type { ListEntryDto, ListId } from '@/types/list';
import { LIST_IDS } from '@/types/list';

/** How many rows the platform and genre breakdowns show. */
export const BREAKDOWN_LIMIT = 6;

/**
 * A duration in words.
 *
 * The unit changes with the size because the interesting comparison does: nobody cares that a game
 * took 74 rather than 76 hours, and "3.1 days" is more use than "74 hours" for a figure that is
 * about weeks of evenings. Anything under an hour is reported as such rather than in minutes —
 * these are sums of real playing intervals, and a number of minutes invites a precision the metric
 * does not have.
 */
export function formatHours(hours: number): string {
    if (hours < 1) return 'under an hour';
    if (hours < 24) {
        const whole = Math.round(hours);
        return whole === 1 ? '1 hour' : `${whole} hours`;
    }

    const days = hours / 24;
    // One decimal while that decimal still means something; a whole number once the figure is big
    // enough that a tenth of a day is noise.
    const shown = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
    return shown === 1 ? '1 day' : `${shown} days`;
}

/** A rate as a whole percentage. */
export function formatRate(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `2026-06` as `Jun`, for an axis where the year is implied by the run of months.
 *
 * Two things this deliberately does not do. It does not go through `new Date('2026-06')`, which is
 * parsed as UTC midnight and renders as the previous month for anybody west of Greenwich. And it
 * does not go through `toLocaleString`: `{ month: 'short' }` is numeric in some locales, so the
 * axis came out as "01" on a machine set to one of them — and a localised month inside otherwise
 * English copy would read as a bug even where it worked.
 */
export function formatMonth(month: string): string {
    const index = monthIndex(month);
    return index === null ? month : MONTHS_SHORT[index];
}

/** An ISO timestamp as `25 August 2026`, for prose rather than an axis. */
export function formatDate(iso: string): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    return `${at.getUTCDate()} ${MONTHS_LONG[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** The zero-based month of a `yyyy-MM` key, or null when it is not one. */
function monthIndex(month: string): number | null {
    const parts = month.split('-');
    if (parts.length !== 2) return null;

    const index = Number(parts[1]);
    return Number.isInteger(index) && index >= 1 && index <= 12 ? index - 1 : null;
}

/** True when the month is January, which is where an axis wants to repeat the year. */
export function isYearStart(month: string): boolean {
    return month.endsWith('-01');
}

export interface Tally {
    id: number;
    name: string;
    count: number;
}

/**
 * The most common platforms or genres across every list, counted from the lists the client has
 * already loaded.
 *
 * Computed here rather than on the server for one reason: it is the only part of the profile that
 * needs game metadata, and metadata comes from IGDB. A statistic about the user's own behaviour
 * should not go blank because a third party is down, so the parts that can avoid that dependency
 * do, and this one is kept separate rather than dragging the rest of the page into it.
 *
 * A game with four platforms counts towards all four, so these totals deliberately do not sum to
 * the size of the library. The label has to say "games", never "share of your library".
 */
export function tallyBy(
    lists: Record<ListId, ListEntryDto[]>,
    pick: (game: GameDto) => { id: number; name: string }[],
    limit = BREAKDOWN_LIMIT,
): Tally[] {
    const counts = new Map<number, Tally>();

    for (const listId of LIST_IDS) {
        for (const entry of lists[listId]) {
            // Distinct within one game: a re-release listed twice under the same platform is one
            // game on that platform.
            const seen = new Set<number>();
            for (const item of pick(entry.game)) {
                if (seen.has(item.id)) continue;
                seen.add(item.id);

                const existing = counts.get(item.id);
                if (existing) existing.count++;
                else counts.set(item.id, { id: item.id, name: item.name, count: 1 });
            }
        }
    }

    return [...counts.values()]
        // Ties broken by name, so the order does not depend on which list happened to load first.
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit);
}
