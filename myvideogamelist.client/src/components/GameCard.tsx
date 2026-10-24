import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { GameDto } from '@/types/game';
import { hasCriticScore, ratingPercent } from '@/lib/score';
import { CARD_BODY, CARD_COVER, CARD_FRAME, GAME_GRID_COVER_SIZES } from '@/lib/gameGrid';
import { CoverImage } from '@/components/CoverImage';
import { ScoreBadge } from '@/components/ScoreBadge';
import { FavouriteMark } from '@/components/FavouriteMark';
import { FavouriteWords } from '@/components/FavouriteWords';
import { type ListId, LIST_IDS } from '@/types/list';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import { useFavourites } from '@/hooks/useFavourites';
import { useAuth } from '@/hooks/useAuth';
import './GameCard.css';

interface GameCardProps {
    game: GameDto;
    /** Drawn under the title. The lists page puts the game's tags here; nothing else does. */
    children?: ReactNode;
    /**
     * Load the cover with the page, for a card in the grid's first row. Lazily otherwise. The pages
     * decide, since only they know where the card sits.
     */
    eager?: boolean;
}

/**
 * A game in the grid the games, lists and wishlist pages share (`@/lib/gameGrid`), which is the width
 * its cover's `sizes` is worked out from.
 */
export function GameCard({ game, eager = false, children }: GameCardProps) {
    const releaseYear = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null;
    const { user } = useAuth();
    const { addToList, removeFromList, isInList, isPending, nameFor } = useLists();
    const wishlist = useWishlist();
    const { isFavourite } = useFavourites();
    const [overlayOpen, setOverlayOpen] = useState(false);

    const wishlisted = wishlist.isWishlisted(game.id);

    // Marked, not offered: a favourite is made on the game's page (ADR 0029 §4), and the card says
    // which games already are one wherever it is drawn (ADR 0064).
    const favourite = isFavourite(game.id);

    /**
     * Cards appear on Games and Lists, and neither of those renders the wishlist provider's
     * `mutationError` — so without something here a failed toggle would just quietly snap the
     * heart back. Read off the return value rather than the shared error, because that error
     * belongs to whichever card was clicked last and not necessarily to this one.
     *
     * A shared notification would be the better answer, and would also cover the list buttons
     * below, which have the same gap and predate this.
     */
    const [wishlistFailed, setWishlistFailed] = useState(false);

    const handleWishlistToggle = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setWishlistFailed(false);

        const saved = wishlisted ? await wishlist.remove(game.id) : await wishlist.add(game);
        setWishlistFailed(!saved);
    };

    const handleListToggle = async (e: React.MouseEvent, listId: ListId) => {
        e.stopPropagation();
        if (isPending(game.id)) return;
        if (isInList(listId, game.id)) {
            await removeFromList(listId, game.id);
        } else {
            await addToList(listId, game);
        }
    };

    return (
        <article
            className={`game-card-root ${CARD_FRAME} hover:shadow-primary-900/40 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 hover:border-primary-600/50`}
            onMouseLeave={() => setOverlayOpen(false)}
        >
            {/* Cover Image */}
            <div
                className={`${CARD_COVER}${user ? ' cursor-pointer' : ''}`}
                onClick={user ? () => setOverlayOpen(o => !o) : undefined}
                role={user ? 'button' : undefined}
                tabIndex={user ? 0 : undefined}
                aria-label={user ? `Open list options for ${game.title}` : undefined}
                aria-expanded={user ? overlayOpen : undefined}
                onKeyDown={user ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOverlayOpen(o => !o); } }) : undefined}
            >
                {game.coverImageUrl ? (
                    <CoverImage
                        url={game.coverImageUrl}
                        alt={`${game.title} cover`}
                        sizes={GAME_GRID_COVER_SIZES}
                        eager={eager}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-fg-dim">
                        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                        </svg>
                    </div>
                )}

                {/* Critic score. Suppressed below MIN_CRITIC_REVIEWS: IGDB averages with no floor,
                    so a lone perfect review would otherwise sit here as a green 100. */}
                {hasCriticScore(game) && (
                    <div className="absolute top-2 right-2">
                        <ScoreBadge
                            variant="square"
                            kind="critics"
                            percent={game.criticScore!}
                            count={game.criticScoreCount}
                        />
                    </div>
                )}

                {/* ESRB badge */}
                {game.esrbRating && (
                    <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-page/80 backdrop-blur-sm rounded text-xs font-mono text-fg-soft border border-line-strong">
                        {game.esrbRating}
                    </div>
                )}

                {/* Before the overlay, which covers it on hover. Said in words in the heading: this
                    cover is a button whose name is its own, and a screen reader hears nothing inside it. */}
                {favourite && <FavouriteMark variant="cover" />}

                {/* List selection overlay — only shown when authenticated; visible on hover (CSS) or tap (state) */}
                {user && (
                    <div
                        className={`game-card-overlay${overlayOpen ? ' open' : ''}`}
                        onClick={() => setOverlayOpen(false)}
                        role="presentation"
                    >
                        <div
                            className="game-card-list-btn-group"
                            onClick={e => e.stopPropagation()}
                            role="group"
                            aria-label="Add to list"
                        >
                            <Link
                                to={`/games/${game.id}`}
                                className="game-card-list-btn"
                                onClick={e => e.stopPropagation()}
                                tabIndex={0}
                            >
                                <span>Details</span>
                                <svg className="game-card-list-check" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
                                </svg>
                            </Link>
                            {LIST_IDS.map(listId => {
                                const active = isInList(listId, game.id);
                                const pending = isPending(game.id);
                                return (
                                    <button
                                        key={listId}
                                        className={`game-card-list-btn${active ? ' active' : ''}`}
                                        onClick={e => handleListToggle(e, listId)}
                                        disabled={pending}
                                        aria-pressed={active}
                                        title={active ? `Remove from ${nameFor(listId)}` : `Add to ${nameFor(listId)}`}
                                    >
                                        <span>{nameFor(listId)}</span>
                                        {active ? (
                                            <svg className="game-card-list-check" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : (
                                            <svg className="game-card-list-check" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
                                            </svg>
                                        )}
                                    </button>
                                );
                            })}

                            {/* Set apart from the statuses above, because it is not one of them:
                                a game can be wishlisted while sitting in any list. */}
                            <button
                                className={`game-card-list-btn game-card-wishlist-btn${wishlisted ? ' active' : ''}`}
                                onClick={e => void handleWishlistToggle(e)}
                                disabled={wishlist.isPending(game.id)}
                                aria-pressed={wishlisted}
                                title={wishlisted ? 'Take off your wishlist' : 'Add to your wishlist'}
                            >
                                <span>Wishlist</span>
                                <svg
                                    className="game-card-list-check"
                                    fill={wishlisted ? 'currentColor' : 'none'}
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    aria-hidden="true"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Card Body */}
            <div className={CARD_BODY}>
                {/* In the body rather than the overlay, which is only visible on hover — a
                    message that disappears when the pointer moves away is no message. */}
                {wishlistFailed && (
                    <p className="game-card-wishlist-error" role="alert">
                        Could not update your wishlist.
                    </p>
                )}

                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-fg-strong font-semibold text-sm leading-snug line-clamp-2">
                        <Link to={`/games/${game.id}`} className="hover:text-primary-400 transition-colors">
                            {game.title}
                        </Link>
                        {favourite && <FavouriteWords />}
                    </h3>
                    {releaseYear && (
                        <span className="text-fg-faint text-xs shrink-0 mt-0.5">{releaseYear}</span>
                    )}
                </div>

                {children}

                {/* The player rating, out of 100 like the critic score above it. Stars on a card
                    would be a score nobody on this page gave — see ADR 0021. */}
                {game.rating !== null && (
                    <div>
                        <ScoreBadge
                            kind="players"
                            percent={ratingPercent(game.rating)}
                            count={game.ratingCount}
                        />
                    </div>
                )}

                {/* Genres */}
                {game.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {game.genres.slice(0, 3).map(genre => (
                            <span
                                key={genre.id}
                                className="px-2 py-0.5 bg-primary-900/50 text-primary-300 border-primary-800/50 text-xs rounded-full border"
                            >
                                {genre.name}
                            </span>
                        ))}
                    </div>
                )}

                {/* Description */}
                {game.description && (
                    <p className="text-fg-muted text-xs leading-relaxed line-clamp-3 pt-1">
                        {game.description}
                    </p>
                )}

                {/* Platforms, pinned to the foot of the card. The only auto margin in the body: a
                    second one would split the free space and leave the description floating. */}
                {game.platforms.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-auto pt-2 border-t border-line">
                        {game.platforms.slice(0, 4).map(platform => (
                            <span
                                key={platform.id}
                                className="px-1.5 py-0.5 bg-raised text-fg-muted text-xs rounded"
                                title={platform.name}
                            >
                                {platform.abbreviation || platform.name}
                            </span>
                        ))}
                        {game.platforms.length > 4 && (
                            <span className="px-1.5 py-0.5 text-fg-faint text-xs">
                                +{game.platforms.length - 4}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}

