import { useId, useState } from 'react';
import type { PlaythroughDto, ReviewDto, ReviewInputDto } from '@/types/playthrough';
import { playthroughTypeLabel } from '@/types/playthrough';

interface ReviewFormProps {
    /** The review already written, or null when there is none yet. */
    review: ReviewDto | null;
    /** The user's playthroughs of this game, so a review can name the run it is about. */
    playthroughs: PlaythroughDto[];
    onSave: (input: ReviewInputDto) => void;
    onDelete: () => void;
    pending: boolean;
    /** What the server said, beside the form rather than as a page-level banner. */
    error: string | null;
}

interface Draft {
    body: string;
    hasSpoilers: boolean;
    visibility: 'public' | 'private';
    playthroughId: string;
}

/** A new review is private until its author says otherwise. See the visibility note below. */
const EMPTY: Draft = { body: '', hasSpoilers: false, visibility: 'private', playthroughId: '' };

/**
 * The user's own review of one game — write it, change it, delete it.
 *
 * One per game, so there is no "add another": the form is the review. A plain submit with a
 * pending state and an inline error, like the playthrough form beside it and for the same reason.
 *
 * **Visibility is asked rather than assumed.** There are no public profiles yet, so nothing is
 * actually published today — but a default chosen now is a consent decision, and a review written
 * privately must not become public because a feature shipped later. The label says what "public"
 * will mean rather than what it currently does.
 */
export function ReviewForm({
    review,
    playthroughs,
    onSave,
    onDelete,
    pending,
    error,
}: ReviewFormProps) {
    const fieldId = useId();
    const [draft, setDraft] = useState<Draft>(review === null ? EMPTY : toDraft(review));

    // Load a review that arrived after the first render, and clear the fields when it is deleted.
    // Adjusted during render rather than in an effect, which would show the wrong text for a
    // commit and trips react-hooks/set-state-in-effect.
    const [lastReviewId, setLastReviewId] = useState<number | null>(review?.id ?? null);
    if (lastReviewId !== (review?.id ?? null)) {
        setLastReviewId(review?.id ?? null);
        setDraft(review === null ? EMPTY : toDraft(review));
    }

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
        setDraft(current => ({ ...current, [key]: value }));

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        onSave({
            body: draft.body.trim(),
            hasSpoilers: draft.hasSpoilers,
            visibility: draft.visibility,
            playthroughId: draft.playthroughId === '' ? null : Number(draft.playthroughId),
        });
    };

    return (
        <form className="game-user-panel-review-form" onSubmit={handleSubmit}>
            <div className="game-user-panel-field">
                <label htmlFor={`${fieldId}-body`}>What you thought</label>
                <textarea
                    id={`${fieldId}-body`}
                    rows={5}
                    maxLength={10000}
                    value={draft.body}
                    onChange={event => set('body', event.target.value)}
                    disabled={pending}
                />
            </div>

            <div className="game-user-panel-check">
                <input
                    id={`${fieldId}-spoilers`}
                    type="checkbox"
                    checked={draft.hasSpoilers}
                    onChange={event => set('hasSpoilers', event.target.checked)}
                    disabled={pending}
                />
                <label htmlFor={`${fieldId}-spoilers`}>This review contains spoilers</label>
            </div>

            <div className="game-user-panel-field">
                <label htmlFor={`${fieldId}-visibility`}>Who can see it</label>
                <select
                    id={`${fieldId}-visibility`}
                    value={draft.visibility}
                    onChange={event => set('visibility', event.target.value as Draft['visibility'])}
                    disabled={pending}
                    aria-describedby={`${fieldId}-visibility-hint`}
                >
                    <option value="private">Only me</option>
                    <option value="public">Anyone</option>
                </select>
                <p id={`${fieldId}-visibility-hint`} className="game-user-panel-hint">
                    {/* Says what it will mean, not what it currently does — public profiles are
                        not built yet, and a choice made now has to still be honoured then. */}
                    "Anyone" means this will appear on your public profile once profiles launch.
                    Nothing is published today either way.
                </p>
            </div>

            {playthroughs.length > 0 && (
                <div className="game-user-panel-field">
                    <label htmlFor={`${fieldId}-playthrough`}>About which playthrough</label>
                    <select
                        id={`${fieldId}-playthrough`}
                        value={draft.playthroughId}
                        onChange={event => set('playthroughId', event.target.value)}
                        disabled={pending}
                    >
                        <option value="">The game in general</option>
                        {playthroughs.map((playthrough, index) => (
                            <option key={playthrough.id} value={playthrough.id}>
                                {`${index + 1}. ${playthroughTypeLabel(playthrough.type) ?? 'In progress'}`}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {error !== null && (
                <p className="game-user-panel-hint" role="alert">{error}</p>
            )}

            <div className="game-user-panel-confirm">
                <button type="submit" className="danger" disabled={pending}>
                    {review === null ? 'Save review' : 'Update review'}
                </button>
                {review !== null && (
                    <button type="button" onClick={onDelete} disabled={pending}>
                        Delete review
                    </button>
                )}
            </div>
        </form>
    );
}

function toDraft(review: ReviewDto): Draft {
    return {
        body: review.body,
        // Narrowed here rather than trusted: the column allows a third value one day, and an
        // unrecognised one should read as the safer of the two rather than crash the select.
        visibility: review.visibility === 'public' ? 'public' : 'private',
        hasSpoilers: review.hasSpoilers,
        playthroughId: review.playthroughId === null ? '' : String(review.playthroughId),
    };
}
