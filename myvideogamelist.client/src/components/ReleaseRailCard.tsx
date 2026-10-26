import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { WishlistToggle } from '@/components/WishlistToggle';
import { useReleaseGame, type ReleaseGame } from '@/hooks/useReleaseGame';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';

/** What a card of the grid needs of a game, which both of the home page's release panels have. */
export type ReleaseRailGame = ReleaseGame;

interface ReleaseRailCardProps {
    game: ReleaseRailGame;
    /** The line over the title: when the game comes out, or came out. */
    when: ReactNode;
    /** The grid's first card, two columns and two rows, with its title set larger. */
    lead?: boolean;
}

/**
 * How wide a cover is drawn: a fifth of the 80rem page or two of them for the lead, from `sm` a column of
 * however many fit at 12.5rem, and half a phone's width or all of it for the lead (`ReleaseRail`).
 */
const COVER_SIZES = '(min-width: 80rem) 14rem, (min-width: 40rem) 22vw, 46vw';
const LEAD_SIZES = '(min-width: 80rem) 29rem, (min-width: 40rem) 45vw, 92vw';

/**
 * One game in a release grid: its cover, when, its title and what it is on — and, once somebody is signed
 * in, which of their lists it is in and a button that puts it on their wishlist or takes it off.
 *
 * The grid is the same for everybody and in the first HTML; what is the reader's own arrives after
 * hydration, as their favourites' rosettes do (ADR 0064). The wishlist button is how a game seen here
 * reaches the reader's own two weeks when its day comes (ADR 0073).
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

                <p className={`mt-1 type-title text-fg-strong group-hover:underline decoration-line-strong underline-offset-4 ${lead ? 'text-2xl sm:text-3xl' : 'text-base leading-snug line-clamp-2'}`}>
                    {game.title}
                    {state.favourite && <FavouriteWords />}
                </p>

                {game.platforms.length > 0 && (
                    <p className="mt-1 type-meta text-fg-muted line-clamp-1">
                        {game.platforms.map(p => p.abbreviation).join(', ')}
                    </p>
                )}

                {/* The reader's own list, by their name for it, as every label of a list is. */}
                {state.listName !== null && <p className="mt-1 type-meta text-success-300">In {state.listName}</p>}
            </Link>

            {/* Beside the link rather than in it, since a button inside a link is a control inside a
                control; drawn over the cover's top corner, where the rosette, at the bottom, is not.
                Disabled while the wishlist is unknown, so a press never writes over what it cannot see. */}
            {state.signedIn && (
                <WishlistToggle
                    variant="cover"
                    title={game.title}
                    wishlisted={state.wishlisted}
                    pending={state.pending}
                    onToggle={() => void state.toggleWishlist()}
                />
            )}

            {state.failed && (
                <p className="mt-1 text-xs font-semibold text-danger-300" role="alert">
                    Could not update your wishlist.
                </p>
            )}
        </li>
    );
}
