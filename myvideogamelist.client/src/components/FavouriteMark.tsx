import { Rosette } from './Rosette';
import './FavouriteMark.css';

interface FavouriteMarkProps {
    /**
     * `cover` sits in the bottom corner of a cover's art and is decoration: whatever draws it says the
     * same in words, with `FavouriteWords` in the game's name, because a cover is usually inside a link
     * or a button whose name is its title. `inline` follows a title in a line of text and is named
     * itself.
     */
    variant: 'cover' | 'inline';
}

/**
 * The mark on a game the reader has made one of their favourites, wherever it is drawn among their own
 * games and the site's: browse, search, their lists, their wishlist, the home page, a game's page and
 * their own showcase. Never on somebody else's profile, whose favourites are theirs (ADR 0064).
 *
 * The rosette, filled, as the release card draws it once a game is a favourite — never a star, which is
 * the user's own score and nothing else (ADR 0021). It marks and does nothing: a favourite is made or
 * unmade on the game's page, or on a release card, and nowhere else (ADR 0029 §4).
 */
export function FavouriteMark({ variant }: FavouriteMarkProps) {
    if (variant === 'inline') {
        return (
            <span
                className="favourite-mark favourite-mark-inline"
                role="img"
                aria-label="One of your favourites"
                title="One of your favourites"
            >
                <Rosette filled />
            </span>
        );
    }

    return (
        <span className="favourite-mark favourite-mark-cover" aria-hidden="true">
            <Rosette filled />
        </span>
    );
}
