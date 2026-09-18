import { useId, useState } from 'react';

interface EntryNotesFormProps {
    /** What is saved, or null for none. The draft follows it whenever it changes. */
    notes: string | null;
    onSave: (notes: string | null) => void;
    pending: boolean;
    error: string | null;
}

/** The limit the API and the column share. */
const MAX_NOTES = 2000;

/**
 * The user's private notes on a game as a whole.
 *
 * A form with a Save button rather than a field that saves as it is typed in, as the review is: a
 * request per keystroke is a request per keystroke, and a note half-typed when the tab closes is
 * better lost than stored half-finished. The panel around this is itself mounted per game, so a
 * draft never follows the reader to the next game's page.
 */
export function EntryNotesForm({ notes, onSave, pending, error }: EntryNotesFormProps) {
    const fieldId = useId();
    const [draft, setDraft] = useState(notes ?? '');

    // Follow the saved value when it changes — the entry loading, a save landing, everything being
    // deleted — adjusted during render rather than in an effect, which would show the old draft for
    // a frame. A failed save changes nothing here, so what the user typed stays to retry.
    const [lastNotes, setLastNotes] = useState(notes);
    if (lastNotes !== notes) {
        setLastNotes(notes);
        setDraft(notes ?? '');
    }

    // Blank is no notes, exactly as the server reads it, so clearing the box and saving clears them.
    const normalised = draft.trim() === '' ? null : draft.trim();
    const unchanged = normalised === notes;

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        onSave(normalised);
    };

    return (
        <form className="game-user-panel-review-form" onSubmit={handleSubmit}>
            <div className="game-user-panel-field">
                <label htmlFor={`${fieldId}-notes`}>Your notes</label>
                <textarea
                    id={`${fieldId}-notes`}
                    rows={3}
                    maxLength={MAX_NOTES}
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    disabled={pending}
                    aria-describedby={`${fieldId}-notes-hint`}
                />
                <p id={`${fieldId}-notes-hint`} className="game-user-panel-hint">
                    Only you can see these. They are not part of your review, and no profile shows them.
                </p>
            </div>

            {error !== null && (
                <p className="game-user-panel-hint" role="alert">{error}</p>
            )}

            <div className="game-user-panel-confirm">
                <button type="submit" className="danger" disabled={pending || unchanged}>
                    {notes !== null && normalised === null ? 'Clear notes' : 'Save notes'}
                </button>
            </div>
        </form>
    );
}
