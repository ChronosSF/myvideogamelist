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
 * The favourites on somebody's public profile: a row of covers linking to each game, in the order
 * their owner arranged (ADR 0064).
 *
 * Nothing at all for somebody with no favourites, rather than a heading over an apology. A failed
 * request is different — they chose some, and the page says it could not show them rather than
 * implying there are none.
 *
 * No rosette on any of them, although the reader's own favourites are marked everywhere else. Every
 * cover here is already one of the owner's favourites, which the heading says; the reader's mark on
 * some of them would read as the owner's, saying something untrue about them, and the page is the
 * same for every reader (ADR 0064).
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
