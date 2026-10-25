import type { GameRefDto } from '@/types/game';
import { GameRefTile } from './GameRefTile';

interface GameRefRailProps {
    games: GameRefDto[];
    /** Names the scroll region for keyboard and screen-reader users. */
    label: string;
    /**
     * How many covers load with the page, for a rail at the top of one, as a profile's favourites are.
     * None by default: on a game page the rails sit far below the fold.
     */
    eager?: number;
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

/** Each cover is drawn across its card, `w-28 sm:w-32`, less the one-pixel border on either side. */
const COVER_SIZES = '(min-width: 40rem) calc(8rem - 2px), calc(7rem - 2px)';

/**
 * A horizontally scrolling strip of related games — similar titles, DLC, expansions.
 *
 * Deliberately not `ReleaseRail`: that one says when each game comes out, or came out, and on what,
 * none of which applies to a related-games list.
 */
export function GameRefRail({ games, label, eager = 0, isFavourite, sayFavourites = true }: GameRefRailProps) {
    if (games.length === 0) return null;

    return (
        <ul
            className="relative flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 scroll-px-4 sm:scroll-px-0 snap-x scroll-smooth"
            // Positioned, so that the visually hidden words beside a favourite's title are placed inside
            // it. Placed against the page instead, those of a cover scrolled out of view widened the
            // page by the rail's overflow, and a phone could scroll it sideways — as the lists' table
            // and the two-week line once did (ListTable.css, ReleaseLine.css).
            // Snapped to the gutter below `sm`, where the first card sits. Snapped to the rail's own
            // edge, that card's snap position was sixteen pixels in, so the rail scrolled itself there
            // before the first paint — and Chrome counts that as a scroll, which ends the page's LCP
            // measurement with nothing recorded (issue 315).
            // Scrolls independently of the page, so it is a named, focusable region rather than a
            // silent overflow container a keyboard user cannot reach.
            tabIndex={0}
            aria-label={label}
        >
            {games.map((game, index) => (
                <li key={game.id} className="shrink-0 snap-start w-28 sm:w-32">
                    <GameRefTile
                        game={game}
                        favourite={isFavourite?.(game.id) ?? false}
                        sayFavourite={sayFavourites}
                        sizes={COVER_SIZES}
                        eager={index < eager}
                    />
                </li>
            ))}
        </ul>
    );
}
