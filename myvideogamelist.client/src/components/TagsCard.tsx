import { useEffect, useRef, useState } from 'react';
import { useTags } from '@/hooks/useTags';
import { type TagDto, TAG_NAME_MAX, gamesCarrying, normaliseTagName } from '@/types/tag';
import './TagsCard.css';

/** Where the focus goes once the row it was in has been redrawn. */
type FocusTarget = { button: 'rename' | 'delete'; id: number } | 'heading';

/**
 * Every tag the account has, with how many games carry each, and the two things that act on all of them
 * at once: renaming one, which every game keeps, and deleting one, which takes it off every game.
 *
 * On the owner's settings page beside the list names, because both are words the owner chose that only
 * the owner sees. Tags are made where they are used — on a game's page — so there is nothing to create
 * here.
 *
 * Neither write is optimistic, as the list names' save is not: a refusal has to arrive beside the field
 * with what was typed still in it. A delete asks first, inline, with the number of games it will come off;
 * the focus goes to its Cancel, and Cancel or Escape puts it back on the button that asked. A row that
 * goes takes its buttons with it, so the focus then goes to the card's heading rather than to the page.
 */
export function TagsCard() {
    const { tags, status, reload, renameTag, deleteTag } = useTags();

    const [renaming, setRenaming] = useState<{ id: number; draft: string } | null>(null);
    const [confirming, setConfirming] = useState<number | null>(null);
    const [busy, setBusy] = useState<number | null>(null);
    const [problem, setProblem] = useState<{ id: number; message: string } | null>(null);
    /** A failure about no one row — a tag gone since this card was drawn has no row left to show it by. */
    const [notice, setNotice] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState('');

    const headingRef = useRef<HTMLHeadingElement>(null);
    const buttons = useRef(new Map<string, HTMLButtonElement>());

    // The element to focus does not exist until the row is redrawn, so the intent is kept until the next
    // commit and acted on then. A ref rather than state: acting on it changes nothing that renders.
    const focusNext = useRef<FocusTarget | null>(null);
    useEffect(() => {
        const target = focusNext.current;
        if (target === null) return;
        focusNext.current = null;

        if (target === 'heading') headingRef.current?.focus();
        else buttons.current.get(`${target.button}-${target.id}`)?.focus();
    });

    const buttonRef = (button: 'rename' | 'delete', id: number) => (element: HTMLButtonElement | null) => {
        if (element) buttons.current.set(`${button}-${id}`, element);
        else buttons.current.delete(`${button}-${id}`);
    };

    const startRename = (tag: TagDto) => {
        setRenaming({ id: tag.id, draft: tag.name });
        setConfirming(null);
        setProblem(null);
        setNotice(null);
    };

    const stopRename = (id: number) => {
        setRenaming(null);
        setProblem(null);
        focusNext.current = { button: 'rename', id };
    };

    const handleRename = async (event: React.FormEvent, tag: TagDto) => {
        event.preventDefault();
        // While the save is out nothing else is sent — and nothing is disabled, which would drop the focus
        // from the box or the button somebody is on, and leave it on the page when the answer is a refusal.
        if (renaming === null || busy !== null) return;

        const name = normaliseTagName(renaming.draft);
        if (name === '') {
            setProblem({ id: tag.id, message: 'A tag needs a name.' });
            return;
        }
        // Exactly what it is already called: nothing to send.
        if (name === tag.name) {
            stopRename(tag.id);
            return;
        }

        setBusy(tag.id);
        setProblem(null);
        const result = await renameTag(tag.id, name);
        setBusy(null);

        if (result.ok) {
            setAnnouncement(`Renamed ${tag.name} to ${result.tag.name}.`);
            stopRename(tag.id);
        } else if (result.gone) {
            // Deleted somewhere else, and already off the list: its row, and the box the focus was in, are
            // gone with it. Said above the list instead, with the focus on the heading.
            setRenaming(null);
            setNotice(`${tag.name} was deleted somewhere else, so it could not be renamed.`);
            focusNext.current = 'heading';
        } else {
            setProblem({ id: tag.id, message: result.error });
        }
    };

    const startDelete = (tag: TagDto) => {
        setConfirming(tag.id);
        setRenaming(null);
        setProblem(null);
        setNotice(null);
    };

    const stopDelete = (id: number) => {
        setConfirming(null);
        setProblem(null);
        focusNext.current = { button: 'delete', id };
    };

    const handleDelete = async (tag: TagDto) => {
        if (busy !== null) return;
        setBusy(tag.id);
        setProblem(null);
        const deleted = await deleteTag(tag.id);
        setBusy(null);

        if (deleted) {
            setConfirming(null);
            setAnnouncement(`Deleted ${tag.name}.`);
            focusNext.current = 'heading';
        } else {
            setProblem({ id: tag.id, message: 'Could not delete that tag. Please try again.' });
        }
    };

    return (
        <div className="user-card">
            <h2 className="user-card-label" ref={headingRef} tabIndex={-1}>Your tags</h2>
            <p className="user-card-hint">
                Tags are yours alone: nobody else sees them, and your public profile never shows them. Add
                them to a game from its page; renaming one changes it on every game that has it.
            </p>

            {(status === 'idle' || status === 'loading') && (
                <p className="user-card-hint">Loading your tags…</p>
            )}

            {status === 'failed' && (
                <p className="user-pref-error" role="alert">
                    Your tags could not be loaded, so they cannot be changed just now.{' '}
                    <button type="button" className="tags-card-retry" onClick={reload}>Try again</button>
                </p>
            )}

            {notice !== null && (
                <p className="user-pref-error" role="alert">{notice}</p>
            )}

            {status === 'ready' && tags.length === 0 && (
                <p className="user-card-hint">You have not tagged any games yet.</p>
            )}

            {status === 'ready' && tags.length > 0 && (
                <ul className="tags-card-list" aria-label="Your tags">
                    {tags.map(tag => {
                        const saving = busy === tag.id;
                        const errorId = `tags-card-error-${tag.id}`;
                        const rowProblem = problem?.id === tag.id ? problem.message : null;

                        return (
                            <li key={tag.id} className="tags-card-row">
                                {renaming?.id === tag.id ? (
                                    <form
                                        className="tags-card-form"
                                        onSubmit={event => void handleRename(event, tag)}
                                        onKeyDown={event => {
                                            if (event.key === 'Escape' && !saving) {
                                                event.preventDefault();
                                                stopRename(tag.id);
                                            }
                                        }}
                                        aria-busy={saving || undefined}
                                        noValidate
                                    >
                                        <label className="sr-only" htmlFor={`tags-card-name-${tag.id}`}>
                                            {`New name for ${tag.name}`}
                                        </label>
                                        <input
                                            id={`tags-card-name-${tag.id}`}
                                            className="tags-card-input"
                                            type="text"
                                            value={renaming.draft}
                                            maxLength={TAG_NAME_MAX}
                                            onChange={event => setRenaming({ id: tag.id, draft: event.target.value })}
                                            readOnly={saving}
                                            aria-invalid={rowProblem !== null}
                                            aria-describedby={rowProblem !== null ? errorId : undefined}
                                            autoComplete="off"
                                            autoFocus
                                        />
                                        <div className="tags-card-actions">
                                            <button type="submit" className="user-btn" aria-disabled={saving || undefined}>
                                                {saving ? 'Saving…' : 'Save'}
                                            </button>
                                            <button
                                                type="button"
                                                className="tags-card-cancel"
                                                aria-disabled={saving || undefined}
                                                onClick={() => { if (!saving) stopRename(tag.id); }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </form>
                                ) : confirming === tag.id ? (
                                    <div
                                        className="tags-card-confirm"
                                        role="group"
                                        aria-label={`Delete ${tag.name}?`}
                                        onKeyDown={event => {
                                            if (event.key === 'Escape' && !saving) {
                                                event.preventDefault();
                                                stopDelete(tag.id);
                                            }
                                        }}
                                    >
                                        <p className="user-card-hint" id={`tags-card-question-${tag.id}`}>
                                            {tag.count === 0
                                                ? `Delete the tag “${tag.name}”? No game carries it.`
                                                : `Delete the tag “${tag.name}”? It comes off ${gamesCarrying(tag.count)}; the games stay as they are.`}
                                        </p>
                                        <div className="tags-card-actions">
                                            {/* Each says what the question is, so the focus landing on
                                                Cancel reads the number of games, not only the name. */}
                                            <button
                                                type="button"
                                                className="user-btn user-btn-danger"
                                                aria-disabled={saving || undefined}
                                                aria-describedby={`tags-card-question-${tag.id}`}
                                                onClick={() => void handleDelete(tag)}
                                            >
                                                {saving ? 'Deleting…' : 'Delete'}
                                            </button>
                                            <button
                                                type="button"
                                                className="tags-card-cancel"
                                                aria-disabled={saving || undefined}
                                                aria-describedby={`tags-card-question-${tag.id}`}
                                                onClick={() => { if (!saving) stopDelete(tag.id); }}
                                                autoFocus
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="tags-card-line">
                                        <span className="tags-card-name" title={tag.name}>{tag.name}</span>
                                        <span className="tags-card-count">{gamesCarrying(tag.count)}</span>
                                        <button
                                            type="button"
                                            className="tags-card-action"
                                            ref={buttonRef('rename', tag.id)}
                                            onClick={() => startRename(tag)}
                                            aria-label={`Rename ${tag.name}`}
                                        >
                                            Rename
                                        </button>
                                        <button
                                            type="button"
                                            className="tags-card-action tags-card-action-danger"
                                            ref={buttonRef('delete', tag.id)}
                                            onClick={() => startDelete(tag)}
                                            aria-label={`Delete ${tag.name}`}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                )}

                                {rowProblem !== null && (
                                    <p id={errorId} className="user-pref-error" role="alert">{rowProblem}</p>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        </div>
    );
}
