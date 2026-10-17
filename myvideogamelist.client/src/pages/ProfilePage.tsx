import { Link, data, isRouteErrorResponse, useParams, useRevalidator } from 'react-router';
import { apiUrl } from '@/lib/api';
import { CACHE_NOT_FOUND, CACHE_PROFILE, PRIVATE_NO_STORE } from '@/lib/cache';
import { lastPage, pageFrom, pageSearch } from '@/lib/paging';
import { type SiteConfig, NOINDEX, pageMeta, siteConfig } from '@/lib/seo';
import { formatDate, formatHours, formatRate } from '@/lib/stats';
import { MAX_SCORE } from '@/lib/score';
import type { PublicFavourites, PublicProfile, PublicReviews } from '@/types/profile';
import { ActivityChart } from '@/components/ActivityChart';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { ProfileFavourites } from '@/components/ProfileFavourites';
import { ScoreHistogram } from '@/components/ScoreHistogram';
import { StatTile } from '@/components/StatTile';
import { StatusBreakdown } from '@/components/StatusBreakdown';
import { PublicReviewList } from '@/components/PublicReviewList';
import type { Route } from './+types/ProfilePage';
import '@/components/ProfileStats.css';
import './ProfilePage.css';

/** A heroicon's path: a bar chart, for a profile with nothing to count yet. */
const CHART_ICON = 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z';

/** A heroicon's path: a person's outline, for a profile that is not there to show. */
const USER_ICON = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z';

/**
 * The body of the 404 for a `?page=` that names no page of reviews, which the boundary words apart from
 * the profile's own 404. It is still the same 404 that ADR 0027 §9 makes it, in status and in caching;
 * only the words differ. Telling the two apart gives nothing away (§7): a malformed page is refused
 * before the profile is asked for, whoever the name belongs to, and a page past the last only once the
 * profile has answered, so its owner has already made it public.
 */
const NO_SUCH_PAGE = 'No such page of reviews.';

interface ProfilePageData {
    profile: PublicProfile;
    /** Null when the reviews request failed. Not the same as having written none. */
    reviews: PublicReviews | null;
    /** Null when the favourites request failed. Not the same as having none. */
    favourites: PublicFavourites | null;
    /** Which page of reviews this is. Everything above the reviews is the same on every one. */
    page: number;
    /** For `meta`, which also runs in the browser and cannot read the environment there. */
    site: SiteConfig;
}

/**
 * Shared-cacheable, because this page is identical for every reader.
 *
 * That is a property of the endpoints behind it rather than a hope: `/api/users/{name}` is
 * anonymous and varies on nothing but the name, and the loader below sends no credentials — the
 * profile's own owner sees exactly what a stranger sees, and their private figures live on
 * `/user`. If this page ever grows a per-viewer state such as "you follow this person", that stops
 * being true and this policy has to change with it.
 *
 * It does vary on `?page=`, which pages the reviews. **The CloudFront cache key for this route must
 * include `page`**, the same rule `/games` has for `search`, or every visitor is served whichever
 * page populated the edge first.
 *
 * The loader overrides it when the reviews or the favourites failed, for the reason the home page
 * does: caching a degraded render pins the failure at the edge long after the failure is over.
 *
 * The loader states a policy on every answer, and a thrown 404 or 502 carries its own, so the
 * fallback is reached only by a loader that threw something else. It fails closed, as the root does:
 * this route has its own ErrorBoundary, so these are the headers its failures go out with, and
 * `CACHE_PROFILE` there would keep a broken page at the edge for an hour.
 */
export function headers({ errorHeaders, loaderHeaders }: Route.HeadersArgs) {
    return {
        'Cache-Control': errorHeaders?.get('Cache-Control')
            ?? loaderHeaders.get('Cache-Control')
            ?? PRIVATE_NO_STORE,
    };
}

export function meta({ loaderData, error }: Route.MetaArgs) {
    // Undefined when the loader threw, in which case the error boundary supplies the page.
    if (!loaderData?.profile) {
        const missing = isRouteErrorResponse(error) && error.status === 404;
        return [{ title: missing ? 'Profile not found - MyVideoGameList' : 'Profile unavailable - MyVideoGameList' }];
    }

    const { profile, page, site } = loaderData;
    // Each page of reviews is its own URL, so each gets its own title: two pages indexed under one
    // title read as duplicates of each other.
    const title = page > 1
        ? `${profile.userName}, reviews page ${page} - MyVideoGameList`
        : `${profile.userName} - MyVideoGameList`;
    const finished = profile.library.byStatus.finished;
    const description = `${profile.userName} has finished ${finished} `
        + `${finished === 1 ? 'game' : 'games'} and is tracking ${profile.library.tracked} `
        + 'on MyVideoGameList.';

    // Published, with nothing on it yet. A page of zeroes is not worth a place in an index, and it
    // leaves by itself the moment its owner records anything. **`SitemapService.ListedProfiles` is
    // the same test on the server**, and the two have to agree: a sitemap that lists a page marked
    // `noindex` is reported as an error for every such page.
    if (profile.library.recorded === 0 && profile.favourites === 0) {
        return [{ title }, { name: 'description', content: description }, NOINDEX];
    }

    return [
        ...pageMeta({
            site,
            title,
            description,
            // The name as its owner capitalised it, which is what the API answers with whatever the
            // URL said: the lookup ignores case, so `/u/ALICE` renders too, and this is what says
            // the two are one page. Each page of reviews is a document of its own and says so.
            path: `/u/${encodeURIComponent(profile.userName)}${pageSearch(page)}`,
            type: 'profile',
        }),
        { property: 'profile:username', content: profile.userName },
    ];
}

/**
 * Three requests, and only one of them may fail the page.
 *
 * The profile itself touches no third party, so it either answers or the profile is not there. The
 * reviews and the favourites need game titles and covers from IGDB, so they can fail while
 * everything else is fine — and they are still fetched here rather than after hydration, because the
 * reviews are the text a crawler came for (ROADMAP D8/D9), and text loaded by an effect is text that
 * was not indexed. The same reasoning is why the pages of them are URLs rather than a "load more"
 * button. The favourites ride along for the same reason and because a row of covers arriving after
 * the page would push the whole profile down under the reader.
 *
 * A private profile and an unclaimed username are both a 404 from the API, deliberately, and both
 * become the same page here.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
    const userName = encodeURIComponent(params.userName);

    // A thrown Response carries its own headers, and `headers` above hands them on. A 404 gets a
    // short shared TTL; a 502 gets none, because caching an upstream failure outlives the failure.
    const notFound = (body = 'Not Found') => new Response(body, {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Cache-Control': CACHE_NOT_FOUND },
    });

    const badGateway = () => new Response('Failed to load profile.', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Cache-Control': PRIVATE_NO_STORE },
    });

    // `?page=` names a page of reviews or it names nothing, and nothing is a 404 like any other
    // URL that resolves to no resource. There are unboundedly many malformed and out-of-range
    // values, and a crawler must not be handed a 200 for each of them.
    const page = pageFrom(new URL(request.url).searchParams.get('page'));
    if (page === null) throw notFound(NO_SUCH_PAGE);

    // `allSettled` rather than `all`: a rejection from the reviews or the favourites request must not
    // take the profile down with it, and `all` rejects on the first of any.
    const [profileResult, reviewsResult, favouritesResult] = await Promise.allSettled([
        fetch(apiUrl(`/api/users/${userName}`)),
        fetch(apiUrl(`/api/users/${userName}/reviews?page=${page}`)),
        fetch(apiUrl(`/api/users/${userName}/favourites`)),
    ]);

    // A rejection is the unreachable-API case, which `!response.ok` never reports.
    if (profileResult.status === 'rejected') throw badGateway();
    if (profileResult.value.status === 404) throw notFound();
    if (!profileResult.value.ok) throw badGateway();

    const profile = await profileResult.value.json() as PublicProfile;

    // Anything short of a 200 here costs the review list and nothing else.
    const reviews = reviewsResult.status === 'fulfilled' && reviewsResult.value.ok
        ? await reviewsResult.value.json() as PublicReviews
        : null;

    // Past the last page is the same 404, judged from the response rather than from a page-size
    // constant this file would otherwise have to keep in step with the server. When the reviews
    // request failed there is nothing to judge by, and the degraded page renders as it would for
    // page one — uncached, so the failure is not pinned at the edge under this URL either.
    if (reviews !== null && page > lastPage(reviews.total, reviews.pageSize)) throw notFound(NO_SUCH_PAGE);

    const favourites = favouritesResult.status === 'fulfilled' && favouritesResult.value.ok
        ? await favouritesResult.value.json() as PublicFavourites
        : null;

    // A failed favourites request degrades the render only for somebody who has favourites; for
    // anybody else the page is the same either way, and there is no failure in it to pin. An answer
    // that resolved none of them reads the same on the page and counts the same here: the service
    // leaves out a row IGDB cannot resolve, and such gaps have been transient before.
    const noFavouritesResolved = profile.favourites > 0 && (favourites?.games.length ?? 0) === 0;
    const degraded = reviews === null || noFavouritesResolved;

    return data<ProfilePageData>(
        { profile, reviews, favourites, page, site: siteConfig() },
        { headers: { 'Cache-Control': degraded ? PRIVATE_NO_STORE : CACHE_PROFILE } },
    );
}

export function ProfilePage({ loaderData }: Route.ComponentProps) {
    const { profile, reviews, favourites } = loaderData;
    const { activity, library, scores, playtime } = profile;

    // Published, with nothing on it at all: nothing recorded, wished for or chosen as a favourite, and
    // no month with anything in it. A page of dashes and empty bars would be noise where one sentence
    // is the whole answer, as the owner's own profile judges the same case. Narrower than `meta`'s test,
    // which is about a search index: a wishlist alone is not worth indexing, but it is something to
    // show — its size, under the bars — so a profile with one keeps its sections.
    const nothingAtAll = library.recorded === 0
        && library.wishlisted === 0
        && profile.favourites === 0
        && activity.trackingSince === null
        && activity.months.length === 0;

    return (
        <div className="public-profile">
            <div className="public-profile-inner">
                <header className="public-profile-header">
                    <span className="public-profile-avatar" aria-hidden="true">
                        {profile.userName.charAt(0).toUpperCase()}
                    </span>
                    <div>
                        <h1 className="public-profile-name">{profile.userName}</h1>
                        {/* Not a join date — there is no such column, and inventing one for
                            accounts that predate it would be inventing a fact. It is the first
                            status change, never an imported date (ADR 0047), so a library that was
                            imported and never moved has none — and is not "nothing tracked" either,
                            with its games on the page below. That case says nothing rather than
                            something untrue. A profile with nothing at all says so once, below. */}
                        {activity.trackingSince !== null ? (
                            <p className="public-profile-since">
                                {`Tracking games here since ${formatDate(activity.trackingSince)}.`}
                            </p>
                        ) : library.recorded === 0 && !nothingAtAll ? (
                            <p className="public-profile-since">Has not tracked anything here yet.</p>
                        ) : null}
                    </div>
                </header>

                {/* In the lists page's voice: what is not here, and what would put something here.
                    Said to whoever is reading, who is usually not its owner, so it tells them what the
                    page will show and never asks them to do anything. */}
                {nothingAtAll ? (
                    <EmptyState
                        icon={CHART_ICON}
                        message={`${profile.userName} has not tracked anything here yet.`}
                        detail="Once they add games to their lists, this page will show what they play and finish, how they score games, and the reviews they publish."
                    />
                ) : (
                    <section className="profile-stats">
                        {/* First, before any figure: the favourites are the one part of a profile its
                            owner chose in order to be looked at. */}
                        <ProfileFavourites
                            userName={profile.userName}
                            count={profile.favourites}
                            favourites={favourites}
                        />

                        <div className="profile-tiles">
                            <StatTile
                                label="games tracked"
                                value={String(library.tracked)}
                                hint={library.recorded === library.tracked
                                    ? 'across the five lists'
                                    : `across the five lists, ${library.recorded} recorded in all`}
                            />
                            <StatTile
                                label="completion rate"
                                value={library.completionRate === null
                                    ? null
                                    : formatRate(library.completionRate)}
                                hint={library.completionRate === null
                                    ? 'nothing finished or dropped yet'
                                    : 'of the games they have finished or dropped'}
                            />
                            <StatTile
                                label="mean score"
                                value={scores.mean === null ? null : scores.mean.toFixed(1)}
                                hint={scores.mean === null
                                    ? 'no scores yet'
                                    : `out of ${MAX_SCORE}, over ${scores.scored} `
                                        + `${scores.scored === 1 ? 'game' : 'games'}`}
                            />
                            <StatTile
                                label="hours logged"
                                value={playtime.withHours === 0
                                    ? null
                                    : formatHours(playtime.totalMinutes / 60)}
                                hint={playtime.withHours === 0
                                    ? 'no playthroughs with hours on them'
                                    : `over ${playtime.withHours} of ${playtime.playthroughs} `
                                        + `${playtime.playthroughs === 1 ? 'playthrough' : 'playthroughs'}`}
                            />
                        </div>

                        {/* Paired as they are on the owner's own profile, so the two stay one layout. */}
                        <div className="profile-columns">
                            <StatusBreakdown
                                title="Where their games sit"
                                byStatus={library.byStatus}
                                caption={library.wishlisted === 0
                                    ? 'Nothing on their wishlist. It is a separate axis, so a wishlisted game can also sit in one of these.'
                                    : `Plus ${library.wishlisted} on their wishlist, which is a separate axis — a game can be on it and in a list at once.`}
                            />

                            <section className="profile-section">
                                <h3 className="profile-section-title">How they score</h3>
                                <ScoreHistogram scores={scores} owner={profile.userName} />
                            </section>
                        </div>

                        <section className="profile-section">
                            <h3 className="profile-section-title">What they start and finish</h3>
                            {activity.months.length === 0 ? (
                                <p className="profile-empty">
                                    No status changes or playthrough dates recorded yet. The games they
                                    start, finish and drop will show here, month by month.
                                </p>
                            ) : <ActivityChart months={activity.months} />}
                            {activity.longestStreakMonths > 0 && (
                                <p className="profile-caption">
                                    {activity.currentStreakMonths > 0
                                        ? `On a ${activity.currentStreakMonths}-month finishing streak. `
                                        : 'Not on a finishing streak right now. '}
                                    {`Their longest is ${activity.longestStreakMonths} months.`}
                                </p>
                            )}
                        </section>

                        <PublicReviewList
                            userName={profile.userName}
                            reviews={reviews}
                            total={profile.reviews}
                        />
                    </section>
                )}

                <p className="public-profile-footer">
                    <Link to="/games">Browse games on MyVideoGameList</Link>
                </p>
            </div>
        </div>
    );
}

/**
 * What this page says when there is no profile to show, inside the site's frame rather than in place
 * of it.
 *
 * A private profile and an unclaimed name are one 404 on purpose (ADR 0027 §7), so the words fit both
 * and tell nobody which it was: what would put a profile here is its owner making it public under the
 * name they have now, and that is what is said. A page of reviews that is not there is the same 404 with
 * words of its own, which give nothing away — see `NO_SUCH_PAGE`. A failure is said as the lists page
 * says one, with its retry. The profile needs nothing from IGDB, so a failure here is ours.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    const revalidator = useRevalidator();
    const { userName = '' } = useParams();
    const button = 'inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-on-primary text-sm font-semibold rounded-lg transition-colors';

    return (
        <div className="public-profile">
            <div className="public-profile-inner">
                {isRouteErrorResponse(error) && error.status === 404 && error.data === NO_SUCH_PAGE ? (
                    <EmptyState
                        icon={USER_ICON}
                        message="There is no such page of reviews"
                        titleAs="h1"
                        detail="This address asks for a page of reviews that is not there: past the last one, or not a page number at all."
                    >
                        <Link to={`/u/${encodeURIComponent(userName)}`} className={button}>
                            Go to the first page
                        </Link>
                    </EmptyState>
                ) : isRouteErrorResponse(error) && error.status === 404 ? (
                    <EmptyState
                        icon={USER_ICON}
                        message="There is no profile to show here"
                        titleAs="h1"
                        detail="A profile shows here once its owner makes it public, and only under the username they have now."
                    >
                        <Link to="/games" className={button}>Browse games</Link>
                    </EmptyState>
                ) : (
                    <ErrorState
                        title="Failed to load this profile"
                        titleAs="h1"
                        onRetry={() => void revalidator.revalidate()}
                        retrying={revalidator.state === 'loading'}
                    >
                        Something went wrong on our side, so this profile could not be loaded just now.
                    </ErrorState>
                )}
            </div>
        </div>
    );
}

export default ProfilePage;
