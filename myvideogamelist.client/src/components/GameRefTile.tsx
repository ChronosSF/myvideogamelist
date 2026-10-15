import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { GameRefDto } from '@/types/game';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';

interface GameRefTileProps {
    game: GameRefDto;
    /** One of the reader's own favourites, so marked with the rosette (`docs/decisions/0064-*`). */
    favourite?: boolean;
    /**
     * Whether the mark is said in words in the game's name too. Left out where whatever holds the tile
     * says it of every game in it — the owner's showcase is a list named as their favourites — so that
     * a screen reader does not hear it again for every cover.
     */
    sayFavourite?: boolean;
    /**
     * A link to the game's page, which a tile is everywhere but in a showcase being arranged: there a
     * press that misses a grip would leave the page, and the mode with it.
     */
    linked?: boolean;
}

const FRAME = 'group block focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-xl';

/**
 * One game as its cover and its name, linking to its page: an item of a `GameRefRail`, or of the
 * favourites showcase while it is being arranged. As wide as whatever holds it.
 */
export function GameRefTile({ game, favourite = false, sayFavourite = true, linked = true }: GameRefTileProps) {
    const content: ReactNode = (
        <>
            <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-surface border border-line group-hover:border-primary-500/60 transition-all duration-300 group-hover:-translate-y-1 shadow-lg">
                {game.coverImageUrl ? (
                    <img
                        src={game.coverImageUrl}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-fg-dim">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                        </svg>
                    </div>
                )}
                {favourite && <FavouriteMark variant="cover" />}
            </div>

            <p className="mt-2 text-xs sm:text-sm font-medium text-fg leading-snug line-clamp-2 group-hover:text-primary-400 transition-colors">
                {game.name}
                {favourite && sayFavourite && <FavouriteWords />}
            </p>
        </>
    );

    return linked
        ? <Link to={`/games/${game.id}`} className={FRAME}>{content}</Link>
        : <div className="block">{content}</div>;
}
