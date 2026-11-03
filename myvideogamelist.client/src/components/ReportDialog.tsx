import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useDismissOnOutsidePress } from '@/lib/useDismissOnOutsidePress';
import { REPORT_NOTE_MAX_LENGTH, REPORT_REASONS, type ReportReason, type ReportTarget } from '@/types/moderation';
import './LoginDialog.css';
import './ReportDialog.css';

interface ReportDialogProps {
    target: ReportTarget;
    /** What the title says is being reported: "alex's review", "@alex's profile". */
    subject: string;
    /** Takes the dialog away. Also called when the browser closes it without asking. */
    onClose: () => void;
}

/**
 * Why the report was not sent, from what the API answered. A 404 is the one worth its own sentence: the
 * review or the profile was withdrawn, hidden or made private since the page was loaded, so there is
 * nothing left to report — the same answer for every reason, as the server gives it (ADR 0076 §1).
 */
async function refusal(response: Response): Promise<string> {
    if (response.status === 404) return 'This is no longer published, so there is nothing left to report.';
    if (response.status === 401) return 'Sign in again to send a report.';

    try {
        const problem = (await response.json()) as { title?: string; detail?: string; errors?: Record<string, string[]> };
        const first = Object.values(problem.errors ?? {}).find(messages => messages.length > 0)?.[0];
        return first ?? problem.detail ?? 'The report could not be sent. Please try again.';
    } catch {
        return 'The report could not be sent. Please try again.';
    }
}

/**
 * A reader's report of a published review or a public profile, sent to the admins (ADR 0076).
 *
 * A reason from the terms' own list, and a note for what a reason cannot say. Nobody else is told, the
 * person reported included, and the reader does not hear back: an admin either takes it off the site or
 * leaves it. Reporting the same thing again changes the reason, and the server says nothing about whether
 * anybody else has reported it.
 *
 * A native modal `<dialog>`, as `DeleteAccountDialog` is and for its reasons: the page behind it is inert,
 * Tab stays inside, and Escape is a `cancel` event wherever focus is.
 */
export function ReportDialog({ target, subject, onClose }: ReportDialogProps) {
    const [reason, setReason] = useState<ReportReason | null>(null);
    const [note, setNote] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    const dialog = useRef<HTMLDialogElement>(null);
    const firstReason = useRef<HTMLInputElement>(null);
    const done = useRef<HTMLButtonElement>(null);

    const titleId = useId();
    const descriptionId = useId();
    const noteId = useId();
    const errorId = useId();

    // Opened once it is in the document, which `showModal` needs, then the first reason focused: React's
    // `autoFocus` would run while the dialog is still closed. The `open` check is Strict Mode's second run.
    useEffect(() => {
        const element = dialog.current;
        if (element === null || element.open) return;

        element.showModal();
        firstReason.current?.focus();
    }, []);

    // The answer replaces the form, and the button that closes it takes the focus the form's had.
    useEffect(() => {
        if (sent) done.current?.focus();
    }, [sent]);

    // Not while the report is out: closed then, the reader could not tell whether it went.
    const cancel = () => {
        if (!sending) onClose();
    };

    const dismiss = useDismissOnOutsidePress(cancel);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (sending) return;

        if (reason === null) {
            setError('Choose what is wrong with it.');
            return;
        }

        setError(null);
        setSending(true);
        try {
            const response = await apiFetch('/api/reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userName: target.userName,
                    gameId: target.gameId ?? null,
                    reason,
                    note: note.trim() === '' ? null : note,
                }),
            });

            if (response.ok) setSent(true);
            else setError(await refusal(response));
        } catch {
            // A rejected fetch is the API out of reach, which `!response.ok` never reports.
            setError('The server could not be reached. The report was not sent.');
        } finally {
            setSending(false);
        }
    };

    return (
        <dialog
            ref={dialog}
            className="dialog-modal"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            // Escape: prevented, and the dialog closed by unmounting, so the page and the browser agree.
            onCancel={event => {
                event.preventDefault();
                cancel();
            }}
            onClose={onClose}
            {...dismiss}
        >
            <div className="dialog-panel">
                {sent ? (
                    <>
                        <h2 id={titleId} className="dialog-title">Thank you</h2>
                        <div id={descriptionId} className="dialog-text">
                            <p>
                                An admin will read your report. If it breaks the site&rsquo;s rules, they will take it
                                off the site.
                            </p>
                            <p>Nobody is told who reported it, and you will not hear back either way.</p>
                        </div>
                        <div className="dialog-actions">
                            <button ref={done} type="button" className="report-send" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={handleSubmit} noValidate>
                        <h2 id={titleId} className="dialog-title">{`Report ${subject}`}</h2>
                        <p id={descriptionId} className="dialog-text">
                            An admin reads every report, and nobody else sees it. They can take a review off the site,
                            or clear a name, picture or bio.
                        </p>

                        <fieldset
                            className="report-reasons"
                            aria-describedby={error !== null ? errorId : undefined}
                        >
                            <legend className="dialog-label">What is wrong with it?</legend>
                            {REPORT_REASONS.map((option, i) => (
                                <label key={option.key} className="report-reason">
                                    <input
                                        ref={i === 0 ? firstReason : undefined}
                                        type="radio"
                                        name="reason"
                                        value={option.key}
                                        checked={reason === option.key}
                                        onChange={() => {
                                            setReason(option.key);
                                            setError(null);
                                        }}
                                        disabled={sending}
                                    />
                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </fieldset>

                        <div className="dialog-field">
                            <label className="dialog-label" htmlFor={noteId}>Anything an admin should know (optional)</label>
                            <textarea
                                id={noteId}
                                className="dialog-input report-note"
                                value={note}
                                onChange={event => setNote(event.target.value)}
                                maxLength={REPORT_NOTE_MAX_LENGTH}
                                rows={3}
                                disabled={sending}
                            />
                        </div>

                        {error && <div id={errorId} className="dialog-error" role="alert">{error}</div>}

                        <div className="dialog-actions">
                            <button type="button" className="dialog-btn-secondary" onClick={cancel} disabled={sending}>
                                Cancel
                            </button>
                            <button type="submit" className="report-send" disabled={sending}>
                                {sending ? 'Sending…' : 'Send report'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </dialog>
    );
}
