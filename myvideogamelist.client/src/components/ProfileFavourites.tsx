import type { PublicFavourites } from '@/types/profile';
import { GameRefRail } from './GameRefRail';

interface ProfileFavouritesProps {
    userName: string;
    /** From the profile document, which needs no IGDB and so is known even when the covers are not. */
    count: number;
    /** Null when the favourites request failed. Not the same as having none — `count` says that. */
    favourites: PublicFavourites | null;
}

/**
 * The favourites on somebody's public profile: a row of covers linking to each game.
 *
 * Nothing at all for somebody with no favourites, rather than a heading over an apology. A failed
 * request is different — they chose some, and the page says it could not show them rather than
 * implying there are none.
 */
export function ProfileFavourites({ userName, count, favourites }: ProfileFavouritesProps) {
    if (count === 0) return null;

    // An answer carrying no games reads exactly as no answer: the profile says there are favourites
    // and the row under the heading is empty. It is not only the outage case — the service leaves
    // out any row IGDB can no longer resolve rather than rendering it as a hole, and the count,
    // which comes from our own table, still counts it.
    const unresolved = favourites === null || favourites.games.length === 0;

    return (
        <section className="profile-section">
            <h3 className="profile-section-title">Favourites</h3>
            {unresolved ? (
                <p className="profile-empty">
                    {count === 1
                        ? `${userName} has 1 favourite, but it could not be loaded just now.`
                        : `${userName} has ${count} favourites, but they could not be loaded just now.`}
                </p>
            ) : (
                <GameRefRail games={favourites.games} label={`${userName}'s favourite games`} />
            )}
        </section>
    );
}
