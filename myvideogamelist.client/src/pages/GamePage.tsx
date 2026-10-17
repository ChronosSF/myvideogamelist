import { Link, data, isRouteErrorResponse, useLoaderData, useRevalidator } from 'react-router';
import type { Route } from './+types/GamePage';
import { apiUrl } from '@/lib/api';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import type { GameDto } from '@/types/game';
import { useAuth } from '@/hooks/useAuth';
import { useGameCommunity } from '@/hooks/useGameCommunity';
import { CoverImage } from '@/components/CoverImage';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { GameNewsPanel } from '@/components/GameNewsPanel';
import { GameUserPanel } from '@/components/GameUserPanel';
import { GameCommunity } from '@/components/GameCommunity';
import { CompletionTimes } from '@/components/CompletionTimes';
import { SectionHeading } from '@/components/SectionHeading';
import { GameRefRail } from '@/components/GameRefRail';
import { MultiplayerSummary } from '@/components/MultiplayerSummary';
import { ScreenshotGallery } from '@/components/ScreenshotGallery';
import { TrailerPlayer } from '@/components/TrailerPlayer';
import { formatCount } from '@/lib/format';
import { pageMeta, siteConfig } from '@/lib/seo';
import { hasCriticScore, hasMemberScore, ratingPercent } from '@/lib/score';
import { ScoreBadge } from '@/components/ScoreBadge';
import './GamePage.css';

/**
 * The body of the 502 thrown when the API answered 502 itself, which for this endpoint means IGDB
 * failed: the API turns a third party's failure into a 502 and nothing else into one (ADR 0034), and
 * the detail query is the one live IGDB call on this page (ADR 0017). The boundary reads it to say
 * whose failure it was, which decides what it can promise still works.
 */
const IGDB_UNAVAILABLE = 'IGDB did not answer.';

/** The hero's cover is 140px wide, 180px from 640px up, inside a two-pixel border. */
const HERO_COVER_SIZES = '(min-width: 640px) 176px, 136px';

function InfoChip({ label }: { label: string }) {
    return (
        <span className="px-2.5 py-1 bg-raised/60 text-fg-soft text-xs font-medium rounded-lg border border-line">
            {label}
        </span>
    );
}

/**
 * Fetched on the server so crawlers and social unfurlers see the real game, not an empty shell. A
 * missing or malformed id throws a 404 Response and a failure a 502, which this route's own
 * ErrorBoundary renders inside the site's frame and which reach the client as genuine statuses.
 */
export async function loader({ params }: Route.LoaderArgs) {
    const id = Number(params.id);

    // A thrown Response carries its own headers, and `headers` below hands them on. A 404 gets a
    // short shared TTL; a 502 gets none, because caching an upstream failure at the edge outlives
    // the failure itself.
    const notFound = () => new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Cache-Control': CACHE_NOT_FOUND },
    });

    if (!Number.isInteger(id) || id <= 0) throw notFound();

    const badGateway = (body = 'Failed to load game.') => new Response(body, {
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
    if (response.status === 502) throw badGateway(IGDB_UNAVAILABLE);

    // Our own throttle on IGDB refusing: the API's queue of calls to it was full (ADR 0034). Passed on
    // as itself, "busy, try shortly", which is what a 503 tells a crawler too, and never stored.
    if (response.status === 503) {
        throw new Response('Busy fetching game data.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Cache-Control': PRIVATE_NO_STORE },
        });
    }

    if (!response.ok) throw badGateway();

    // `site` rides along because `meta` runs in the browser too, where the environment it is read
    // from does not exist. The policy rides along so that `headers` has one to hand on only when the
    // loader answered.
    return data(
        { game: await response.json() as GameDto, site: siteConfig() },
        { headers: { 'Cache-Control': CACHE_GAME } },
    );
}

/**
 * Whatever the loader decided: the game's policy for a page it answered, the thrown Response's own for
 * a 404, a 502 or a 503, and nothing shared for anything else the loader throws.
 *
 * This route has an ErrorBoundary, so it is the boundary for its own failures and these are the
 * headers they go out with. Answering `CACHE_GAME` here unconditionally, as this used to, cached a
 * 502 for an hour at the edge — and already did for the `.data` request a client-side navigation
 * makes, which reaches this function whichever route renders the error. A loader that threw something
 * other than a Response leaves neither, and that fails closed, as the root's default does.
 *
 * Not covered here: a page that throws while rendering, after its loader answered, goes out with the
 * headers worked out before the render, which is React Router's doing and every route's (issue 337).
 */
export function headers({ errorHeaders, loaderHeaders }: Route.HeadersArgs) {
    return {
        'Cache-Control': errorHeaders?.get('Cache-Control')
            ?? loaderHeaders.get('Cache-Control')
            ?? PRIVATE_NO_STORE,
    };
}

export function meta({ loaderData, error }: Route.MetaArgs) {
    // Undefined when the loader threw, and the ErrorBoundary below supplies the page.
    if (!loaderData?.game) {
        const missing = isRouteErrorResponse(error) && error.status === 404;
        return [{ title: missing ? 'Game not found - MyVideoGameList' : 'Game unavailable - MyVideoGameList' }];
    }

    const { game, site } = loaderData;
    const year = game.releaseDate ? ` (${new Date(game.releaseDate).getFullYear()})` : '';
    const title = `${game.title}${year} - MyVideoGameList`;
    const description = game.description?.slice(0, 200)
        ?? `Track ${game.title} on MyVideoGameList.`;

    // Key art where IGDB has any, because a large card is cropped to a wide rectangle and a
    // portrait cover comes out of that as a strip across its middle. The cover still beats
    // nothing, as the small square card it fits.
    const image = game.backgroundImageUrl
        ? { url: game.backgroundImageUrl, alt: `${game.title} key art`, wide: true }
        : game.coverImageUrl
            ? { url: game.coverImageUrl, alt: `${game.title} cover`, wide: false }
            : null;

    // The path is built from the id the API answered with, not from the URL: `/games/0012` and
    // `/games/12?ref=x` both render this page, and both should say they are `/games/12`.
    return pageMeta({ site, title, description, path: `/games/${game.id}`, image });
}

export function GamePage() {
    const { game } = useLoaderData<typeof loader>();

    const { user, loading: authLoading } = useAuth();

    // Fetched after hydration and never in the loader — the page is edge-cached for up to a day, and
    // a review its author withdraws must not outlive the withdrawal there (ADR 0028). Called here
    // rather than in the section so the hero's badge and the section share one pair of requests,
    // and so the reader's own panel can ask for them again after it writes.
    const community = useGameCommunity(game.id);

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
                    {/* Cover. Loaded with the page, never lazily: it and the key art behind it are
                        this page's first screen, and one of the two is its largest first paint. */}
                    <div className="game-page-cover">
                        {game.coverImageUrl ? (
                            <CoverImage
                                url={game.coverImageUrl}
                                alt={`${game.title} cover`}
                                sizes={HERO_COVER_SIZES}
                                eager
                            />
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
                            className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-primary-400 transition-colors mb-2"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            Games
                        </Link>

                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-fg-strong leading-tight mb-2">
                            {game.title}
                            {releaseYear && (
                                <span className="text-fg-muted font-normal text-xl ml-2">({releaseYear})</span>
                            )}
                        </h1>

                        {/* A DLC or expansion page that does not say what it belongs to reads as a
                            standalone game with a strangely narrow scope. */}
                        {details?.parentGame && (
                            <p className="text-sm text-fg-muted mb-2">
                                Add-on for{' '}
                                <Link
                                    to={`/games/${details.parentGame.id}`}
                                    className="text-primary-400 hover:text-primary-300 font-medium transition-colors"
                                >
                                    {details.parentGame.name}
                                </Link>
                            </p>
                        )}

                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            {game.esrbRating && (
                                <span className="px-2 py-0.5 bg-surface/80 border border-line-strong text-fg-soft text-xs font-mono rounded">
                                    {game.esrbRating}
                                </span>
                            )}
                            {/* Every aggregate, on the one scale, side by side: they answer the
                                same question and used to be shown in two different languages.
                                Stars are the user's own score only — see ADR 0021. */}
                            {hasCriticScore(game) && (
                                <ScoreBadge
                                    kind="critics"
                                    percent={game.criticScore!}
                                    count={game.criticScoreCount}
                                />
                            )}
                            {game.rating !== null && (
                                <ScoreBadge
                                    kind="players"
                                    percent={ratingPercent(game.rating)}
                                    count={game.ratingCount}
                                />
                            )}
                            {/* Ours, once enough members have scored the game. Arrives after
                                hydration, so it goes after the two server-rendered badges rather
                                than moving them; only the date beside it shifts along. */}
                            {hasMemberScore(community.scores) && (
                                <ScoreBadge
                                    kind="members"
                                    percent={ratingPercent(community.scores.mean)}
                                    count={community.scores.scored}
                                />
                            )}
                            {releaseDate && (
                                <span className="text-fg-muted text-xs">{releaseDate}</span>
                            )}
                        </div>
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
                                <p className="text-fg-soft text-sm leading-relaxed whitespace-pre-line">
                                    {game.description}
                                </p>
                            </section>
                        )}

                        {/* The headline answer to "should I start this?", so it sits above the
                            taxonomy rather than below it. Renders its own section and decides for
                            itself whether it has anything to show — its second row comes from our
                            own members and is fetched on the client, so this cannot know. */}
                        <CompletionTimes timeToBeat={details?.timeToBeat ?? null} gameId={game.id} />

                        {/* Genres */}
                        {game.genres.length > 0 && (
                            <section>
                                <SectionHeading>Genres</SectionHeading>
                                <div className="flex flex-wrap gap-2">
                                    {game.genres.map(genre => (
                                        <span
                                            key={genre.id}
                                            className="px-3 py-1 bg-primary-900/40 text-primary-300 text-xs font-medium rounded-full border border-primary-800/50"
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
                                                    <span key={dev.id} className="text-fg-soft text-sm font-medium">
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
                                                    <span key={pub.id} className="text-fg-soft text-sm font-medium">
                                                        {pub.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Trailer. Keyed on the game, as the sidebar's panel is: this page stays
                            mounted from one game to the next, and a player still pressed for the
                            last game would load this one's from YouTube, and start it playing,
                            without anybody asking. */}
                        {youtubeEmbedId && (
                            <section>
                                <SectionHeading>Trailer</SectionHeading>
                                <TrailerPlayer
                                    key={game.id}
                                    videoId={youtubeEmbedId}
                                    title={game.title}
                                    poster={details?.screenshots[0] ?? game.backgroundImageUrl ?? null}
                                />
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

                        {/* Low in the column on purpose: it arrives after hydration, and all it can
                            push down when it does is the news and the similar games. Renders nothing
                            until both of its requests have answered, and nothing at all when there
                            is nothing to read. */}
                        <GameCommunity community={community} viewer={user?.userName ?? null} />

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
                        {/* Lists, score and the one control that erases both. Keyed on the account
                            and the game, so that either changing remounts it: the panel holds that
                            person's score, ownership, notes, playthroughs and review for that one
                            game, and every write it makes settles after the click. This page stays
                            mounted from one game to the next, so a panel that was not remounted
                            would write the previous game's saved value, or its error, into this
                            game's form — and a marker written from an effect lags the commit, which
                            is the window ADR 0022 records for the account.

                            Until auth answers, the slot holds the signed-out card with nothing in
                            it. That is every server render — the page is shared-cached, so it
                            cannot depend on who is asking — and the first client render, which
                            must match it. It keeps the card's size rather than taking the panel's,
                            because most visitors to a cached public page are signed out and so see
                            no shift at all; a signed-in visitor sees the panel grow into place, but
                            is never told to sign in first. */}
                        {!authLoading && user ? (
                            <GameUserPanel
                                key={`${user.id}:${game.id}`}
                                game={game}
                                profileVisibility={user.profileVisibility}
                                onCommunityChange={community.reload}
                            />
                        ) : (
                            <div className="bg-surface/60 border border-line rounded-xl p-5 text-center">
                                <p className="text-fg-muted text-xs mb-3">
                                    {authLoading ? <>&nbsp;</> : 'Sign in to track this game.'}
                                </p>
                            </div>
                        )}

                        {/* Info card */}
                        <div className="bg-surface/60 border border-line rounded-xl p-5 space-y-4">
                            {releaseDate && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Release Date</p>
                                    <p className="text-sm text-fg font-medium">{releaseDate}</p>
                                </div>
                            )}

                            {/* The one place the sample size is on the page rather than in a
                                tooltip. ADR 0016: a score without its count is not shippable. */}
                            {hasCriticScore(game) && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Critic Score</p>
                                    <ScoreBadge
                                        kind="critics"
                                        percent={game.criticScore!}
                                        count={game.criticScoreCount}
                                    />
                                    <span className="ml-2 text-xs text-fg-faint">
                                        from {formatCount(game.criticScoreCount!)} reviews
                                    </span>
                                </div>
                            )}

                            {game.rating !== null && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Player Rating</p>
                                    <ScoreBadge
                                        kind="players"
                                        percent={ratingPercent(game.rating)}
                                        count={game.ratingCount}
                                    />
                                    {game.ratingCount !== null && (
                                        <span className="ml-2 text-xs text-fg-faint">
                                            from {formatCount(game.ratingCount)} ratings
                                        </span>
                                    )}
                                </div>
                            )}

                            {game.esrbRating && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">ESRB Rating</p>
                                    <span className="px-2 py-0.5 bg-raised border border-line-strong text-fg text-sm font-mono rounded">
                                        {game.esrbRating}
                                    </span>
                                </div>
                            )}

                            {series.length > 0 && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Series</p>
                                    <p className="text-sm text-fg font-medium">
                                        {series.join(', ')}
                                    </p>
                                </div>
                            )}

                            {details && details.playerPerspectives.length > 0 && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Perspective</p>
                                    <p className="text-sm text-fg font-medium">
                                        {details.playerPerspectives.join(', ')}
                                    </p>
                                </div>
                            )}

                            {details && details.gameEngines.length > 0 && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">
                                        Engine{details.gameEngines.length > 1 ? 's' : ''}
                                    </p>
                                    <p className="text-sm text-fg font-medium">
                                        {details.gameEngines.join(', ')}
                                    </p>
                                </div>
                            )}

                            {/* A dozen-plus languages would dominate the sidebar, so they collapse.
                                A native <details> needs no JavaScript and so survives SSR intact. */}
                            {details && details.languages.length > 0 && (
                                <details className="group">
                                    <summary className="text-xs text-fg-faint uppercase tracking-wider cursor-pointer hover:text-fg-soft transition-colors">
                                        Languages ({details.languages.length})
                                    </summary>
                                    <ul className="mt-2 space-y-1.5">
                                        {details.languages.map(entry => (
                                            <li key={entry.language} className="text-xs">
                                                <span className="text-fg font-medium">
                                                    {entry.language}
                                                </span>
                                                {entry.supportTypes.length > 0 && (
                                                    <span className="text-fg-faint">
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
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Website</p>
                                    <a
                                        href={game.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors break-all"
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
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Trailer</p>
                                    <a
                                        href={game.trailerUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors"
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

/** A heroicon's path: a magnifying glass, for a game that is not where the link said. */
const SEARCH_ICON = 'M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z';

/**
 * What this page says when there is no game to show, inside the site's frame rather than in place of it,
 * so the navbar is still there to go somewhere that works.
 *
 * A failure is said as the lists page says one, with the retry the pattern gives: the loader is asked
 * again, and the game replaces this the moment it answers. Never a spinner or a blank — a reader cannot
 * tell either from a page that is still coming. What the failure says depends on whose it was: IGDB
 * being down costs every game page and nothing kept here, and saying so tells the reader where to go
 * meanwhile. A 404 offers no retry, because asking again will not make the game exist.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    const revalidator = useRevalidator();

    if (isRouteErrorResponse(error) && error.status === 404) {
        return (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <EmptyState
                    icon={SEARCH_ICON}
                    message="There is no game at this address"
                    titleAs="h1"
                    detail="The link may be mistyped, or IGDB, where every game here comes from, may have removed the game."
                >
                    <Link
                        to="/games"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-on-primary text-sm font-semibold rounded-lg transition-colors"
                    >
                        Browse games
                    </Link>
                </EmptyState>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <ErrorState
                title="Failed to load this game"
                titleAs="h1"
                onRetry={() => void revalidator.revalidate()}
                retrying={revalidator.state === 'loading'}
            >
                {whoseFailure(error)}
            </ErrorState>
        </div>
    );
}

/** What a failure to load the game was, as far as its status says, and so what still works. */
function whoseFailure(error: unknown): string {
    if (isRouteErrorResponse(error) && error.data === IGDB_UNAVAILABLE) {
        return 'Game details come from IGDB, which is not answering just now. Lists and profiles keep working without it.';
    }
    // The API's own words for its throttle, with what is unaffected put as this page puts it.
    if (isRouteErrorResponse(error) && error.status === 503) {
        return 'Too many people are browsing games at once. Try again in a moment; lists and profiles are unaffected.';
    }
    return 'Something went wrong on our side, so this game could not be loaded just now.';
}

export default GamePage;
