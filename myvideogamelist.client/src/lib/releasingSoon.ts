import type { GameDto } from '@/types/game';

/** One of the user's own games with a release coming up, and why it is theirs. */
export interface ReleasingSoonItem {
    /**
     * The game as the endpoint sends it for this release, so its `platforms` are only the ones
     * releasing that day — the ones worth naming.
     */
    game: GameDto;
    /** The day it releases, as the endpoint sends it: `YYYY-MM-DD`. */
    releaseDate: string;
    onWishlist: boolean;
    inBacklog: boolean;
}

/**
 * The upcoming releases that are on the user's wishlist or in their backlog, soonest first, one
 * per game (ROADMAP H4).
 *
 * Crossed on the client from the upcoming-releases endpoint and the two providers, rather than
 * folded into `/api/home`. That payload is cached once for every visitor and must carry nothing
 * about any one of them (ROADMAP §3.5).
 *
 * The endpoint returns a game once per release *date*, carrying only the platforms releasing on it,
 * so a game already out on PC arrives again for its Switch release. Keeping the earliest row is what
 * names each game once, at the release that is closest.
 *
 * @param upcoming The upcoming-releases response, in any order.
 */
export function releasingSoon(
    upcoming: readonly GameDto[],
    wishlistIds: ReadonlySet<number>,
    backlogIds: ReadonlySet<number>,
): ReleasingSoonItem[] {
    const soonest = new Map<number, ReleasingSoonItem>();

    for (const game of upcoming) {
        const { releaseDate } = game;
        if (releaseDate === null) continue;

        const onWishlist = wishlistIds.has(game.id);
        const inBacklog = backlogIds.has(game.id);
        if (!onWishlist && !inBacklog) continue;

        // `YYYY-MM-DD` compares correctly as text.
        const kept = soonest.get(game.id);
        if (kept && kept.releaseDate <= releaseDate) continue;

        soonest.set(game.id, { game, releaseDate, onWishlist, inBacklog });
    }

    // Title breaks a tie, so the order cannot depend on the order of the response.
    return [...soonest.values()].sort((a, b) =>
        a.releaseDate.localeCompare(b.releaseDate) || a.game.title.localeCompare(b.game.title));
}
