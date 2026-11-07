import type { ReactNode } from 'react';
import { Link, Outlet, data, isRouteErrorResponse, useLoaderData, useMatch, useRevalidator, type RouterContextProvider } from 'react-router';
import type { Route } from './+types/GamePage';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { isUpstreamFailure } from '@/lib/trace';
import { loaderFetch, upstreamFailure } from '@/lib/trace.server';
import type { CommunityScores } from '@/types/community';
import type { GameDto } from '@/types/game';
import type { CommunityTimes } from '@/types/playthrough';
import { useAuth } from '@/hooks/useAuth';
import { useGameCommunity } from '@/hooks/useGameCommunity';
import { GameEntryProvider } from '@/contexts/GameEntryProvider';
import { CoverImage } from '@/components/CoverImage';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { GameTrackingRow } from '@/components/GameTrackingRow';
import { PageTabs } from '@/components/PageTabs';
import { releaseDay, releaseYear, titleAndYear } from '@/lib/releaseDate';
import type { GamePageOutlet } from '@/lib/gamePage';
import type { PagePatternHandle } from '@/lib/pagePattern';
import { gameDescription } from '@/lib/gameDescription';
import { pageMeta, siteConfig } from '@/lib/seo';
import { hasCriticScore, hasMemberScore, ratingPercent, scoresWithinFloor, timesWithinFloor } from '@/lib/score';
import { gameStructuredData } from '@/lib/structuredData';
import { ScoreBadge } from '@/components/ScoreBadge';
import './GamePage.css';

/**
 * The message of the 502 thrown when the API answered 502 itself, which for this endpoint means IGDB
 * failed: the API turns a third party's failure into a 502 and nothing else into one (ADR 0034), and
 * the detail query is the one live IGDB call on this page (ADR 0017). It goes out as every failed
 * call's does, with the trace id (`upstreamFailure`, ADR 0059), and the boundary reads it to say whose
 * failure it was, which decides what it can promise still works.
 */
const IGDB_UNAVAILABLE = 'IGDB did not answer.';

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
async function readOptional<T>(
    context: Readonly<RouterContextProvider>,
    path: string,
    accept: (body: unknown) => T | null,
): Promise<T | null> {
    try {
        const response = await loaderFetch(context, path, { signal: AbortSignal.timeout(FIGURES_DEADLINE_MS) });
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
 * The hero is opaque and stands where the top of the page's pattern is drawn, so that end is not drawn on
 * this page, either tab: all that showed of it was its faint tail under the tabs, beside whatever art the
 * game has (ADR 0084). The foot's is.
 */
export const handle: PagePatternHandle = { pagePattern: 'foot' };

/**
 * Fetched on the server so crawlers and social unfurlers see the real game, not an empty shell. A
 * missing or malformed id throws a 404 Response and a failure a 502, which this route's own
 * ErrorBoundary renders inside the site's frame and which reach the client as genuine statuses.
 *
 * Beside the game, what members have made of it: their score and how many of them track it, and how
 * long they take to beat it. Those are the part of the page that is ours, so they are read here, where
 * the server render — the HTML a crawler indexes — can carry them, in the hero, the description and
 * the structured data (ADR 0069). Their reviews are not: review text is fetched after hydration, as
 * ADR 0028 decided, because an author's withdrawal must not wait out the page's hour at the edge. An
 * aggregate names nobody, so the same hour costs a reader no more than a figure up to an hour old,
 * which the browser's own request replaces once the page has hydrated.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
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

    const badGateway = (message = 'Failed to load game.') => upstreamFailure(context, message);

    // All three at once: the members' figures do not wait on the game, and the game does not wait
    // on them. Neither of those two can fail the page, or hold it past their deadline.
    const [response, scores, times] = await Promise.all([
        // fetch rejects rather than returning !ok when the API is unreachable.
        loaderFetch(context, `/api/games/${id}`).catch(() => null),
        readOptional(context, `/api/games/${id}/community-scores`, scoresFrom),
        readOptional(context, `/api/games/${id}/community-times`, timesFrom),
    ]);

    if (response === null) throw badGateway();
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

    const game = await response.json() as GameDto;

    // Only a whole render is shared. Without the members' figures the page still stands — the game is
    // what it is about, and it came — but kept at the edge it would go on leaving out our score, the
    // description's lead and the structured data's rating for an hour after the API recovered, and a
    // day stale after that: caching a failure outlives the failure (ADR 0013). An answer with no
    // tracked count is from an API older than this build, in the middle of a deploy, and is missing a
    // part all the same. So is a game whose related games IGDB did not answer for (ADR 0084): the API
    // says so with a null, and one older than this build sends none at all.
    const whole = scores !== null && typeof scores.tracked === 'number' && times !== null
        && game.details?.related != null;

    // `site` rides along because `meta` runs in the browser too, where the environment it is read
    // from does not exist; `today` because a day read in `meta` could differ between the render and
    // the hydration. UTC, which is the calendar the API's release dates are written in. The policy
    // rides along so that `headers` has one to hand on only when the loader answered.
    return data(
        {
            game,
            site: siteConfig(),
            scores,
            times,
            today: new Date().toISOString().slice(0, 10),
        },
        { headers: { 'Cache-Control': whole ? CACHE_GAME : PRIVATE_NO_STORE } },
    );
}

/**
 * Whatever the loader decided: the game's hour for a page it answered whole and nothing shared for one
 * the members' figures did not reach, the thrown Response's own for a 404, a 502 or a 503, and nothing
 * shared for anything else the loader throws.
 *
 * This route has an ErrorBoundary, so it is the boundary for its own failures and these are the
 * headers they go out with. Answering `CACHE_GAME` here unconditionally, as this used to, cached a
 * 502 for an hour at the edge — and already did for the `.data` request a client-side navigation
 * makes, which reaches this function whichever route renders the error. A loader that threw something
 * other than a Response leaves neither, and that fails closed, as the root's default does.
 *
 * Not covered here: a page that throws while rendering, after its loader answered, is rendered as this
 * route's boundary over what this answered for the page that worked — the game's hour included, since
 * React Router works headers out before it renders. `entry.server.tsx` makes that 500 `private,
 * no-store` itself, for every route (issue 337).
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

    // The defaults are for data written by the build before this one, which had none of the three:
    // a game page's data is shared-cached, so in a deploy's first minutes such a copy can reach this
    // code. Each one missing leaves out what it would have added, and nothing fails.
    const { game, site, scores = null, times = null, today = '' } = loaderData;
    // The year of the day the API names, which `new Date` would make the year before on 1 January
    // west of Greenwich: in the browser, where this runs too, so the title changed on hydration.
    const title = `${titleAndYear(game)} - MyVideoGameList`;
    const description = gameDescription(game, scores, times);

    // Key art where IGDB has any, because a large card is cropped to a wide rectangle and a
    // portrait cover comes out of that as a strip across its middle. The cover still beats the
    // site's default, as the small square card it fits; with neither, `pageMeta` shares the default.
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
    // reader's own entry can ask for them again after it writes.
    const community = useGameCommunity(game.id);

    // The members' score as the loader read it, which is what the server rendered, until the
    // browser's own request answers — then that one, which is fresher, and which the reader's own
    // writes ask for again. A request that fails leaves the loader's in place rather than taking the
    // badge away. Both belong to the game on screen: the loader's data and the hook change together
    // when a link goes from one game to another.
    const memberScores = community.scores ?? renderedScores;

    const yours = useMatch('/games/:id/yours') !== null;

    const outlet: GamePageOutlet = { game, memberScores, community };

    const body = (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <Outlet context={outlet} />
        </div>
    );

    // The hero, the tabs and the Your game tab are drawn from the reader's own entry, read once for all
    // three. Keyed on the account and the game, so that either changing remounts it: every write it makes
    // settles after the click, and this page stays mounted from one game to the next (ADR 0022). The
    // Overview tab sits outside it, so that a signed-in reader's arrival after hydration remounts the hero
    // and nothing it would have to fetch again.
    const top = (
        <>
            <GameHero game={game} memberScores={memberScores}>
                <GameTrackingRow game={game} authLoading={authLoading} linkToYours={!yours} />
            </GameHero>
            <PageTabs
                label="This game"
                tabs={[
                    { to: `/games/${game.id}`, label: 'Overview', end: true },
                    { to: `/games/${game.id}/yours`, label: 'Your game' },
                ]}
            />
            {yours && body}
        </>
    );

    return (
        <div className="min-h-screen">
            {!authLoading && user ? (
                <GameEntryProvider
                    key={`${user.id}:${game.id}`}
                    game={game}
                    profileVisibility={user.profileVisibility}
                    onCommunityChange={community.reload}
                >
                    {top}
                </GameEntryProvider>
            ) : top}
            {!yours && body}
        </div>
    );
}

/** The hero's cover is 140px wide, 180px from 640px up, with no border inside it. */
const HERO_COVER_SIZES = '(min-width: 640px) 180px, 140px';

interface GameHeroProps {
    game: GameDto;
    memberScores: CommunityScores | null;
    /** The reader's own controls, under the title and the scores. */
    children: ReactNode;
}

/**
 * The game's art across the page, its cover, its title and every aggregate score, and under them the
 * reader's own controls (ADR 0084): shorter than it was, so that the series under the tabs is in view
 * before any scrolling.
 */
function GameHero({ game, memberScores, children }: GameHeroProps) {
    const details = game.details;

    // The day the API names, which `new Date` would read as UTC midnight: the day before, and a
    // year before on 1 January, for anybody west of Greenwich, and a different day on the server.
    const year = game.releaseDate ? releaseYear(game.releaseDate) : null;
    const releaseDate = releaseDay(game.releaseDate);

    return (
        <div className="game-page-hero">
            {/* An image rather than a CSS background, which the browser asks for only once the page is laid
                out, after the scripts, the fonts and the rail's covers. As an image in the HTML it is found as
                the document is read, and asked for first: it is the page's largest first paint. */}
            {game.backgroundImageUrl && (
                <img className="game-page-hero-bg" src={game.backgroundImageUrl} alt="" fetchPriority="high" />
            )}
            <div className="game-page-hero-gradient" aria-hidden="true" />

            <div className="game-page-hero-content">
                {/* Cover. Loaded with the page, never lazily: it and the key art behind it are this
                    page's first screen, and one of the two is its largest first paint. */}
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

                <div className="flex-1 min-w-0">
                    <Link
                        to="/games"
                        className="inline-flex items-center gap-1 type-kicker text-fg-soft hover:text-fg-strong transition-colors mb-3"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Games
                    </Link>

                    <h1 className="type-display text-4xl sm:text-5xl lg:text-6xl text-fg-strong text-balance mb-3 [text-shadow:0_2px_24px_rgb(0_0_0/0.5)]">
                        {game.title}
                        {year && (
                            <span className="ml-3 font-mono text-lg sm:text-xl font-normal tracking-normal text-fg-soft align-middle">({year})</span>
                        )}
                    </h1>

                    {/* A DLC or expansion page that does not say what it belongs to reads as a standalone
                        game with a strangely narrow scope. */}
                    {details?.parentGame && (
                        <p className="text-sm text-fg-soft mb-3">
                            Add-on for{' '}
                            <Link to={`/games/${details.parentGame.id}`} className="font-semibold text-link">
                                {details.parentGame.name}
                            </Link>
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        {game.esrbRating && (
                            <span className="px-2 py-0.5 bg-sunken/70 border border-line-strong text-fg-soft type-meta rounded-sm">
                                {game.esrbRating}
                            </span>
                        )}
                        {/* Every aggregate, on the one scale, side by side: they answer the same question
                            and used to be shown in two different languages. Stars are the user's own score
                            only — the row under them — see ADR 0021. */}
                        {hasCriticScore(game) && (
                            <ScoreBadge kind="critics" percent={game.criticScore!} count={game.criticScoreCount} />
                        )}
                        {game.rating !== null && (
                            <ScoreBadge kind="players" percent={ratingPercent(game.rating)} count={game.ratingCount} />
                        )}
                        {/* Ours, once enough members have scored the game, and in the server render: it is
                            the one score on the page this site produced, so it is in the HTML a crawler
                            reads (ADR 0069). Last of the three, so that the browser's fresher figure
                            replacing the loader's after hydration moves nothing but the date beside it. */}
                        {hasMemberScore(memberScores) && (
                            <ScoreBadge kind="members" percent={ratingPercent(memberScores.mean)} count={memberScores.scored} />
                        )}
                        {releaseDate && (
                            <span className="type-meta text-fg-soft">{releaseDate}</span>
                        )}
                    </div>

                    {children}
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
                        className="inline-flex items-center gap-1.5 px-4 py-2 btn-primary text-sm"
                    >
                        Browse games
                    </Link>
                </EmptyState>
            </div>
        );
    }

    // The id of the request that failed, when the failure says, as the root's boundary shows it: this
    // one takes the root's place for this page's failures, and the id is what a report can quote.
    const reference = isRouteErrorResponse(error) && isUpstreamFailure(error.data) ? error.data.traceId : null;

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <ErrorState
                title="Failed to load this game"
                titleAs="h1"
                onRetry={() => void revalidator.revalidate()}
                retrying={revalidator.state === 'loading'}
                reference={reference}
            >
                {whoseFailure(error)}
            </ErrorState>
        </div>
    );
}

/** What a failure to load the game was, as far as its status says, and so what still works. */
function whoseFailure(error: unknown): string {
    if (isRouteErrorResponse(error) && isUpstreamFailure(error.data) && error.data.message === IGDB_UNAVAILABLE) {
        return 'Game details come from IGDB, which is not answering just now. Lists and profiles keep working without it.';
    }
    // The API's own words for its throttle, with what is unaffected put as this page puts it.
    if (isRouteErrorResponse(error) && error.status === 503) {
        return 'Too many people are browsing games at once. Try again in a moment; lists and profiles are unaffected.';
    }
    return 'Something went wrong on our side, so this game could not be loaded just now.';
}

export default GamePage;
