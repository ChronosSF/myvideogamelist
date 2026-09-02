import type { GameDto } from '@/types/game';

/**
 * Critic reviews a game needs before its score is worth showing.
 *
 * IGDB's `aggregated_rating` is a plain average with no floor, so a single perfect review
 * reads as a flawless game. The API sends the count alongside every score precisely so the
 * decision can be made here rather than trusting the number on its own.
 */
export const MIN_CRITIC_REVIEWS = 4;

/**
 * Five stars at half-star steps, which is exactly the ten values the API stores.
 *
 * Every score a user enters goes through that control; every score somebody else produced is
 * shown as a number out of 100. See `docs/decisions/0021-*`.
 */
export const STAR_COUNT = 5;
export const MAX_SCORE = STAR_COUNT * 2;

/**
 * How much of one star a score fills: none, half or all of it.
 *
 * `index` is zero-based, and a score of 7 leaves the fourth star half filled — which is the whole
 * reason the scale is ten values over five stars rather than five over five.
 */
export function starFill(index: number, score: number | null): number {
    if (score === null) return 0;
    return Math.min(Math.max(score - index * 2, 0), 2) / 2;
}

/** Whether a game's critic score rests on enough reviews to be worth displaying. */
export function hasCriticScore(
    game: Pick<GameDto, 'criticScore' | 'criticScoreCount'>,
): boolean {
    return game.criticScore !== null
        && game.criticScoreCount !== null
        && game.criticScoreCount >= MIN_CRITIC_REVIEWS;
}

/**
 * IGDB's player rating arrives on a 0-10 scale and the critic score on 0-100. Aggregates are
 * all displayed out of 100, so a reader comparing two badges is comparing two like things.
 */
export function ratingPercent(rating: number): number {
    return Math.round(rating * 10);
}

/** The three bands every aggregate score is coloured by, shared so no two views disagree. */
function band(percent: number): 'good' | 'mixed' | 'poor' {
    if (percent >= 75) return 'good';
    if (percent >= 50) return 'mixed';
    return 'poor';
}

/**
 * Solid fill, used only where the badge sits on top of cover art and has to punch through it.
 * Everywhere else the tinted variants below keep the page from turning into traffic lights.
 */
export function scoreBandSolid(percent: number): string {
    switch (band(percent)) {
        case 'good': return 'bg-green-500 text-white';
        case 'mixed': return 'bg-yellow-500 text-slate-900';
        case 'poor': return 'bg-red-500 text-white';
    }
}

/** Tinted pill, for a badge sitting in a row of other metadata. */
export function scoreBandTint(percent: number): string {
    switch (band(percent)) {
        case 'good': return 'bg-green-500/15 text-green-300 light:bg-green-50 light:text-green-700';
        case 'mixed': return 'bg-yellow-500/15 text-yellow-300 light:bg-yellow-50 light:text-yellow-700';
        case 'poor': return 'bg-red-500/15 text-red-300 light:bg-red-50 light:text-red-700';
    }
}

/**
 * Tinted text, for the table, where a filled pill in two columns of every row would read as
 * decoration rather than as data.
 */
export function scoreBandSubtle(percent: number): string {
    switch (band(percent)) {
        case 'good': return 'text-green-400 light:text-green-700';
        case 'mixed': return 'text-yellow-400 light:text-yellow-700';
        case 'poor': return 'text-red-400 light:text-red-600';
    }
}

/**
 * "Critic score: 93 out of 100, from 12 reviews" - the sample size belongs anywhere the score
 * is shown, and the scale belongs there too now that both aggregates share one.
 */
export function aggregateTitle(
    kind: 'critics' | 'players',
    percent: number,
    count: number | null,
): string {
    const noun = kind === 'critics' ? 'review' : 'rating';
    const from = count === null ? '' : `, from ${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
    const label = kind === 'critics' ? 'Critic score' : 'Player rating';
    return `${label}: ${percent} out of 100${from}`;
}
