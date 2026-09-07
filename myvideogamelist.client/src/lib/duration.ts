/**
 * Formats a play-time span given in seconds, the unit IGDB reports completion times in.
 *
 * Rounds to half hours up to ten hours and to whole hours beyond, because a completionist
 * estimate of "246.8 hours" implies precision that a couple of dozen community submissions
 * cannot support. Spans under an hour fall back to minutes.
 */
export function formatPlaytime(seconds: number | null): string | null {
    if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;

    const hours = seconds / 3600;
    if (hours < 1) return `${Math.round(seconds / 60)} min`;

    const rounded = hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours);
    return `${rounded}h`;
}

/**
 * The same formatting for a duration the user recorded in minutes.
 *
 * Delegates rather than duplicating the rounding rules, because a member's logged time and IGDB's
 * average sit in adjacent rows on the game page and have to round the same way — "51h" beside
 * "50.5h" would read as a difference that is not there. `formatPlaytime` keeps its
 * seconds contract, which is the unit IGDB reports in and nothing else uses.
 */
export function formatMinutesPlayed(minutes: number | null): string | null {
    return minutes === null ? null : formatPlaytime(minutes * 60);
}

/**
 * A logged duration written out exactly, as `4h 20m`.
 *
 * Unlike `formatPlaytime` this rounds nothing: it is showing back a figure one person typed in,
 * where rounding "3h 40m" to "3.5h" would look like the form had misread them. The rounded form
 * is for averages over other people, where the precision was never there to begin with.
 */
export function formatExactMinutes(minutes: number | null): string | null {
    if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    if (hours === 0) return `${rest}m`;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
