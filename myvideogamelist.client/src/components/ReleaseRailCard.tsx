import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { ReleaseActions } from '@/components/ReleaseActions';
import { useReleaseGame, type ReleaseGame } from '@/hooks/useReleaseGame';
import { platformNames } from '@/lib/releaseReason';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';

interface ReleaseRailCardProps {
    game: ReleaseGame;
    /** The line over the title: when the game comes out, or came out. */
    when: ReactNode;
    /** The grid's first card, two columns and two rows, with its title set larger. */
    lead?: boolean;
}

/**
 * How wide a cover is drawn, in `JustOutRail`'s columns: a sixth of the page's 76rem from `xl`, a quarter of
 * the window from `lg`, a third from `sm` and a half below, less the gutters; the lead is two of them and
 * the gap between, or a phone's whole width.
 */
const COVER_SIZES = '(min-width: 80rem) 11.5rem, (min-width: 64rem) 23vw, (min-width: 40rem) 30vw, 46vw';
const LEAD_SIZES = '(min-width: 80rem) 24.5rem, (min-width: 64rem) 47vw, (min-width: 40rem) 62vw, 92vw';

/**
 * One game in Just out's grid: its cover, when, its title and what it is on — and, once somebody is signed
 * in, which of their lists it is in, and the wishlist and the Backlog, as on every view of what is coming.
 *
 * The grid is the same for everybody and in the first HTML; what is the reader's own arrives after
 * hydration, as their favourites' rosettes do (ADR 0064). The wishlist is how a game seen here reaches the
 * reader's own two weeks when its day comes (ADR 0073).
 */
export function ReleaseRailCard({ game, when, lead = false }: ReleaseRailCardProps) {
    const state = useReleaseGame(game);

    return (
        <li className={`relative min-w-0 ${lead ? 'col-span-2 row-span-2' : ''}`}>
            <Link
                to={`/games/${game.gameId}`}
                className="group block focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
            >
                <div className="relative aspect-[3/4] rounded-sm overflow-hidden bg-surface">
                    {game.coverImageUrl && (
                        <CoverImage
                            url={game.coverImageUrl}
                            alt=""
                            sizes={lead ? LEAD_SIZES : COVER_SIZES}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                    )}

                    {state.favourite && <FavouriteMark variant="cover" />}
                </div>

                <p className={`mt-3 type-kicker ${lead ? 'text-primary-400' : 'text-fg-muted'}`}>{when}</p>

                <p className={`mt-1 type-title text-fg-strong group-hover:underline-quiet ${lead ? 'text-2xl sm:text-3xl' : 'text-base leading-snug line-clamp-2'}`}>
                    {game.title}
                    {state.favourite && <FavouriteWords />}
                </p>

                {game.platforms.length > 0 && (
                    <p className="mt-1 type-meta text-fg-muted line-clamp-1">
                        {platformNames(game.platforms)}
                    </p>
                )}

                {/* The reader's own list, by their name for it, as every label of a list is. */}
                {state.listName !== null && <p className="mt-1 type-meta text-success-300">In {state.listName}</p>}
            </Link>

            {/* After the link rather than in it, since a button inside a link is a control inside a control. */}
            <ReleaseActions title={game.title} state={state} />
        </li>
    );
}
