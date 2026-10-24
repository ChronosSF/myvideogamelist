import { Link } from 'react-router';
import { useLayoutEffect, useRef } from 'react';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import type { CommunityScores, GameReview } from '@/types/community';
import { formatCount } from '@/lib/format';
import { formatDate } from '@/lib/stats';
import { hasMemberScore, MAX_SCORE, MIN_MEMBER_SCORES, ratingPercent } from '@/lib/score';
import { ReviewCard } from '@/components/ReviewCard';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScoreColumns } from '@/components/ScoreColumns';
import { SectionHeading } from '@/components/SectionHeading';

interface GameCommunityProps {
    /** From `useGameCommunity`, which the page calls so the hero's badge and this share one fetch. */
    community: UseGameCommunityResult;
    /**
     * The signed-in reader's username, so their own review can say it is theirs. Null when nobody is
     * signed in, and while auth has not answered.
     */
    viewer: string | null;
}

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
 * Renders nothing until both requests have answered, so it appears once rather than growing twice,
 * and nothing at all when there is nothing to read. A failure says nothing, as the community
 * completion times do — except that a failed review list beside a score that loaded says so, since
 * silence there would read as nobody having written one.
 */
export function GameCommunity({ community, viewer }: GameCommunityProps) {
    const { settled, scores, reviews, total } = community;

    if (!settled) return null;

    const hasReviews = total !== null && total > 0;

    // A score under the floor with nothing written would leave a section whose only content is
    // "too few to show" — noise, as the completion times' members row judges the same case.
    if (!hasMemberScore(scores) && !hasReviews) return null;

    return (
        <section aria-labelledby="member-reviews-heading" className="space-y-5">
            <SectionHeading id="member-reviews-heading">Member scores &amp; reviews</SectionHeading>

            {scores !== null && scores.scored > 0 && <MemberScore scores={scores} />}

            {total === null ? (
                <p className="text-sm text-fg-muted">
                    Reviews could not be loaded just now.
                </p>
            ) : hasReviews && (
                <MemberReviews community={community} viewer={viewer} total={total} reviews={reviews} />
            )}
        </section>
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
        <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,24rem)] sm:items-end bg-surface/60 border border-line rounded-xl px-4 py-4">
            <div>
                <p className="text-xs text-fg-muted uppercase tracking-wider mb-1.5">
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
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-line-strong text-fg hover:border-primary-500 aria-disabled:opacity-60 aria-disabled:cursor-wait transition-colors"
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
                    {/* Decorative: the name beside it says the same thing. */}
                    <span
                        className="flex items-center justify-center shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-primary-600 to-primary-700 text-on-primary text-sm font-bold"
                        aria-hidden="true"
                    >
                        {review.userName.charAt(0).toUpperCase()}
                    </span>

                    <div className="review-card-meta">
                        <p>
                            {/* Always linkable: only a public profile's reviews are listed. */}
                            <Link to={`/u/${review.userName}`} className="review-card-title">
                                {review.userName}
                            </Link>
                            {isViewer && (
                                <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-primary-500/15 text-primary-300">
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
            revealLabel={`Show ${review.userName}'s review — they marked it as containing spoilers`}
        />
    );
}
