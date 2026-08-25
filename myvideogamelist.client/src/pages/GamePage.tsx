import { Link, useLoaderData } from 'react-router';
import type { Route } from './+types/GamePage';
import { apiUrl } from '@/lib/api';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import type { GameDto } from '@/types/game';
import { type ListId, LIST_IDS, LIST_NAMES } from '@/types/list';
import { useLists } from '@/hooks/useLists';
import { useAuth } from '@/hooks/useAuth';
import { GameNewsPanel } from '@/components/GameNewsPanel';
import { CompletionTimes } from '@/components/CompletionTimes';
import { GameRefRail } from '@/components/GameRefRail';
import { MultiplayerSummary } from '@/components/MultiplayerSummary';
import { ScreenshotGallery } from '@/components/ScreenshotGallery';
import { criticScoreColors, criticScoreTitle, hasCriticScore } from '@/lib/score';
import './GamePage.css';

function StarRating({ rating, count }: { rating: number; count: number | null }) {
    const stars = Math.round(rating / 2);
    const from = count !== null ? ` from ${count.toLocaleString()} ratings` : '';
    return (
        <div className="flex items-center gap-1" aria-label={`Rating: ${rating.toFixed(1)} out of 10${from}`}>
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
            {count !== null && (
                <span className="text-slate-500 light:text-slate-400 text-xs ml-1.5" aria-hidden="true">
                    ({count.toLocaleString()})
                </span>
            )}
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

    // A thrown Response carries its own headers and bypasses the `headers` export below, so the
    // error paths state their own caching. A 404 gets a short shared TTL; the 502 gets none,
    // because caching an upstream failure at the edge outlives the failure itself.
    const notFound = () => new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Cache-Control': CACHE_NOT_FOUND },
    });

    if (!Number.isInteger(id) || id <= 0) throw notFound();

    const badGateway = () => new Response('Failed to load game.', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Cache-Control': PRIVATE_NO_STORE },
    });

    let response: Response;
    try {
        response = await fetch(apiUrl(`/api/games/${id}`));
    } catch {
        // fetch rejects rather than returning !ok when the API is unreachable.
        throw badGateway();
    }

    if (response.status === 404) throw notFound();
    if (!response.ok) throw badGateway();

    return { game: await response.json() as GameDto };
}

/**
 * Only applies to the 200 path. A thrown Response carries its own headers, so a 404 for an
 * unknown id is not cached for an hour under this policy.
 */
export function headers() {
    return { 'Cache-Control': CACHE_GAME };
}

export function meta({ loaderData }: Route.MetaArgs) {
    if (!loaderData?.game) return [{ title: 'Game not found - MyVideoGameList' }];

    const { game } = loaderData;
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

    // Null on the listing endpoints by design; this page is the one that asks IGDB for it.
    const details = game.details;

    // Collections and franchises both mean "series" to a reader and frequently repeat each
    // other, so they are merged and deduplicated rather than shown as two identical rows.
    const series = details
        ? [...new Set([...details.collections, ...details.franchises])]
        : [];

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

                        {/* A DLC or expansion page that does not say what it belongs to reads as a
                            standalone game with a strangely narrow scope. */}
                        {details?.parentGame && (
                            <p className="text-sm text-slate-400 light:text-slate-500 mb-2">
                                Add-on for{' '}
                                <Link
                                    to={`/games/${details.parentGame.id}`}
                                    className="text-blue-400 light:text-blue-700 hover:text-blue-300 light:hover:text-blue-800 font-medium transition-colors"
                                >
                                    {details.parentGame.name}
                                </Link>
                            </p>
                        )}

                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            {game.esrbRating && (
                                <span className="px-2 py-0.5 bg-slate-800/80 border border-slate-600 text-slate-300 text-xs font-mono rounded">
                                    {game.esrbRating}
                                </span>
                            )}
                            {hasCriticScore(game) && (
                                <span
                                    className={`px-2.5 py-0.5 rounded text-xs font-bold ${criticScoreColors(game.criticScore!)}`}
                                    title={criticScoreTitle(game.criticScore!, game.criticScoreCount!)}
                                >
                                    {game.criticScore} critics
                                </span>
                            )}
                            {releaseDate && (
                                <span className="text-slate-400 light:text-slate-500 text-xs">{releaseDate}</span>
                            )}
                        </div>

                        {/* Star rating */}
                        {game.rating !== null && (
                            <StarRating rating={game.rating} count={game.ratingCount} />
                        )}
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

                        {/* The headline answer to "should I start this?", so it sits above the
                            taxonomy rather than below it. */}
                        {details?.timeToBeat && (
                            <section>
                                <SectionHeading>How long to beat</SectionHeading>
                                <CompletionTimes timeToBeat={details.timeToBeat} />
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

                        {/* Themes read as a second axis on genre — "Open world", "Horror" — so they
                            sit next to it rather than in the sidebar with the trivia. */}
                        {details && details.themes.length > 0 && (
                            <section>
                                <SectionHeading>Themes</SectionHeading>
                                <div className="flex flex-wrap gap-2">
                                    {details.themes.map(theme => (
                                        <InfoChip key={theme} label={theme} />
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

                        {/* How to play: solo, together, and with how many. */}
                        {details && (details.gameModes.length > 0 || details.multiplayerModes) && (
                            <section>
                                <SectionHeading>How to play</SectionHeading>
                                <div className="space-y-3">
                                    {details.gameModes.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {details.gameModes.map(mode => (
                                                <InfoChip key={mode} label={mode} />
                                            ))}
                                        </div>
                                    )}
                                    {details.multiplayerModes && (
                                        <MultiplayerSummary modes={details.multiplayerModes} />
                                    )}
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

                        {/* Screenshots */}
                        {details && details.screenshots.length > 0 && (
                            <section>
                                <SectionHeading>Screenshots</SectionHeading>
                                <ScreenshotGallery screenshots={details.screenshots} gameTitle={game.title} />
                            </section>
                        )}

                        {/* Expansions and DLC are the same thing to a reader deciding what else to
                            buy, so they share one rail. */}
                        {details && (details.expansions.length > 0 || details.dlcs.length > 0) && (
                            <section>
                                <SectionHeading>Expansions &amp; DLC</SectionHeading>
                                <GameRefRail
                                    games={[...details.expansions, ...details.dlcs]}
                                    label={`Expansions and DLC for ${game.title}`}
                                />
                            </section>
                        )}

                        {/* Hides itself when the game has no Steam presence (ROADMAP N7). */}
                        <GameNewsPanel gameId={game.id} />

                        {/* Last in the column: it sends people away from this page, so everything
                            about the game itself gets read first. */}
                        {details && details.similarGames.length > 0 && (
                            <section>
                                <SectionHeading>Similar games</SectionHeading>
                                <GameRefRail
                                    games={details.similarGames}
                                    label={`Games similar to ${game.title}`}
                                />
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

                            {hasCriticScore(game) && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Critic Score</p>
                                    <span
                                        className={`inline-block px-2.5 py-0.5 rounded text-sm font-bold ${criticScoreColors(game.criticScore!)}`}
                                    >
                                        {game.criticScore}
                                    </span>
                                    <span className="ml-2 text-xs text-slate-500 light:text-slate-400">
                                        from {game.criticScoreCount} reviews
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

                            {series.length > 0 && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Series</p>
                                    <p className="text-sm text-slate-200 light:text-slate-800 font-medium">
                                        {series.join(', ')}
                                    </p>
                                </div>
                            )}

                            {details && details.playerPerspectives.length > 0 && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Perspective</p>
                                    <p className="text-sm text-slate-200 light:text-slate-800 font-medium">
                                        {details.playerPerspectives.join(', ')}
                                    </p>
                                </div>
                            )}

                            {details && details.gameEngines.length > 0 && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">
                                        Engine{details.gameEngines.length > 1 ? 's' : ''}
                                    </p>
                                    <p className="text-sm text-slate-200 light:text-slate-800 font-medium">
                                        {details.gameEngines.join(', ')}
                                    </p>
                                </div>
                            )}

                            {/* A dozen-plus languages would dominate the sidebar, so they collapse.
                                A native <details> needs no JavaScript and so survives SSR intact. */}
                            {details && details.languages.length > 0 && (
                                <details className="group">
                                    <summary className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-300 light:hover:text-slate-600 transition-colors">
                                        Languages ({details.languages.length})
                                    </summary>
                                    <ul className="mt-2 space-y-1.5">
                                        {details.languages.map(entry => (
                                            <li key={entry.language} className="text-xs">
                                                <span className="text-slate-200 light:text-slate-800 font-medium">
                                                    {entry.language}
                                                </span>
                                                {entry.supportTypes.length > 0 && (
                                                    <span className="text-slate-500 light:text-slate-400">
                                                        {' '}— {entry.supportTypes.join(', ')}
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}

                            {game.website && (
                                <div>
                                    <p className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider mb-1">Website</p>
                                    <a
                                        href={game.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-blue-400 light:text-blue-700 hover:text-blue-300 light:hover:text-blue-800 transition-colors break-all"
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
                                        className="inline-flex items-center gap-1 text-sm text-blue-400 light:text-blue-700 hover:text-blue-300 light:hover:text-blue-800 transition-colors"
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
