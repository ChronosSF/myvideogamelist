import { useId } from 'react';
import { Link } from 'react-router';
import { useLayoutEffect, useRef } from 'react';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import type { CommunityScores, GameReview } from '@/types/community';
import { formatCount } from '@/lib/format';
import { formatDate } from '@/lib/stats';
import { hasMemberScore, MAX_SCORE, MIN_MEMBER_SCORES, ratingPercent } from '@/lib/score';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { ReviewCard } from '@/components/ReviewCard';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScoreColumns } from '@/components/ScoreColumns';
import { SectionHeading } from '@/components/SectionHeading';
import { Skeleton } from '@/components/Skeleton';

interface GameCommunityProps {
    /** From `useGameCommunity`, which the page calls so the hero's badge and this share one fetch. */
    community: UseGameCommunityResult;
    /**
     * The signed-in reader's username, so their own review can say it is theirs. Null when nobody is
     * signed in, and while auth has not answered.
     */
    viewer: string | null;
}

/** A heroicon's path: two speech bubbles, for a conversation nobody has started yet. */
const CONVERSATION_ICON = 'M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z';

/**
 * The least height the section's body takes, whichever state it is in. Waiting, nothing yet and failed
 * all fit inside it at a phone's width, so whichever replaces the skeleton moves nothing under it; and
 * for most games the answer is "nothing yet", so most pages move nothing at all.
 */
const BODY_HEIGHT = 'min-h-[13rem]';

/**
 * What MyVideoGameList members make of a game: their score, how it spreads, and the reviews they
 * have published.
 *
 * This is the reading half ADR 0025 left for the game page: a review was readable on its author's
 * profile, and nowhere a reader deciding about the game would look. The server decides what
 * crosses — every score, but only a review marked public on a public profile — and this component
 * never sees a row that failed either gate. See `docs/decisions/0028-*`.
 *
 * **Every figure carries its sample size**, and ours go behind a floor (ADR 0016): under
 * `MIN_MEMBER_SCORES` there is a count and no number, and no distribution either.
 *
 * Always there, in the lists page's pattern (issue 127): a skeleton until both requests have
 * answered, so the section appears once rather than growing twice; then what members have said, or
 * what would put something here when nobody has said anything yet, or what failed with a way to ask
 * again. It used to render nothing in those last cases, which a reader cannot tell from a section
 * that never loaded. See `docs/decisions/0070-*`, which amends ADR 0028 §3 to say so.
 */
export function GameCommunity({ community, viewer }: GameCommunityProps) {
    return (
        <section aria-labelledby={HEADING_ID} className="space-y-5">
            <SectionHeading id={HEADING_ID} focusable>Member scores &amp; reviews</SectionHeading>
            <CommunityBody community={community} viewer={viewer} />
        </section>
    );
}

const HEADING_ID = 'member-reviews-heading';

function CommunityBody({ community, viewer }: GameCommunityProps) {
    const { settled, scores, reviews, total, reloading, reload } = community;

    // Every "Try again" here gives way to something else — the skeleton, or what loaded — and focus
    // would fall to the page's body with the button. The section's heading is where it goes instead,
    // which is also where somebody reading it would start again.
    const retry = () => {
        document.getElementById(HEADING_ID)?.focus();
        reload();
    };

    // Every server render, and the first client render: the game page is shared-cached, and both
    // halves are fetched after hydration (ADR 0028).
    if (!settled) {
        return (
            <LoadingState label="Loading member scores and reviews…" className={`flex flex-col justify-center ${BODY_HEIGHT}`}>
                <CommunitySkeleton />
            </LoadingState>
        );
    }

    // Nothing true can be said about the game when neither half answered, so the section says what
    // failed and offers to ask again, as the lists page does. Not an alert: the page around it
    // rendered perfectly well, and an alert would interrupt a screen reader to announce a side panel.
    if (scores === null && total === null) {
        return (
            <div className={`flex flex-col justify-center ${BODY_HEIGHT}`}>
                <ErrorState
                    size="section"
                    title="Member scores and reviews could not be loaded just now"
                    onRetry={retry}
                />
            </div>
        );
    }

    // Nobody has said anything that can be shown yet, which is where most games are. The floor is
    // part of what would change that: under it a score is a count and not a number (ADR 0016), so a
    // game a few members have scored is still waiting, and it says how many.
    if (scores !== null && !hasMemberScore(scores) && total === 0) {
        return (
            <div className={`flex flex-col justify-center ${BODY_HEIGHT}`}>
                <EmptyState
                    size="section"
                    icon={CONVERSATION_ICON}
                    message="No member score or reviews yet."
                    detail={nothingYet(scores.scored)}
                />
            </div>
        );
    }

    // Something to show. A half that did not answer says so beside the one that did, since silence
    // where a score or the reviews should be would read as there being none.
    return (
        <div className={`space-y-5 ${BODY_HEIGHT}`}>
            {scores === null
                ? <HalfFailed what="The member score" retrying={reloading} onRetry={retry} />
                : scores.scored > 0 && <MemberScore scores={scores} />}

            {total === null ? (
                <HalfFailed what="Reviews" retrying={reloading} onRetry={retry} />
            ) : total > 0 ? (
                <MemberReviews community={community} viewer={viewer} total={total} reviews={reviews} />
            ) : (
                <p className="text-sm text-fg-muted">
                    No reviews yet. They show here as members publish them.
                </p>
            )}
        </div>
    );
}

/**
 * One half of the section that did not load, beside the half that did, with a way to ask again that
 * says when it is asking — marked disabled rather than disabled while it does, so it keeps its place in
 * the tab order, as `ErrorState`'s button does.
 */
function HalfFailed({ what, retrying, onRetry }: { what: string; retrying: boolean; onRetry: () => void }) {
    const sentenceId = useId();

    return (
        <p className="text-sm text-fg-muted">
            <span id={sentenceId}>{`${what} could not be loaded just now.`}</span>{' '}
            <button
                type="button"
                className="font-semibold text-fg-strong underline decoration-line-strong underline-offset-4 hover:decoration-fg-strong aria-disabled:opacity-60 aria-disabled:cursor-wait"
                onClick={retrying ? undefined : onRetry}
                aria-disabled={retrying || undefined}
                aria-describedby={sentenceId}
            >
                {retrying ? 'Trying again…' : 'Try again'}
            </button>
        </p>
    );
}

/** What would put a member score here, from where the game stands. */
function nothingYet(scored: number): string {
    const reviews = 'Reviews show here as members publish them.';
    if (scored === 0) return `A member score is shown once ${MIN_MEMBER_SCORES} members have scored this. ${reviews}`;

    return `Only ${scored} ${scored === 1 ? 'member has' : 'members have'} scored this so far. `
        + `A member score is shown once ${MIN_MEMBER_SCORES} have. ${reviews}`;
}

/** The section's empty state before it is known to be one: an icon's place and a sentence's two lines. */
function CommunitySkeleton() {
    return (
        <div className="flex flex-col items-center py-6 skeleton-sheen">
            <Skeleton className="block w-10 h-10 mb-3 rounded-full" />
            <Skeleton className="block w-56 max-w-full h-4 mb-4 rounded-sm" />
            <Skeleton className="block w-80 max-w-full h-3 mb-2 rounded-sm" />
            <Skeleton className="block w-64 max-w-full h-3 rounded-sm" />
        </div>
    );
}

/** The members' score out of 100 and its distribution — or, under the floor, only how many. */
function MemberScore({ scores }: { scores: CommunityScores }) {
    if (!hasMemberScore(scores)) {
        return (
            <p className="text-sm text-fg-muted">
                {`Only ${scores.scored} ${scores.scored === 1 ? 'member has' : 'members have'} scored this so far. `}
                {`A member score is shown once ${MIN_MEMBER_SCORES} have.`}
            </p>
        );
    }

    return (
        <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,24rem)] sm:items-end">
            <div>
                <p className="type-kicker text-primary-400 mb-2">
                    Member score
                </p>
                {/* Out of 100 and in a badge, beside the critics' and the players': it is an
                    average of other people, and stars mean the reader's own score (ADR 0021). */}
                <ScoreBadge kind="members" percent={ratingPercent(scores.mean)} count={scores.scored} />
                {/* For the eye only. The badge's own accessible name already ends "from N scores",
                    and a screen reader would otherwise read the count out twice in a row. */}
                <p className="mt-2 text-xs text-fg-muted" aria-hidden="true">
                    {`from ${formatCount(scores.scored)} ${scores.scored === 1 ? 'score' : 'scores'}`}
                </p>
            </div>

            <ScoreColumns
                distribution={scores.distribution}
                label={`Member scores, from 1 to ${MAX_SCORE}`}
                unit={{ one: 'member', other: 'members' }}
            />
        </div>
    );
}

interface MemberReviewsProps extends GameCommunityProps {
    reviews: GameReview[];
    total: number;
}

/**
 * The published reviews, a page at a time.
 *
 * A button fetches the next page, where the profile uses links. The profile's pages are URLs so
 * the server can render them and a crawler reach them; these are fetched after hydration and
 * rendered by nobody's server, on purpose, so a URL per page would name nothing a crawler could
 * read.
 */
function MemberReviews({ community, viewer, reviews, total }: MemberReviewsProps) {
    const { hasMore, loadingMore, moreFailed, loadMore } = community;
    const list = useRef<HTMLOListElement>(null);
    const more = useRef<HTMLButtonElement>(null);

    // Where keyboard focus goes once a page asked for by a press lands: the first review it added, so
    // the reader carries on from there rather than from the button beneath them, or, once the last
    // page takes the button away, from the document's body. Written by the press and read here, in
    // the commit that adds the page, so focus never rests on the body in between.
    const focusFrom = useRef<number | null>(null);
    useLayoutEffect(() => {
        const from = focusFrom.current;
        if (from === null || loadingMore) return;

        focusFrom.current = null;
        // Only from the button, or from the body once the last page has taken the button away. A
        // reader who moved on while the page loaded, into the search box say, keeps the focus where
        // they put it, and the rest of what they type with it.
        const active = document.activeElement;
        const lost = active === null || active === document.body;
        if (!lost && active !== more.current) return;

        const items = list.current?.querySelectorAll<HTMLElement>(':scope > li');
        // A failed page added nothing, and the button that was pressed still has the focus. A last page
        // that added nothing either, its reviews withdrawn since, took the button with it: the last
        // review takes the focus then, rather than the body.
        (items?.[from] ?? (lost ? items?.[from - 1] : undefined))?.focus();
    }, [reviews.length, loadingMore]);

    const showMore = () => {
        if (loadingMore) return;
        focusFrom.current = reviews.length;
        loadMore();
    };

    return (
        <div>
            {/* Named, because the section holds a second list — the score columns — right above. */}
            <ol ref={list} className="review-list" aria-label="Member reviews">
                {reviews.map(review => (
                    // The name and the moment it was written, not the name alone. Names can change
                    // hands while somebody reads, and a key two reviews shared would hand one card's
                    // state — a spoiler already revealed — to the other.
                    <GameReviewCard
                        key={`${review.userName}@${review.createdAt}`}
                        review={review}
                        isViewer={review.userName === viewer}
                    />
                ))}
            </ol>

            {hasMore && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    {/* aria-disabled rather than disabled while a page loads: a disabled button
                        drops the keyboard focus it holds, and the press guards itself. */}
                    <button
                        ref={more}
                        type="button"
                        onClick={showMore}
                        aria-disabled={loadingMore}
                        className="px-4 py-2 rounded-sm text-sm font-semibold border border-line-strong text-fg-strong hover:border-fg-muted aria-disabled:opacity-60 aria-disabled:cursor-wait transition-colors"
                    >
                        {loadingMore ? 'Loading…' : 'Show more reviews'}
                    </button>
                    <span className="text-xs text-fg-muted">
                        {`Showing ${reviews.length} of ${total}.`}
                    </span>
                </div>
            )}

            {moreFailed && (
                <p className="mt-2 text-sm text-danger-400" role="alert">
                    Could not load more reviews. Please try again.
                </p>
            )}
        </div>
    );
}

/** One review, headed by its author. */
function GameReviewCard({ review, isViewer }: { review: GameReview; isViewer: boolean }) {
    return (
        <ReviewCard
            head={
                <>
                    {/* Their picture, or their handle's initial. Decorative: the name beside it
                        says the same thing. */}
                    <Avatar userName={review.userName} avatarUrl={review.avatarUrl} className="review-avatar" />

                    <div className="review-card-meta">
                        <p>
                            {/* Always linkable: only a public profile's reviews are listed. A display
                                name sits beside the handle and never replaces it, as on the profile
                                (ADR 0056), in a `bdi` so a name written right to left cannot reorder
                                the handle after it. Tested for presence: an API a release behind
                                sends no display name, and the handle alone is right for that. */}
                            <Link to={`/u/${review.userName}`} className="review-card-title">
                                {review.displayName ? (
                                    <>
                                        <bdi>{review.displayName}</bdi>{' '}
                                        <span className="review-card-handle">@{review.userName}</span>
                                    </>
                                ) : review.userName}
                            </Link>
                            {isViewer && (
                                <span className="ml-2 px-1.5 py-0.5 rounded-sm type-kicker bg-primary-500/15 text-primary-300">
                                    You
                                </span>
                            )}
                        </p>

                        <p className="review-card-sub">
                            {review.score !== null && (
                                // The author's own score, on the scale they entered it. Never a
                                // percentage: that means an average of other people (ADR 0021).
                                <span className="review-score">{`${review.score}/${MAX_SCORE}`}</span>
                            )}
                            <span>{formatDate(review.updatedAt)}</span>
                        </p>
                    </div>
                </>
            }
            body={review.body}
            hasSpoilers={review.hasSpoilers}
            // The handle, not the display name: it is what says whose review this is, and a
            // display name is anybody's to choose.
            revealLabel={`Show ${review.userName}'s review — they marked it as containing spoilers`}
        />
    );
}
