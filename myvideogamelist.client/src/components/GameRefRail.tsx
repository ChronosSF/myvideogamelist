import type { GameRefDto } from '@/types/game';
import { GameRefTile } from './GameRefTile';

interface GameRefRailProps {
    games: GameRefDto[];
    /** Names the scroll region for keyboard and screen-reader users. */
    label: string;
    /**
     * Which of the games are the reader's own favourites, to mark them (`docs/decisions/0064-*`). Left
     * out on somebody else's profile: a rail of their favourites is theirs, and the reader's rosette on
     * some of them would read as the owner's.
     */
    isFavourite?: (gameId: number) => boolean;
    /**
     * Whether a marked game says so in words too. False on the owner's own showcase, whose `label`
     * already says that every game in it is one of their favourites.
     */
    sayFavourites?: boolean;
}

/**
 * A horizontally scrolling strip of related games — similar titles, DLC, expansions.
 *
 * Deliberately not `TrendingRail`: that one takes a full `GameDto` and stamps a popularity rank
 * on each cover, neither of which applies to a related-games list.
 */
export function GameRefRail({ games, label, isFavourite, sayFavourites = true }: GameRefRailProps) {
    if (games.length === 0) return null;

    return (
        <ul
            className="relative flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x scroll-smooth"
            // Positioned, so that the visually hidden words beside a favourite's title are placed inside
            // it. Placed against the page instead, those of a cover scrolled out of view widened the
            // page by the rail's overflow, and a phone could scroll it sideways — as the lists' table
            // and the two-week line once did (ListTable.css, ReleaseLine.css).
            // Scrolls independently of the page, so it is a named, focusable region rather than a
            // silent overflow container a keyboard user cannot reach.
            tabIndex={0}
            aria-label={label}
        >
            {games.map(game => (
                <li key={game.id} className="shrink-0 snap-start w-28 sm:w-32">
                    <GameRefTile game={game} favourite={isFavourite?.(game.id) ?? false} sayFavourite={sayFavourites} />
                </li>
            ))}
        </ul>
    );
}
