import { useState, type ReactNode } from 'react';
import './ReviewCard.css';

interface ReviewCardProps {
    /**
     * What sits above the text: the game, on its author's profile, or the author, on the game's
     * page.
     */
    head: ReactNode;
    body: string;
    hasSpoilers: boolean;
    /**
     * The spoiler control's text. It is the whole of the control's accessible name, so it has to
     * say which review it reveals — a page of buttons all reading "Show review" says nothing.
     */
    revealLabel: string;
}

/**
 * One published review.
 *
 * A spoiler review renders behind a control rather than blurred or truncated: blurring puts the
 * text in the page for anybody who selects it, and truncating gives away the shape of what is
 * being hidden. `hasSpoilers` is the author's own answer, so the only right default is to believe
 * it.
 *
 * Shared by a profile's reviews and a game's, which differ only in their head, so that the rule
 * above cannot be kept in one list and forgotten in the other. The card is the list item, so it
 * belongs inside a `review-list`.
 */
export function ReviewCard({ head, body, hasSpoilers, revealLabel }: ReviewCardProps) {
    const [revealed, setRevealed] = useState(false);

    return (
        <li className="review-card">
            <div className="review-card-head">{head}</div>

            {hasSpoilers && !revealed ? (
                <button
                    type="button"
                    className="review-spoiler-btn"
                    onClick={() => setRevealed(true)}
                >
                    {revealLabel}
                </button>
            ) : (
                <p className="review-body">{body}</p>
            )}
        </li>
    );
}
