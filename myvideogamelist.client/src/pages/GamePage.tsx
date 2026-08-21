import { Link, useLoaderData } from 'react-router';
import type { Route } from './+types/GamePage';
import { apiUrl } from '@/lib/api';
import type { GameDto } from '@/types/game';
import { type ListId, LIST_IDS, LIST_NAMES } from '@/types/list';
import { useLists } from '@/hooks/useLists';
import { useAuth } from '@/hooks/useAuth';
import './GamePage.css';

function StarRating({ rating }: { rating: number }) {
    const stars = Math.round(rating / 2);
    return (
        <div className="flex items-center gap-1" aria-label={`Rating: ${rating.toFixed(1)} out of 10`}>
            {Array.from({ length: 5 }, (_, i) => (
                <svg
                    key={i}
                    className={`w-5 h-5 ${i < stars ? 'text-yellow-400' : 'text-slate-600 light:text-slate-300'}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
            ))}
            <span className="text-slate-300 light:text-slate-600 text-sm font-semibold ml-1">{rating.toFixed(1)}</span>
            <span className="text-slate-500 light:text-slate-400 text-xs">/&nbsp;10</span>
        </div>
    );
}

function InfoChip({ label }: { label: string }) {
    return (
        <span className="px-2.5 py-1 bg-slate-700/60 light:bg-slate-100 text-slate-300 light:text-slate-700 text-xs font-medium rounded-lg border border-slate-600/40 light:border-slate-200">
            {label}
        </span>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500 light:text-slate-400 mb-3">
            {children}
        </h2>
    );
}

/**
 * Fetched on the server so crawlers and social unfurlers see the real game, not an
 * empty shell. A missing or malformed id throws a 404 Response, which the root
 * ErrorBoundary renders and which returns a genuine 404 status.
 */
export async function loader({ params }: Route.LoaderArgs) {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }

    const response = await fetch(apiUrl(`/api/games/${id}`));

    if (response.status === 404) {
        throw new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }
    if (!response.ok) {
        throw new Response('Failed to load game.', { status: 502, statusText: 'Bad Gateway' });
    }

    return { game: await response.json() as GameDto };
}

export function meta({ data }: Route.MetaArgs) {
    if (!data?.game) return [{ title: 'Game not found - MyVideoGameList' }];

    const { game } = data;
    const year = game.releaseDate ? ` (${new Date(game.releaseDate).getFullYear()})` : '';
    const title = `${game.title}${year} - MyVideoGameList`;
    const description = game.description?.slice(0, 200)
        ?? `Track ${game.title} on MyVideoGameList.`;

    return [
        { title },
        { name: 'description', content: description },
        { property: 'og:type', content: 'video.game' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(game.coverImageUrl ? [{ property: 'og:image', content: game.coverImageUrl }] : []),
        { name: 'twitter:card', content: game.coverImageUrl ? 'summary_large_image' : 'summary' },
    ];
}

export function GamePage() {
    const { game } = useLoaderData<typeof loader>();

    const { user } = useAuth();
    const { addToList, removeFromList, isInList, isPending } = useLists();

    const handleListToggle = async (listId: ListId) => {
        if (isPending(game.id)) return;
        if (isInList(listId, game.id)) {
            await removeFromList(listId, game.id);
        } else {
            await addToList(listId, game);
        }
    };

    const releaseYear = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null;
    const releaseDate = game.releaseDate
        ? new Date(game.releaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    const youtubeEmbedId = game.trailerUrl
        ? new URLSearchParams(new URL(game.trailerUrl).search).get('v')
        : null;


    return (
        <div className="min-h-screen">
            {/* Hero */}
            <div className="game-page-hero">
                {game.backgroundImageUrl && (
                    <div
                        className="game-page-hero-bg"
                        style={{ backgroundImage: `url(${game.backgroundImageUrl})` }}
                        aria-hidden="true"
                    />
                )}
                <div className="game-page-hero-gradient" aria-hidden="true" />

                <div className="game-page-hero-content">
                    {/* Cover */}
                    <div className="game-page-cover">
                        {game.coverImageUrl ? (
                            <img src={game.coverImageUrl} alt={`${game.title} cover`} />
                        ) : (
                            <div className="game-page-cover-placeholder">
                                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                                </svg>
                            </div>
                        )}
                    </div>

                    {/* Hero text */}
                    <div className="flex-1 min-w-0">
                        {/* Breadcrumb */}
                        <Link
                            to="/games"
                            className="inline-flex items-center gap-1 text-xs text-slate-400 light:text-slate-500 hover:text-blue-400 transition-colors mb-2"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            Games
                        </Link>

                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white light:text-slate-900 leading-tight mb-2">
                            {game.title}
                            {releaseYear && (
                                <span className="text-slate-400 light:text-slate-500 font-normal text-xl ml-2">({releaseYear})</span>
                            )}
                        </h1>

                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            {game.esrbRating && (
                                <span className="px-2 py-0.5 bg-slate-800/80 border border-slate-600 text-slate-300 text-xs font-mono rounded">
                                    {game.esrbRating}
                                </span>
                            )}
                            {game.metacriticScore !== null && (
                                <span
                                    className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                                        game.metacriticScore >= 75
                                            ? 'bg-green-500 text-white'
                                            : game.metacriticScore >= 50
                                            ? 'bg-yellow-500 text-slate-900'
                                            : 'bg-red-500 text-white'
                                    }`}
                                    title="Metacritic score"
                                >
                                    MC {game.metacriticScore}
                                </span>
                            )}
                            {releaseDate && (
                                <span className="text-slate-400 light:text-slate-500 text-xs">{releaseDate}</span>
                            )}
                        </div>

                        {/* Star rating */}
                        {game.rating !== null && <StarRating rating={game.rating} />}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="flex flex-col lg:flex-row gap-10">
                    {/* Main content */}
                    <div className="flex-1 min-w-0 space-y-10">
                        {/* Description */}
                        {game.description && (
                            <section>
                                <SectionHeading>About</SectionHeading>
                                <p className="text-slate-300 light:text-slate-700 text-sm leading-relaxed whitespace-pre-line">
                                    {game.description}
                                </p>
                            </section>
                        )}

                        {/* Genres */}
                        {game.genres.length > 0 && (
                            <section>
                                <SectionHeading>Genres</SectionHeading>
                                <div className="flex flex-wrap gap-2">
                                    {game.genres.map(genre => (
                                        <span
                                            key={genre.id}
                                            className="px-3 py-1 bg-blue-900/40 light:bg-blue-50 text-blue-300 light:text-blue-700 text-xs font-medium rounded-full border border-blue-800/50 light:border-blue-200"
                                        >
                                            {genre.name}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Platforms */}
                        {game.platforms.length > 0 && (
                            <section>
                                <SectionHeading>Platforms</SectionHeading>
                                <div className="flex flex-wrap gap-2">
                                    {game.platforms.map(platform => (
                                        <InfoChip key={platform.id} label={platform.name} />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Developers & Publishers */}
                        {(game.developers.length > 0 || game.publishers.length > 0) && (
                            <section>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                                    {game.developers.length > 0 && (
                                        <div>
                                            <SectionHeading>Developer{game.developers.length > 1 ? 's' : ''}</SectionHeading>
                                            <div className="flex flex-col gap-1.5">
                                                {game.developers.map(dev => (
                                                    <span key={dev.id} className="text-slate-300 light:text-slate-700 text-sm font-medium">
                                                        {dev.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {game.publishers.length > 0 && (
                                        <div>
                                            <SectionHeading>Publisher{game.publishers.length > 1 ? 's' : ''}</SectionHeading>
                                            <div className="flex flex-col gap-1.5">
                                                {game.publishers.map(pub => (
                                                    <span key={pub.id} className="text-slate-300 light:text-slate-700 text-sm font-medium">
                                                        {pub.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Trailer */}
                        {youtubeEmbedId && (
                            <section>
                                <SectionHeading>Trailer</SectionHeading>
                                <div className="game-page-trailer-embed">
                                    <iframe
                                        src={`https://www.youtube-nocookie.com/embed/${youtubeEmbedId}`}
                                        title={`${game.title} trailer`}
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                        allowFullScreen
                                    />
                                </div>
                            </section>
                        )}
                    </div>

                    {/* Sidebar */}
                    <aside className="lg:w-64 xl:w-72 space-y-6">
                        {/* Add to list */}
                        {user ? (
                            <div className="bg-slate-800/60 light:bg-white border border-slate-700/50 light:border-slate-200 rounded-xl p-5">
                                <h2 className="text-sm font-semibold text-white light:text-slate-900 mb-3">Add to List</h2>
                                <div className="game-page-add-btn-group">
                                    {LIST_IDS.map(listId => {
                                        const active = isInList(listId, game.id);
                                        const pending = isPending(game.id);
                                        return (
                                            <button
                                                key={listId}
                                                className={`game-page-add-btn${active ? ' active' : ''}`}
                                                onClick={() => handleListToggle(listId)}
                                                disabled={pending}
                                                aria-pressed={active}
                                                title={active ? `Remove from ${LIST_NAMES[listId]}` : `Add to ${LIST_NAMES[listId]}`}
                                            >
                                                <span>{LIST_NAMES[listId]}</span>
                                                {active ? (
                                                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
                                                    </svg>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-800/60 light:bg-white border border-slate-700/50 light:border-slate-200 rounded-xl p-5 text-center">
                                <p className="text-slate-400 light:text-slate-600 text-xs mb-3">Sign in to track this game.</p>
                            </div>
                        )}

                        {/* Info card */}
                        <div className="bg-slate-800/60 light:bg-white border border-slate-700/50 light:border-slate-200 rounded-xl p-5 space-y-4">
                            {releaseDate && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Release Date</p>
                                    <p className="text-sm text-slate-200 light:text-slate-800 font-medium">{releaseDate}</p>
                                </div>
                            )}

                            {game.metacriticScore !== null && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Metacritic</p>
                                    <span
                                        className={`inline-block px-2.5 py-0.5 rounded text-sm font-bold ${
                                            game.metacriticScore >= 75
                                                ? 'bg-green-500 text-white'
                                                : game.metacriticScore >= 50
                                                ? 'bg-yellow-500 text-slate-900'
                                                : 'bg-red-500 text-white'
                                        }`}
                                    >
                                        {game.metacriticScore}
                                    </span>
                                </div>
                            )}

                            {game.esrbRating && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">ESRB Rating</p>
                                    <span className="px-2 py-0.5 bg-slate-700 light:bg-slate-100 border border-slate-600 light:border-slate-200 text-slate-200 light:text-slate-700 text-sm font-mono rounded">
                                        {game.esrbRating}
                                    </span>
                                </div>
                            )}

                            {game.website && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Website</p>
                                    <a
                                        href={game.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors break-all"
                                    >
                                        Official Site
                                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                    </a>
                                </div>
                            )}

                            {game.trailerUrl && !youtubeEmbedId && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Trailer</p>
                                    <a
                                        href={game.trailerUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                        Watch Trailer
                                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                    </a>
                                </div>
                            )}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}

export default GamePage;
