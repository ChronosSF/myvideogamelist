import type { ListId } from './list';

/**
 * The profile statistics, mirroring `UserStatsDto` on the server.
 *
 * Everything here is derived from our own tables and needs no game metadata, which is why none of
 * it carries a title or a cover. The breakdowns that do need metadata are computed on the client
 * from the lists already loaded — see `@/lib/stats` and `docs/decisions/0023-*`.
 */
export interface UserStats {
    library: LibraryStats;
    scores: ScoreStats;
    activity: ActivityStats;
    playtime: PlaytimeStats;
}

export interface LibraryStats {
    /** Games currently in one of the five statuses. */
    tracked: number;
    /** Every entry, including games taken off the lists that kept their score. */
    recorded: number;
    wishlisted: number;
    byStatus: Record<ListId, number>;
    /** Finished over finished-plus-dropped. Null when nothing has resolved — not zero. */
    completionRate: number | null;
}

export interface ScoreStats {
    scored: number;
    /** On the 1–10 scale the user enters, never a percentage. Null when nothing is scored. */
    mean: number | null;
    /** Ten buckets; index 0 is the count of 1s. */
    distribution: number[];
}

/**
 * What the user started, finished and dropped. Counted from their status changes and, where a game
 * has none of the kind to go by, from the dates on its playthroughs — a status change always takes
 * precedence (ADR 0047). Drops, `transitions` and `timeToFinish` come from status changes alone.
 */
export interface ActivityStats {
    /**
     * The user's first status change, or null when they have none — never a playthrough's date, so
     * "tracking here since" stays a claim about this app. An imported library can have months and
     * no log start at all.
     */
    logStartedAt: string | null;
    /**
     * At most twelve, starting at the earliest record rather than a fixed twelve months back: the
     * first status change, or the earliest playthrough date counted, which can come before it. An
     * empty month before every record would claim inactivity where there is only an absence of
     * records, so there is none.
     */
    months: ActivityMonth[];
    /** Status changes, all time. Playthrough dates are not changes and are not counted here. */
    transitions: number;
    currentStreakMonths: number;
    longestStreakMonths: number;
    timeToFinish: ActiveTime | null;
}

export interface ActivityMonth {
    /** `yyyy-MM`, UTC. */
    month: string;
    started: number;
    finished: number;
    dropped: number;
}

/**
 * Hours the user has logged on playthroughs — the one part of this page that "played" is an honest
 * word for, because hours back it.
 *
 * `byPlatform` carries bare IGDB ids, because `/api/user/stats` makes no IGDB call. The page
 * resolves them from the games in the lists it has already loaded, then from
 * `/api/platforms/active`, then prints the id.
 */
export interface PlaytimeStats {
    /** Every playthrough recorded, whether or not it says how long it took. */
    playthroughs: number;
    /** The sum over those that do. */
    totalMinutes: number;
    /** How many carried a duration. The gap from `playthroughs` is what keeps the total honest. */
    withHours: number;
    /** Most minutes first. Playthroughs with no platform are absent, and still in the totals. */
    byPlatform: PlatformMinutes[];
}

export interface PlatformMinutes {
    /** An IGDB platform id. */
    platformId: number;
    minutes: number;
    playthroughs: number;
}

/** Time spent actually playing, with time on hold excluded — see ADR 0018. */
export interface ActiveTime {
    /** Finished games with at least one playing interval, so the median says what it rests on. */
    samples: number;
    medianHours: number;
    longestHours: number;
}
