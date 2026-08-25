import type { GameDto } from '@/types/game';

/**
 * Critic reviews a game needs before its score is worth showing.
 *
 * IGDB's `aggregated_rating` is a plain average with no floor, so a single perfect review
 * reads as a flawless game. The API sends the count alongside every score precisely so the
 * decision can be made here rather than trusting the number on its own.
 */
export const MIN_CRITIC_REVIEWS = 4;

/** Whether a game's critic score rests on enough reviews to be worth displaying. */
export function hasCriticScore(
    game: Pick<GameDto, 'criticScore' | 'criticScoreCount'>,
): boolean {
    return game.criticScore !== null
        && game.criticScoreCount !== null
        && game.criticScoreCount >= MIN_CRITIC_REVIEWS;
}

/** Green / amber / red by score band, shared so the card and the detail page never drift. */
export function criticScoreColors(score: number): string {
    if (score >= 75) return 'bg-green-500 text-white';
    if (score >= 50) return 'bg-yellow-500 text-slate-900';
    return 'bg-red-500 text-white';
}

/** "97 from 10 reviews" — the sample size belongs anywhere the score is shown. */
export function criticScoreTitle(score: number, count: number): string {
    return `Critic score: ${score} from ${count} review${count === 1 ? '' : 's'}`;
}
