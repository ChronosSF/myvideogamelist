/**
 * What the community has recorded about one game, mirroring `GameCommunityDtos.cs` on the server.
 *
 * The two halves are gated differently, and both gates are the server's: the scores count every
 * member, because an aggregate names nobody; the reviews list only what was published — marked
 * public, on a public profile. See `docs/decisions/0028-*`.
 */

/** Every member's score for one game, mirroring `CommunityScoresDto`. */
export interface CommunityScores {
    /** How many members have scored the game. */
    scored: number;
    /**
     * On the 1–10 scale scores are entered on, and null when nobody has scored the game. Shown out
     * of 100 through `ratingPercent`, because it is an average of other people (ADR 0021).
     */
    mean: number | null;
    /** Ten buckets; index 0 is the count of 1s. */
    distribution: number[];
}

/** One page of the reviews published about a game, newest first, mirroring `GameReviewsDto`. */
export interface GameReviews {
    reviews: GameReview[];
    /** Every published review of the game, not just this page. */
    total: number;
    /**
     * What to send as `?after=` for the page that follows, or null when this is the last. A position
     * in the order rather than a page number, so a review withdrawn or rewritten while somebody reads
     * cannot push the next page past one they have not seen. Opaque to the client: pass it back as
     * it came.
     */
    next: string | null;
}

export interface GameReview {
    /** As its owner capitalised it. There is always a public profile behind it. */
    userName: string;
    body: string;
    hasSpoilers: boolean;
    /** The author's own score, on the 1–10 scale. Null when they wrote without scoring. */
    score: number | null;
    createdAt: string;
    updatedAt: string;
}
