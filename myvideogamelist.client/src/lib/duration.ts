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
