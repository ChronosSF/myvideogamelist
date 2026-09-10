import { useState } from 'react';
import { Link } from 'react-router';
import { formatDate } from '@/lib/stats';
import { MAX_SCORE } from '@/lib/score';
import type { PublicReview, PublicReviews } from '@/types/profile';

interface PublicReviewListProps {
    userName: string;
    /** Null when the request for them failed — distinct from a user who has written none. */
    reviews: PublicReviews | null;
    /** From the profile document, which is fetched separately and does not need IGDB. */
    total: number;
}

/**
 * The reviews somebody has chosen to publish.
 *
 * This is the reading half ADR 0025 shipped without: "a review is written and stored and nothing
 * reads it but its author". Only reviews their author marked public appear, and only on a profile
 * its owner has published — the server applies both gates, and this component never sees a row
 * that failed either.
 */
export function PublicReviewList({ userName, reviews, total }: PublicReviewListProps) {
    if (total === 0) {
        return (
            <section className="profile-section">
                <h3 className="profile-section-title">Reviews</h3>
                <p className="profile-empty">{userName} has not published any reviews yet.</p>
            </section>
        );
    }

    // The one case worth spelling out. The figures above came from our own tables and are fine;
    // it is the game titles that need IGDB, so saying "no reviews" here would be a lie about the
    // person rather than a report about an outage.
    if (reviews === null) {
        return (
            <section className="profile-section">
                <h3 className="profile-section-title">Reviews</h3>
                <p className="profile-empty">
                    {`${userName} has written ${total} ${total === 1 ? 'review' : 'reviews'}, `}
                    but they could not be loaded just now. Everything above is unaffected.
                </p>
            </section>
        );
    }

    const shown = reviews.reviews.length;
    const dropped = Math.min(total, reviews.pageSize) - shown;

    return (
        <section className="profile-section">
            <h3 className="profile-section-title">
                {`Reviews (${total})`}
            </h3>

            <ol className="review-list">
                {reviews.reviews.map(review => (
                    <PublicReviewCard key={review.game.id} review={review} />
                ))}
            </ol>

            {total > shown && (
                <p className="profile-caption">
                    {dropped > 0
                        // Honest about the gap rather than silently short. The total counts what
                        // the user wrote; a review whose game IGDB no longer returns is dropped
                        // from the page, and a count that did not add up would read as a bug.
                        ? `Showing ${shown} of ${total}. Some could not be matched to a game.`
                        : `Showing the ${shown} most recent of ${total}.`}
                </p>
            )}
        </section>
    );
}

/**
 * One review.
 *
 * A spoiler review renders behind a control rather than blurred or truncated: blurring puts the
 * text in the page for anybody who selects it, and truncating gives away the shape of what is
 * being hidden. `hasSpoilers` is the author's own answer, so the only right default is to believe
 * it.
 */
function PublicReviewCard({ review }: { review: PublicReview }) {
    const [revealed, setRevealed] = useState(false);

    return (
        <li className="review-card">
            <div className="review-card-head">
                {review.game.coverImageUrl && (
                    <Link to={`/games/${review.game.id}`} className="review-cover">
                        <img src={review.game.coverImageUrl} alt="" loading="lazy" />
                    </Link>
                )}

                <div className="review-card-meta">
                    <Link to={`/games/${review.game.id}`} className="review-game-title">
                        {review.game.title}
                    </Link>

                    <p className="review-card-sub">
                        {review.score !== null && (
                            // The author's own score, on the scale they entered it. Never a
                            // percentage: that means an average of other people (ADR 0021).
                            <span className="review-score">
                                {`${review.score}/${MAX_SCORE}`}
                            </span>
                        )}
                        <span>{formatDate(review.updatedAt)}</span>
                    </p>
                </div>
            </div>

            {review.hasSpoilers && !revealed ? (
                <button
                    type="button"
                    className="review-spoiler-btn"
                    onClick={() => setRevealed(true)}
                >
                    {`Show review of ${review.game.title} — the author marked it as containing spoilers`}
                </button>
            ) : (
                <p className="review-body">{review.body}</p>
            )}
        </li>
    );
}
