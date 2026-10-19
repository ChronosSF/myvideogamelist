import { Link, data, useLoaderData } from 'react-router';
import type { Route } from './+types/GamePage';
import { apiUrl } from '@/lib/api';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import type { CommunityScores } from '@/types/community';
import type { GameDto } from '@/types/game';
import type { CommunityTimes } from '@/types/playthrough';
import { useAuth } from '@/hooks/useAuth';
import { useGameCommunity } from '@/hooks/useGameCommunity';
import { GameNewsPanel } from '@/components/GameNewsPanel';
import { GameUserPanel } from '@/components/GameUserPanel';
import { GameCommunity } from '@/components/GameCommunity';
import { CompletionTimes } from '@/components/CompletionTimes';
import { SectionHeading } from '@/components/SectionHeading';
import { GameRefRail } from '@/components/GameRefRail';
import { MultiplayerSummary } from '@/components/MultiplayerSummary';
import { ScreenshotGallery } from '@/components/ScreenshotGallery';
import { StoreLinks } from '@/components/StoreLinks';
import { TrailerPlayer } from '@/components/TrailerPlayer';
import { formatCount } from '@/lib/format';
import { gameDescription } from '@/lib/gameDescription';
import { pageMeta, siteConfig } from '@/lib/seo';
import { hasCriticScore, hasMemberScore, ratingPercent, scoresWithinFloor, timesWithinFloor } from '@/lib/score';
import { gameStructuredData } from '@/lib/structuredData';
import { ScoreBadge } from '@/components/ScoreBadge';
import './GamePage.css';

function InfoChip({ label }: { label: string }) {
    return (
        <span className="px-2.5 py-1 bg-raised/60 text-fg-soft text-xs font-medium rounded-lg border border-line">
            {label}
        </span>
    );
}

/**
 * How long the loader waits for each of the members' figures before rendering without them.
 *
 * They are reads of our own tables that answer in milliseconds, and before them the game page did not
 * wait on the database at all. Without a deadline a slow database — a failover, a lock held by a
 * migration — would hold every game page for as long as Npgsql waits, and every one of those renders
 * is `no-store`, so the edge would absorb none of them. With one, a slow read is one more degraded
 * render, and the abort cancels the query behind it.
 */
const FIGURES_DEADLINE_MS = 1_000;

/**
 * A JSON body from the API as `accept` reads it, or null for a bad status, a body `accept` refuses,
 * a deadline passed and an unreachable API alike: for the reads a game page can stand without.
 */
async function readOptional<T>(path: string, accept: (body: unknown) => T | null): Promise<T | null> {
    try {
        const response = await fetch(apiUrl(path), { signal: AbortSignal.timeout(FIGURES_DEADLINE_MS) });
        return response.ok ? accept(await response.json()) : null;
    } catch {
        // `catch` as well as `ok`, because an unreachable API makes `fetch` reject rather than
        // return a bad response — and so do a deadline passed and a body that is not JSON.
        return null;
    }
}

/**
 * The members' scores, when the body has their shape, with what the floor keeps off the page taken
 * out: this copy is stored in the shared HTML and its data, so a lone member's score must not ride
 * along unseen (`scoresWithinFloor`). A body without `tracked` is kept — it is from an API older than
 * this build, and its badge is still right — and the loader treats it as incomplete.
 */
function scoresFrom(body: unknown): CommunityScores | null {
    const scores = body as Partial<CommunityScores> | null;
    if (typeof scores?.scored !== 'number' || !Array.isArray(scores.distribution)) return null;
    if (scores.mean !== null && typeof scores.mean !== 'number') return null;
    return scoresWithinFloor(scores as CommunityScores);
}

/** The members' completion times, when the body has their shape, each median behind its floor. */
function timesFrom(body: unknown): CommunityTimes | null {
    const times = body as Partial<CommunityTimes> | null;
    const buckets: unknown = times?.buckets;
    if (!Array.isArray(buckets)) return null;
    if (!buckets.every(bucket => typeof bucket?.type === 'string' && typeof bucket.samples === 'number')) return null;
    return timesWithinFloor(times as CommunityTimes);
}

/**
 * Fetched on the server so crawlers and social unfurlers see the real game, not an
 * empty shell. A missing or malformed id throws a 404 Response, which the root
 * ErrorBoundary renders and which returns a genuine 404 status.
 *
 * Beside the game, what members have made of it: their score and how many of them track it, and how
 * long they take to beat it. Those are the part of the page that is ours, so they are read here, where
 * the server render — the HTML a crawler indexes — can carry them, in the hero, the description and
 * the structured data (ADR 0069). Their reviews are not: review text is fetched after hydration, as
 * ADR 0028 decided, because an author's withdrawal must not wait out the page's hour at the edge. An
 * aggregate names nobody, so the same hour costs a reader no more than a figure up to an hour old,
 * which the browser's own request replaces once the page has hydrated.
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

    // All three at once: the members' figures do not wait on the game, and the game does not wait
    // on them. Neither of those two can fail the page, or hold it past their deadline.
    const [response, scores, times] = await Promise.all([
        // fetch rejects rather than returning !ok when the API is unreachable.
        fetch(apiUrl(`/api/games/${id}`)).catch(() => null),
        readOptional(`/api/games/${id}/community-scores`, scoresFrom),
        readOptional(`/api/games/${id}/community-times`, timesFrom),
    ]);

    if (response === null) throw badGateway();
    if (response.status === 404) throw notFound();
    if (!response.ok) throw badGateway();

    // Only a whole render is shared. Without the members' figures the page still stands — the game is
    // what it is about, and it came — but kept at the edge it would go on leaving out our score, the
    // description's lead and the structured data's rating for an hour after the API recovered, and a
    // day stale after that: caching a failure outlives the failure (ADR 0013). An answer with no
    // tracked count is from an API older than this build, in the middle of a deploy, and is missing a
    // part all the same.
    const whole = scores !== null && typeof scores.tracked === 'number' && times !== null;

    // `site` rides along because `meta` runs in the browser too, where the environment it is read
    // from does not exist; `today` because a day read in `meta` could differ between the render and
    // the hydration. UTC, which is the calendar the API's release dates are written in.
    return data(
        {
            game: await response.json() as GameDto,
            site: siteConfig(),
            scores,
            times,
            today: new Date().toISOString().slice(0, 10),
        },
        { headers: { 'Cache-Control': whole ? CACHE_GAME : PRIVATE_NO_STORE } },
    );
}

/**
 * The loader's policy: the game's hour when the render is whole, none when the members' figures did
 * not arrive. A thrown Response carries its own headers, so a 404 for an unknown id is not cached
 * for an hour under this one.
 *
 * The loader states a policy on every return, so the fallback is for a loader that has stopped doing
 * so, and it fails closed as the root does.
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return { 'Cache-Control': loaderHeaders.get('Cache-Control') ?? PRIVATE_NO_STORE };
}

export function meta({ loaderData }: Route.MetaArgs) {
    if (!loaderData?.game) return [{ title: 'Game not found - MyVideoGameList' }];

    // The defaults are for data written by the build before this one, which had none of the three:
    // a game page's data is shared-cached, so in a deploy's first minutes such a copy can reach this
    // code. Each one missing leaves out what it would have added, and nothing fails.
    const { game, site, scores = null, times = null, today = '' } = loaderData;
    const year = game.releaseDate ? ` (${new Date(game.releaseDate).getFullYear()})` : '';
    const title = `${game.title}${year} - MyVideoGameList`;
    const description = gameDescription(game, scores, times);

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
    const path = `/games/${game.id}`;

    return [
        ...pageMeta({ site, title, description, path, image }),
        ...gameStructuredData({ site, path, game, scores, today }),
    ];
}

export function GamePage() {
    // The default is `meta`'s: data from the build before this one has no scores in it.
    const { game, scores: renderedScores = null } = useLoaderData<typeof loader>();

    const { user, loading: authLoading } = useAuth();

    // The reviews are fetched here, after hydration, and never in the loader — the page is
    // edge-cached for up to a day, and a review its author withdraws must not outlive the withdrawal
    // there (ADR 0028). The scores come with them, live, over the loader's copy. Called here rather
    // than in the section so the hero's badge and the section share one pair of requests, and so the
    // reader's own panel can ask for them again after it writes.
    const community = useGameCommunity(game.id);

    // The members' score as the loader read it, which is what the server rendered, until the
    // browser's own request answers — then that one, which is fresher, and which the reader's own
    // writes ask for again. A request that fails leaves the loader's in place rather than taking the
    // badge away. Both belong to the game on screen: the loader's data and the hook change together
    // when a link goes from one game to another.
    const memberScores = community.scores ?? renderedScores;

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
                            {/* Ours, once enough members have scored the game, and in the server
                                render: it is the one score on the page this site produced, so it is
                                in the HTML a crawler reads (ADR 0069). Last of the three, so that
                                the browser's fresher figure replacing the loader's after hydration
                                moves nothing but the date beside it. */}
                            {hasMemberScore(memberScores) && (
                                <ScoreBadge
                                    kind="members"
                                    percent={ratingPercent(memberScores.mean)}
                                    count={memberScores.scored}
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

                        {/* Where it is sold, next to what it runs on. Hides itself when IGDB names
                            no store. */}
                        <StoreLinks stores={details?.stores ?? []} />

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
                            is nothing to read. Handed the scores the hero shows, so that a request
                            that failed leaves the two agreeing on the loader's figure. */}
                        <GameCommunity
                            community={{ ...community, scores: memberScores }}
                            viewer={user?.userName ?? null}
                        />

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
                                    <span className="ml-2 text-xs text-fg-faint" aria-hidden="true">
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
                                        <span className="ml-2 text-xs text-fg-faint" aria-hidden="true">
                                            from {formatCount(game.ratingCount)} ratings
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Ours, with its count in words beside it like the two above, and in the
                                server render like them. Google shows a rating from structured data
                                only when a reader can see it on the page (ADR 0069). Each count is for
                                the eye only: the badge's accessible name already ends with it. */}
                            {hasMemberScore(memberScores) && (
                                <div>
                                    <p className="text-xs text-fg-faint uppercase tracking-wider mb-1">Member Score</p>
                                    <ScoreBadge
                                        kind="members"
                                        percent={ratingPercent(memberScores.mean)}
                                        count={memberScores.scored}
                                    />
                                    <span className="ml-2 text-xs text-fg-faint" aria-hidden="true">
                                        from {formatCount(memberScores.scored)} scores
                                    </span>
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

export default GamePage;
