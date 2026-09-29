/**
 * Runs of days — a sale, a fest — as the release calendar's curated events carry them: two bare
 * `YYYY-MM-DD` days, the last one inclusive, with no time and no timezone (spec §6, S3).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(day: string): { year: number; month: string; date: number } {
    const [year, month, date] = day.split('-').map(Number);
    return { year, month: MONTHS[month - 1], date };
}

/**
 * "Oct 1 – 8, 2026", saying each part once: the month only where it changes, the year only where it
 * changes. Built from the string alone, so it reads no clock and no locale, and renders the same on
 * the server as in the browser.
 */
export function formatDaySpan(startsOn: string, endsOn: string): string {
    const first = parts(startsOn);
    const last = parts(endsOn);

    if (startsOn === endsOn) return `${first.month} ${first.date}, ${first.year}`;

    if (first.year !== last.year) {
        return `${first.month} ${first.date}, ${first.year} – ${last.month} ${last.date}, ${last.year}`;
    }

    return first.month === last.month
        ? `${first.month} ${first.date} – ${last.date}, ${last.year}`
        : `${first.month} ${first.date} – ${last.month} ${last.date}, ${last.year}`;
}

/**
 * Today on the reader's own calendar, as `YYYY-MM-DD`, which compares with the days above as a
 * string. It reads the clock, so it belongs only in output rendered after hydration.
 */
export function localToday(now: Date = new Date()): string {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${date}`;
}
