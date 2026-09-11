import { Link, data } from 'react-router';
import { apiUrl } from '@/lib/api';
import { CACHE_NOT_FOUND, CACHE_PROFILE, PRIVATE_NO_STORE } from '@/lib/cache';
import { lastPage, pageFrom } from '@/lib/paging';
import { formatDate, formatHours, formatRate } from '@/lib/stats';
import { MAX_SCORE } from '@/lib/score';
import type { PublicProfile, PublicReviews } from '@/types/profile';
import { ActivityChart } from '@/components/ActivityChart';
import { ScoreHistogram } from '@/components/ScoreHistogram';
import { StatTile } from '@/components/StatTile';
import { StatusBreakdown } from '@/components/StatusBreakdown';
import { PublicReviewList } from '@/components/PublicReviewList';
import type { Route } from './+types/ProfilePage';
import '@/components/ProfileStats.css';
import './ProfilePage.css';

interface ProfilePageData {
    profile: PublicProfile;
    /** Null when the reviews request failed. Not the same as having written none. */
    reviews: PublicReviews | null;
    /** Which page of reviews this is. Everything above the reviews is the same on every one. */
    page: number;
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
 * The loader overrides it when the reviews half failed, for the reason the home page does: caching
 * a degraded render pins the failure at the edge long after the failure is over.
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return { 'Cache-Control': loaderHeaders.get('Cache-Control') ?? CACHE_PROFILE };
}

export function meta({ loaderData }: Route.MetaArgs) {
    // Undefined when the loader threw, in which case the error boundary supplies the page.
    if (!loaderData?.profile) return [{ title: 'Profile not found - MyVideoGameList' }];

    const { profile, page } = loaderData;
    // Each page of reviews is its own URL, so each gets its own title: two pages indexed under one
    // title read as duplicates of each other.
    const title = page > 1
        ? `${profile.userName}, reviews page ${page} - MyVideoGameList`
        : `${profile.userName} - MyVideoGameList`;
    const finished = profile.library.byStatus.finished;
    const description = `${profile.userName} has finished ${finished} `
        + `${finished === 1 ? 'game' : 'games'} and is tracking ${profile.library.tracked} `
        + 'on MyVideoGameList.';

    return [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'profile' },
    ];
}

/**
 * Two requests, and only one of them may fail the page.
 *
 * The profile itself touches no third party, so it either answers or the profile is not there. The
 * reviews need game titles and covers from IGDB, so they can fail while everything else is fine —
 * and they are still fetched here rather than after hydration, because the reviews are the text a
 * crawler came for (ROADMAP D8/D9), and text loaded by an effect is text that was not indexed. The
 * same reasoning is why the pages of them are URLs rather than a "load more" button.
 *
 * A private profile and an unclaimed username are both a 404 from the API, deliberately, and both
 * become the same page here.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
    const userName = encodeURIComponent(params.userName);

    // A thrown Response carries its own headers and bypasses the `headers` export above, so each
    // error path states its own policy. A 404 gets a short shared TTL; a 502 gets none, because
    // caching an upstream failure outlives the failure.
    const notFound = () => new Response('Not Found', {
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
    if (page === null) throw notFound();

    // `allSettled` rather than `all`: a rejection from the reviews request must not take the
    // profile down with it, and `all` rejects on the first of either.
    const [profileResult, reviewsResult] = await Promise.allSettled([
        fetch(apiUrl(`/api/users/${userName}`)),
        fetch(apiUrl(`/api/users/${userName}/reviews?page=${page}`)),
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
    if (reviews !== null && page > lastPage(reviews.total, reviews.pageSize)) throw notFound();

    return data<ProfilePageData>(
        { profile, reviews, page },
        { headers: { 'Cache-Control': reviews === null ? PRIVATE_NO_STORE : CACHE_PROFILE } },
    );
}

export function ProfilePage({ loaderData }: Route.ComponentProps) {
    const { profile, reviews } = loaderData;
    const { activity, library, scores, playtime } = profile;

    return (
        <div className="public-profile">
            <div className="public-profile-inner">
                <header className="public-profile-header">
                    <span className="public-profile-avatar" aria-hidden="true">
                        {profile.userName.charAt(0).toUpperCase()}
                    </span>
                    <div>
                        <h1 className="public-profile-name">{profile.userName}</h1>
                        <p className="public-profile-since">
                            {/* Not a join date — there is no such column, and inventing one for
                                accounts that predate it would be inventing a fact. */}
                            {activity.trackingSince === null
                                ? 'Has not tracked anything here yet.'
                                : `Tracking games here since ${formatDate(activity.trackingSince)}.`}
                        </p>
                    </div>
                </header>

                <section className="profile-stats">
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

                    <section className="profile-section">
                        <h3 className="profile-section-title">What they start and finish</h3>
                        {activity.months.length === 0
                            ? <p className="profile-empty">No status changes recorded yet.</p>
                            : <ActivityChart months={activity.months} />}
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

                <p className="public-profile-footer">
                    <Link to="/games">Browse games on MyVideoGameList</Link>
                </p>
            </div>
        </div>
    );
}

export default ProfilePage;
