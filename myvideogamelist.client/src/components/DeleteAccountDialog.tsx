import { useId, useState } from 'react';
import { useDataExport } from '@/hooks/useDataExport';
import './LoginDialog.css';

interface Props {
    userName: string;
    onCancel: () => void;
    /**
     * Deletes the account. Rejects with a sentence for the user — a wrong password, most often. On
     * success the page moves on to a signed-out state and this dialog unmounts with it.
     */
    onDelete: (password: string) => Promise<void>;
}

/**
 * The confirmation in front of `DELETE /api/user`, which has no undo.
 *
 * The password is the confirmation, as ADR 0024 decided for the endpoint: a session cookie says the
 * browser signed in at some point, not that the account holder is at the keyboard now. Nothing on
 * top of it — no "type your username to continue" — because the password already is the deliberate
 * act, and a second hurdle mostly teaches people to clear hurdles without reading.
 *
 * It offers the export before anything else, as that ADR asked of the UI it would eventually get:
 * the one moment somebody is certain to want a copy of their data is just before it is gone.
 */
export function DeleteAccountDialog({ userName, onCancel, onDelete }: Props) {
    const [password, setPassword] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const exporter = useDataExport();

    const titleId = useId();
    const descriptionId = useId();
    const passwordId = useId();

    // Nothing closes the dialog while the request is out: the answer has to land somewhere, and a
    // deletion that succeeds after its dialog was dismissed would sign somebody out unexplained.
    const cancel = () => {
        if (!deleting) onCancel();
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        // Answered here rather than with the server's validation message, which names a field
        // rather than saying what to do.
        if (password.length === 0) {
            setError('Enter your password to confirm.');
            return;
        }

        setError(null);
        setDeleting(true);
        try {
            await onDelete(password);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete your account.');
            setDeleting(false);
        }
    };

    return (
        <div
            className="dialog-overlay"
            onClick={cancel}
            onKeyDown={event => {
                if (event.key === 'Escape') cancel();
            }}
        >
            <div
                className="dialog-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                onClick={event => event.stopPropagation()}
            >
                <h2 id={titleId} className="dialog-title">Delete your account?</h2>

                <div id={descriptionId} className="dialog-text">
                    <p>
                        This permanently deletes <strong>@{userName}</strong> and everything recorded
                        under it: your lists and scores, playthroughs, reviews, wishlist, and the
                        history behind your stats.
                    </p>
                    <p>It cannot be undone.</p>
                </div>

                <div className="dialog-export">
                    <span>Want a copy first?</span>
                    <button
                        type="button"
                        className="dialog-btn-secondary"
                        onClick={() => void exporter.download()}
                        disabled={exporter.downloading || deleting}
                    >
                        {exporter.downloading ? 'Preparing…' : 'Download your data'}
                    </button>
                </div>
                {exporter.error && <div className="dialog-error" role="alert">{exporter.error}</div>}

                <form onSubmit={handleSubmit} noValidate>
                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor={passwordId}>Password</label>
                        <input
                            id={passwordId}
                            type="password"
                            className="dialog-input"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            autoComplete="current-password"
                            disabled={deleting}
                            required
                            autoFocus
                        />
                    </div>

                    {error && <div className="dialog-error" role="alert">{error}</div>}

                    <div className="dialog-actions">
                        <button
                            type="button"
                            className="dialog-btn-secondary"
                            onClick={cancel}
                            disabled={deleting}
                        >
                            Cancel
                        </button>
                        <button type="submit" className="dialog-btn-danger" disabled={deleting}>
                            {deleting ? 'Deleting…' : 'Delete my account'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
