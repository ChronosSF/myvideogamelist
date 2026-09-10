import type { GameDto } from './game';
import type { ActivityMonth, LibraryStats, ScoreStats } from './stats';

/**
 * Somebody else's public profile, mirroring `PublicProfileDto` on the server.
 *
 * A narrower shape than the owner's own `UserStats` on purpose, and narrower on the server too:
 * the public document is assembled field by field rather than derived from the private one, so
 * that a figure added to the private profile does not become public by default. Whatever appears
 * here was put here deliberately — see `docs/decisions/0027-*`.
 */
export interface PublicProfile {
    /** As its owner capitalised it, not as the URL was typed. */
    userName: string;
    activity: PublicActivity;
    library: LibraryStats;
    scores: ScoreStats;
    playtime: PublicPlaytime;
    /** How many public reviews they have written, all pages. */
    reviews: number;
}

export interface PublicActivity {
    /**
     * Their earliest recorded status change, or null when they have none. Not a join date — no
     * such column exists — so the page says "tracking games here since", which is what it means.
     */
    trackingSince: string | null;
    months: ActivityMonth[];
    currentStreakMonths: number;
    longestStreakMonths: number;
}

/** Hours logged, without the per-platform breakdown the owner's own page shows. */
export interface PublicPlaytime {
    playthroughs: number;
    totalMinutes: number;
    withHours: number;
}

/** One page of somebody's public reviews, mirroring `PublicReviewsDto`. */
export interface PublicReviews {
    userName: string;
    reviews: PublicReview[];
    /** Every public review they have written, so the page can say "1–20 of 47". */
    total: number;
    page: number;
    pageSize: number;
}

export interface PublicReview {
    game: GameDto;
    body: string;
    hasSpoilers: boolean;
    /** The author's own score, on the 1–10 scale. Null when they wrote without scoring. */
    score: number | null;
    createdAt: string;
    updatedAt: string;
}
