/**
 * How long an import has left, in words.
 *
 * The API sends `expiresAt` on every job because the retention windows are a server decision —
 * see `ImportRetention` — so nothing here knows how many days a job started with, only when this
 * one runs out. A copy of those windows in TypeScript would drift, and the one place the drift
 * would show is a screen telling somebody their part-finished review is safe for longer than it is.
 *
 * Everything below reads the reader's clock, so it belongs only in output rendered after
 * hydration. See `useHydrated`.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * "today", "tomorrow" or "in 12 days" — or null when there is nothing useful to say, which covers
 * an unparseable date and one already past. A job whose time is up is about to disappear on the
 * next sweep and saying so would be a countdown to nothing.
 */
export function expiresInWords(expiresAt: string, now: Date = new Date()): string | null {
    const expires = new Date(expiresAt);
    if (Number.isNaN(expires.getTime())) return null;

    const remaining = expires.getTime() - now.getTime();
    if (remaining <= 0) return null;

    // Floored, so "in 1 day" never appears for something with 25 hours left and "tomorrow" is not
    // claimed for something expiring in twenty minutes.
    const days = Math.floor(remaining / DAY);

    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return `in ${days} days`;
}
