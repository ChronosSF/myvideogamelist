/**
 * What the admin page counts, as `GET /api/admin/stats` answers it (ADR 0051): totals across every
 * account, and the last twelve weeks oldest first. Never a list of accounts.
 */
export interface AdminStats {
    countedAt: string;
    accounts: {
        total: number;
        publicProfiles: number;
        /** Seen since midnight UTC. */
        seenToday: number;
        /** Today or any of the six days before it. */
        seenInSevenDays: number;
        /** Today or any of the twenty-nine days before it. */
        seenInThirtyDays: number;
        /** Created before the dates were recorded: in no week's sign-ups. */
        undated: number;
    };
    library: {
        /** By status key, in the lists' order. */
        byStatus: Record<string, number>;
        inNoList: number;
        fromImports: number;
        wishlisted: number;
        favourites: number;
    };
    writing: {
        reviews: number;
        publicReviews: number;
        playthroughs: number;
        timedPlaythroughs: number;
    };
    /** Only the jobs the retention sweep still holds. */
    imports: {
        pending: number;
        done: number;
        cancelled: number;
    };
    weeks: AdminStatsWeek[];
}

/** One week, Monday to Sunday in UTC. */
export interface AdminStatsWeek {
    /** Its Monday, `YYYY-MM-DD`. */
    starts: string;
    signUps: number;
    listMoves: number;
    reviews: number;
    playthroughs: number;
}
