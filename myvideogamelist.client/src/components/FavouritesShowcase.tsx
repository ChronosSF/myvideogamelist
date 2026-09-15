import { Link } from 'react-router';
import { useFavourites } from '@/hooks/useFavourites';
import type { ProfileVisibility } from '@/types/auth';
import { GameRefRail } from './GameRefRail';
import './ProfileStats.css';

interface FavouritesShowcaseProps {
    /** Decides what the caption says about who else sees these. */
    profileVisibility: ProfileVisibility;
}

/**
 * The signed-in user's favourite games, as a row of covers on their own profile.
 *
 * Read from `FavouritesProvider`, which the game page's toggle writes through, so a favourite made a
 * moment ago is already here without a request of this component's own. Changed from each game's
 * page rather than from here: a row of covers is for looking at, and the one place that toggles a
 * favourite is the panel beside everything else recorded about the game.
 */
export function FavouritesShowcase({ profileVisibility }: FavouritesShowcaseProps) {
    const { items, loading, error, reload } = useFavourites();

    return (
        <section className="profile-stats" aria-labelledby="favourites-showcase-heading">
            <h2 id="favourites-showcase-heading" className="profile-heading">Your favourites</h2>

            {loading ? (
                <p className="profile-empty">Loading your favourites…</p>
            ) : error !== null ? (
                <div className="profile-error" role="alert">
                    <p>{error}</p>
                    <button type="button" className="profile-retry" onClick={reload}>
                        Try again
                    </button>
                </div>
            ) : items.length === 0 ? (
                <>
                    <p className="profile-empty">
                        None yet. Open any game and mark it as one of your favourites, whatever list
                        it is in — or none.
                    </p>
                    <Link to="/games" className="profile-cta">Browse games</Link>
                </>
            ) : (
                <>
                    <GameRefRail
                        games={items.map(item => ({
                            id: item.game.id,
                            name: item.game.title,
                            coverImageUrl: item.game.coverImageUrl,
                        }))}
                        label="Your favourite games"
                    />
                    <p className="profile-caption">
                        {`${items.length} ${items.length === 1 ? 'game' : 'games'}, most recent first. `}
                        {profileVisibility === 'public'
                            ? 'Your public profile shows them too.'
                            : 'Your profile is private, so nobody else sees them.'}
                    </p>
                </>
            )}
        </section>
    );
}
