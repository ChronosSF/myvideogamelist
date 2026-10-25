import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { releaseAsGame } from '@/hooks/useAddToBacklog';
import { useAuth } from '@/hooks/useAuth';
import { useFavourites } from '@/hooks/useFavourites';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import type { PlatformDto } from '@/types/game';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';

/** What a card of the rail needs of a game, which both of the home page's release panels have. */
export interface ReleaseRailGame {
    gameId: number;
    title: string;
    coverImageUrl: string | null;
    platforms: PlatformDto[];
}

interface ReleaseRailCardProps {
    game: ReleaseRailGame;
    /** The line over the title: when the game comes out, or came out. */
    when: ReactNode;
}

/** Each cover is drawn across its card, `w-32 sm:w-36`, less the one-pixel border on either side. */
const COVER_SIZES = '(min-width: 40rem) calc(9rem - 2px), calc(8rem - 2px)';

/**
 * One game on a release rail: its cover, when, its title and what it is on — and, once somebody is signed
 * in, which of their lists it is in and a button that puts it on their wishlist or takes it off.
 *
 * The rail is the same for everybody and in the first HTML; what is the reader's own arrives after
 * hydration, as their favourites' rosettes do (ADR 0064). The wishlist button is how a game seen here
 * reaches the reader's own two weeks when its day comes (ADR 0073): the two panels stay apart from Coming
 * up, and this is what joins them.
 */
export function ReleaseRailCard({ game, when }: ReleaseRailCardProps) {
    const { user } = useAuth();
    const { isFavourite } = useFavourites();
    const { getListFor, nameFor } = useLists();
    const wishlist = useWishlist();

    // The account this card's last change failed for, read off the return value rather than the provider's
    // shared error, which belongs to whichever card was pressed last — as on the games grid's cards. Held as
    // the account rather than a flag, because the page outlives a sign-out: a flag would go on telling the
    // visitor, or the next account, that a wishlist they never touched could not be updated.
    const [failedFor, setFailedFor] = useState<string | null>(null);

    const favourite = isFavourite(game.gameId);
    const list = getListFor(game.gameId);
    const wishlisted = wishlist.isWishlisted(game.gameId);

    const toggleWishlist = async () => {
        const account = user?.id ?? null;
        setFailedFor(null);
        const saved = wishlisted ? await wishlist.remove(game.gameId) : await wishlist.add(releaseAsGame(game));
        setFailedFor(saved ? null : account);
    };

    return (
        <li className="relative shrink-0 snap-start w-32 sm:w-36">
            <Link
                to={`/games/${game.gameId}`}
                className="group block focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus rounded-xl"
            >
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-surface border border-line group-hover:border-primary-500/60 transition-all duration-300 group-hover:-translate-y-1 shadow-lg">
                    {game.coverImageUrl && (
                        <CoverImage
                            url={game.coverImageUrl}
                            alt=""
                            sizes={COVER_SIZES}
                            className="w-full h-full object-cover"
                        />
                    )}

                    {favourite && <FavouriteMark variant="cover" />}
                </div>

                <p className="mt-2 text-xs font-semibold text-primary-400">{when}</p>

                <p className="mt-0.5 text-sm font-medium text-fg leading-snug line-clamp-2 group-hover:text-primary-400 transition-colors">
                    {game.title}
                    {favourite && <FavouriteWords />}
                </p>

                {game.platforms.length > 0 && (
                    <p className="mt-0.5 text-xs text-fg-muted line-clamp-1">
                        {game.platforms.map(p => p.abbreviation).join(', ')}
                    </p>
                )}

                {/* The reader's own list, by their name for it, as every label of a list is. */}
                {list !== null && <p className="mt-0.5 text-xs text-fg-soft">In {nameFor(list)}</p>}
            </Link>

            {/* Beside the link rather than in it, since a button inside a link is a control inside a
                control; drawn over the cover's top corner, where the rosette, at the bottom, is not.
                Disabled while the wishlist is unknown, so a press never writes over what it cannot see. */}
            {user !== null && (
                <button
                    type="button"
                    onClick={() => void toggleWishlist()}
                    disabled={wishlist.isPending(game.gameId)}
                    aria-pressed={wishlisted}
                    aria-label={`Wishlist ${game.title}`}
                    title={wishlisted ? 'Take off your wishlist' : 'Add to your wishlist'}
                    className={`absolute top-1.5 right-1.5 flex items-center justify-center w-8 h-8 rounded-full border border-white/20 shadow-md transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 ${wishlisted ? 'bg-wishlist-700/90 text-fg-strong' : 'bg-sunken/80 text-fg-soft hover:bg-wishlist-600/85 hover:text-fg-strong'}`}
                >
                    <svg className="w-4 h-4" fill={wishlisted ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                </button>
            )}

            {failedFor !== null && failedFor === user?.id && (
                <p className="mt-1 text-xs font-semibold text-danger-300" role="alert">
                    Could not update your wishlist.
                </p>
            )}
        </li>
    );
}
