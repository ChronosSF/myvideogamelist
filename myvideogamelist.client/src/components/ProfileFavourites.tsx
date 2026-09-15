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

    return (
        <section className="profile-section">
            <h3 className="profile-section-title">Favourites</h3>
            {favourites === null ? (
                <p className="profile-empty">
                    {`${userName} has ${count} ${count === 1 ? 'favourite' : 'favourites'}, but they could not be loaded just now.`}
                </p>
            ) : (
                <GameRefRail games={favourites.games} label={`${userName}'s favourite games`} />
            )}
        </section>
    );
}
