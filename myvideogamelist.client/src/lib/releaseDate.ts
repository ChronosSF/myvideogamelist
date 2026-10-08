/**
 * Release dates as the API sends them: a bare `YYYY-MM-DD`, with no time and no timezone — a day,
 * shown as the day it names (`specs/release-timeline-and-calendar.md` §4, D3). Neither function
 * here reads the clock, so both are safe to render before hydration.
 */

/**
 * The date as a local calendar day. `new Date('2026-09-19')` would parse it as UTC midnight, which
 * is the day before for anybody west of Greenwich.
 */
export function parseReleaseDate(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day);
}

/** The year a game came out. */
export function releaseYear(date: string): number {
    return parseReleaseDate(date).getFullYear();
}
