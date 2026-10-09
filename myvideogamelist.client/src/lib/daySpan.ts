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

const DAY_MS = 86_400_000;

/** The day as a count of days since 1970, in UTC, where every day is exactly as long as the next. */
function dayNumber(day: string): number {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date) / DAY_MS;
}

/**
 * The day `count` days after `day`, or before it for a negative count. Counted in UTC rather than
 * on the reader's clock, so that a day which is 23 or 25 hours long where they live — the night the
 * clocks change — is still one day. Reads no clock.
 */
export function addDays(day: string, count: number): string {
    const moved = new Date((dayNumber(day) + count) * DAY_MS);
    const month = String(moved.getUTCMonth() + 1).padStart(2, '0');
    const date = String(moved.getUTCDate()).padStart(2, '0');
    return `${moved.getUTCFullYear()}-${month}-${date}`;
}

/** How many days `day` is after `from`: negative before it. Reads no clock. */
export function daysBetween(from: string, day: string): number {
    return dayNumber(day) - dayNumber(from);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The parts of a day a line of days labels itself with — "Tue", "Oct", 6 — their long forms for a date
 * written out large, "Tuesday" and "October", and the whole of it for whoever cannot see the line,
 * "Tuesday, October 6". From the string alone, like `formatDaySpan`.
 */
export function dayLabel(day: string): {
    weekday: string;
    month: string;
    date: number;
    longWeekday: string;
    longMonth: string;
    full: string;
} {
    const [year, month, date] = day.split('-').map(Number);
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
    return {
        weekday: weekday.slice(0, 3),
        month: MONTHS[month - 1],
        date,
        longWeekday: weekday,
        longMonth: MONTH_NAMES[month - 1],
        full: `${weekday}, ${MONTH_NAMES[month - 1]} ${date}`,
    };
}
