import { useState } from 'react';
import { Link } from 'react-router';
import type { GameDto } from '@/types/game';
import { hasCriticScore, ratingPercent } from '@/lib/score';
import { ScoreBadge } from '@/components/ScoreBadge';
import { type ListId, LIST_IDS, LIST_NAMES } from '@/types/list';
import { useLists } from '@/hooks/useLists';
import { useAuth } from '@/hooks/useAuth';
import './GameCard.css';

interface GameCardProps {
    game: GameDto;
}

export function GameCard({ game }: GameCardProps) {
    const releaseYear = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null;
    const { user } = useAuth();
    const { addToList, removeFromList, isInList, isPending } = useLists();
    const [overlayOpen, setOverlayOpen] = useState(false);

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
            className="game-card-root bg-slate-800 light:bg-white rounded-xl overflow-hidden flex flex-col shadow-lg hover:shadow-blue-900/40 light:hover:shadow-slate-200/80 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 border border-slate-700 light:border-slate-200 hover:border-blue-600/50"
            onMouseLeave={() => setOverlayOpen(false)}
        >
            {/* Cover Image */}
            <div
                className={`relative aspect-[3/4] bg-slate-900 light:bg-slate-100 overflow-hidden${user ? ' cursor-pointer' : ''}`}
                onClick={user ? () => setOverlayOpen(o => !o) : undefined}
                role={user ? 'button' : undefined}
                tabIndex={user ? 0 : undefined}
                aria-label={user ? `Open list options for ${game.title}` : undefined}
                aria-expanded={user ? overlayOpen : undefined}
                onKeyDown={user ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOverlayOpen(o => !o); } }) : undefined}
            >
                {game.coverImageUrl ? (
                    <img
                        src={game.coverImageUrl}
                        alt={`${game.title} cover`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600 light:text-slate-400">
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
                    <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-slate-900/80 backdrop-blur-sm rounded text-xs font-mono text-slate-300 border border-slate-600">
                        {game.esrbRating}
                    </div>
                )}

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
                                        title={active ? `Remove from ${LIST_NAMES[listId]}` : `Add to ${LIST_NAMES[listId]}`}
                                    >
                                        <span>{LIST_NAMES[listId]}</span>
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
                        </div>
                    </div>
                )}
            </div>

            {/* Card Body */}
            <div className="p-4 flex flex-col gap-2 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-white light:text-slate-900 font-semibold text-sm leading-snug line-clamp-2">
                        <Link to={`/games/${game.id}`} className="hover:text-blue-400 light:hover:text-blue-700 transition-colors">
                            {game.title}
                        </Link>
                    </h3>
                    {releaseYear && (
                        <span className="text-slate-500 light:text-slate-400 text-xs shrink-0 mt-0.5">{releaseYear}</span>
                    )}
                </div>

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
                                className="px-2 py-0.5 bg-blue-900/50 text-blue-300 border-blue-800/50 light:bg-blue-50 light:text-blue-800 light:border-blue-200 text-xs rounded-full border"
                            >
                                {genre.name}
                            </span>
                        ))}
                    </div>
                )}

                {/* Description */}
                {game.description && (
                    <p className="text-slate-400 light:text-slate-500 text-xs leading-relaxed line-clamp-3 mt-auto pt-1">
                        {game.description}
                    </p>
                )}

                {/* Platforms */}
                {game.platforms.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-auto pt-2 border-t border-slate-700 light:border-slate-200">
                        {game.platforms.slice(0, 4).map(platform => (
                            <span
                                key={platform.id}
                                className="px-1.5 py-0.5 bg-slate-700 light:bg-slate-100 text-slate-400 light:text-slate-600 text-xs rounded"
                                title={platform.name}
                            >
                                {platform.abbreviation || platform.name}
                            </span>
                        ))}
                        {game.platforms.length > 4 && (
                            <span className="px-1.5 py-0.5 text-slate-500 light:text-slate-400 text-xs">
                                +{game.platforms.length - 4}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}

