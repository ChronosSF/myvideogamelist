import type { GameDto, PlatformDto } from '@/types/game';

/** One of the user's own games with a release coming up, and why it is theirs. */
export interface ReleasingSoonItem {
    game: GameDto;
    /** The day it releases, as the endpoint sends it: `YYYY-MM-DD`. */
    releaseDate: string;
    /** The platforms releasing that day that the user has not hidden — the ones worth naming. */
    platforms: PlatformDto[];
    onWishlist: boolean;
    inBacklog: boolean;
}

/**
 * The upcoming releases that are on the user's wishlist or in their backlog, soonest first, one
 * per game (ROADMAP H4).
 *
 * Crossed on the client from data the home page already holds — the calendar's own fetch and the
 * two providers — rather than folded into `/api/home`. That payload is cached once for every visitor
 * and must carry nothing about any one of them (ROADMAP §3.5), which is why the calendar was already
 * a separate client fetch.
 *
 * The user's hidden platforms apply, exactly as they do to the calendar below. The endpoint returns
 * a game once per release *date*, carrying only the platforms releasing on it, so a game already out
 * on PC arrives again for its Switch release. For somebody who has hidden Switch that row announces a
 * release on a platform they have said they do not care about. Filtering before keeping the earliest
 * row is what lets a later release they can see still count.
 *
 * @param upcoming The upcoming-releases response, in any order.
 */
export function releasingSoon(
    upcoming: readonly GameDto[],
    wishlistIds: ReadonlySet<number>,
    backlogIds: ReadonlySet<number>,
    hiddenPlatformIds: ReadonlySet<number>,
): ReleasingSoonItem[] {
    const soonest = new Map<number, ReleasingSoonItem>();

    for (const game of upcoming) {
        const { releaseDate } = game;
        if (releaseDate === null) continue;

        const onWishlist = wishlistIds.has(game.id);
        const inBacklog = backlogIds.has(game.id);
        if (!onWishlist && !inBacklog) continue;

        const platforms = game.platforms.filter(platform => !hiddenPlatformIds.has(platform.id));

        // The calendar's own rule: a release naming no platform at all is kept, because IGDB not
        // saying where is not the same as it being somewhere the user hid.
        if (game.platforms.length > 0 && platforms.length === 0) continue;

        // `YYYY-MM-DD` compares correctly as text.
        const kept = soonest.get(game.id);
        if (kept && kept.releaseDate <= releaseDate) continue;

        soonest.set(game.id, { game, releaseDate, platforms, onWishlist, inBacklog });
    }

    // Title breaks a tie, so the order cannot depend on the order of the response.
    return [...soonest.values()].sort((a, b) =>
        a.releaseDate.localeCompare(b.releaseDate) || a.game.title.localeCompare(b.game.title));
}
