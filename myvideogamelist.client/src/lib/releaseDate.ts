/**
 * Release dates as the upcoming-releases endpoint sends them: a bare `YYYY-MM-DD`, one per game per
 * day, with no time and no timezone.
 *
 * Everything here reads the reader's clock, so it belongs only in output rendered after hydration,
 * such as the signed-in half of the home page, which never server-renders. See `useHydrated` for
 * why.
 */

/**
 * The date as a local calendar day. `new Date('2026-09-19')` would parse it as UTC midnight, which
 * is the day before for anybody west of Greenwich.
 */
export function parseReleaseDate(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function startOfDay(now: Date): Date {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return today;
}

/** "Today", "Tomorrow", or a short date such as "Sat, Sep 19". */
export function formatReleaseDay(date: string, now: Date = new Date()): string {
    const day = parseReleaseDate(date);
    const today = startOfDay(now);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (day.getTime() === today.getTime()) return 'Today';
    if (day.getTime() === tomorrow.getTime()) return 'Tomorrow';

    return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
