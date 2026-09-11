import { useState } from 'react';
import { Link } from 'react-router';
import { lastPage, pageSearch } from '@/lib/paging';
import { formatDate } from '@/lib/stats';
import { MAX_SCORE } from '@/lib/score';
import type { PublicReview, PublicReviews } from '@/types/profile';

interface PublicReviewListProps {
    userName: string;
    /** Null when the request for them failed — distinct from a user who has written none. */
    reviews: PublicReviews | null;
    /**
     * From the profile document, which is fetched separately and does not need IGDB. It is used
     * only by the two early returns below — the failed request and the person who has written
     * none. Once there is a page to show, every figure comes from `reviews.total` instead: the
     * two requests are independent and can disagree, and it is the page's own count the loader
     * validates `?page=` against.
     */
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

    // Past this point the count travelling with the reviews is the only one used, and the prop
    // from the profile is not. They are two independent requests, so a review published or
    // withdrawn between them leaves one of them stale — and the loader validates `?page=` against
    // this one, so paging computed from the other can offer a page the loader answers with a 404.
    const { page, pageSize, total: loadedTotal } = reviews;
    const last = lastPage(loadedTotal, pageSize);

    // The slice this page covers, counted from the total rather than from what came back: a
    // review whose game IGDB no longer returns is dropped from the page but is still counted, so
    // the two can legitimately differ.
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, loadedTotal);
    const expected = to - from + 1;
    const shown = reviews.reviews.length;
    const dropped = expected - shown;

    return (
        <section className="profile-section">
            <h3 className="profile-section-title">
                {`Reviews (${loadedTotal})`}
            </h3>

            <ol className="review-list">
                {reviews.reviews.map(review => (
                    <PublicReviewCard key={review.game.id} review={review} />
                ))}
            </ol>

            {(last > 1 || dropped > 0) && (
                <p className="profile-caption">
                    {dropped > 0
                        // Honest about the gap rather than silently short: a count that did not
                        // add up would read as a bug.
                        ? `Showing ${shown} of ${last > 1 ? `the ${expected} on this page` : loadedTotal}. `
                            + 'Some could not be matched to a game.'
                        : `Showing ${from}–${to} of ${loadedTotal}.`}
                </p>
            )}

            {last > 1 && (
                // Links rather than a button that fetches more, because each page is its own URL:
                // that is what lets the server render it and a crawler reach it (ADR 0027).
                <nav className="review-pages" aria-label="Review pages">
                    {page > 1
                        ? <Link to={{ search: pageSearch(page - 1) }} rel="prev">Newer reviews</Link>
                        : <span aria-hidden="true" />}
                    <span>{`Page ${page} of ${last}`}</span>
                    {page < last
                        ? <Link to={{ search: pageSearch(page + 1) }} rel="next">Older reviews</Link>
                        : <span aria-hidden="true" />}
                </nav>
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
                    // Out of the tab order and the accessibility tree, as ListTable's cover link
                    // is: the title beside it goes to the same place and carries the name, and a
                    // link whose only content is a decorative image is an unexplained extra stop.
                    <Link
                        to={`/games/${review.game.id}`}
                        className="review-cover"
                        tabIndex={-1}
                        aria-hidden="true"
                    >
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
