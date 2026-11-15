import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { UseDataExportResult } from '@/hooks/useDataExport';
import { useDismissOnOutsidePress } from '@/lib/useDismissOnOutsidePress';
import './LoginDialog.css';

interface Props {
    /** The question the dialog asks, which is also its accessible name. */
    title: string;
    /** What will go and what will stay, said before the password is asked for. */
    children: ReactNode;
    /** The confirming button, and what it says while the request is out. */
    confirmLabel: string;
    confirmingLabel: string;
    /** Said when the request fails without a sentence of the server's own. */
    failure: string;
    /** Takes the dialog away. Also called when the browser closes it without asking. */
    onCancel: () => void;
    /**
     * Does the deed. Rejects with a sentence for the user — a wrong password, most often. On success
     * the dialog's owner takes it away, and this dialog stays held until it does.
     */
    onConfirm: (password: string) => Promise<void>;
    /**
     * The card's download, passed in rather than held here. State held here would end with the
     * dialog, so closing it part way through a download and opening it again would forget the
     * download was running — and let the deed race it.
     */
    exporter: UseDataExportResult;
}

/**
 * The confirmation in front of an act on the account that has no undo: deleting it, or emptying its
 * library (`DeleteAccountDialog`, `StartOverDialog`).
 *
 * The password is the confirmation, as ADR 0024 decided for deleting the account and ADR 0095 for
 * starting over: a session cookie says the browser signed in at some point, not that the account
 * holder is at the keyboard now. Nothing on top of it — no "type your username to continue" — because
 * the password already is the deliberate act, and a second hurdle mostly teaches people to clear
 * hurdles without reading.
 *
 * It offers the export before anything else, as ADR 0024 asked of the UI it would eventually get:
 * the one moment somebody is certain to want a copy of their data is just before it is gone.
 *
 * A native modal `<dialog>`, opened with `showModal()`, rather than a positioned overlay. The modal
 * is what makes the rest of the page inert, keeps Tab inside, and turns Escape into a `cancel` event
 * wherever focus is — an overlay marked `aria-modal` does none of those, and its Escape handler went
 * deaf the moment Tab carried focus out of it.
 */
export function PasswordConfirmDialog({
    title,
    children,
    confirmLabel,
    confirmingLabel,
    failure,
    onCancel,
    onConfirm,
    exporter,
}: Props) {
    const [password, setPassword] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dialog = useRef<HTMLDialogElement>(null);
    const passwordInput = useRef<HTMLInputElement>(null);

    const titleId = useId();
    const descriptionId = useId();
    const passwordId = useId();

    // Opened once it is in the document, which `showModal` needs. The password field is focused
    // afterwards rather than through `autoFocus`: React focuses on mount, while the dialog is still
    // closed and cannot take focus, and the browser would then pick the first control inside — the
    // download button. The `open` check is for Strict Mode's second run of this effect.
    useEffect(() => {
        const element = dialog.current;
        if (element === null || element.open) return;

        element.showModal();
        passwordInput.current?.focus();
    }, []);

    /*
     * The deed waits for a download. The export reads the account table by table, and a delete
     * running through those tables part way through would leave the user with a partial copy of
     * exactly the data they are about to lose — or with none.
     */
    const busy = confirming || exporter.downloading;

    // Nothing closes the dialog while either is out. A deed that succeeds after its dialog was
    // dismissed would change the account unexplained, and a download is what the dialog is holding
    // the deed back for — dismissed, it would be one reopen away from the race it prevents.
    const cancel = () => {
        if (!busy) onCancel();
    };

    // A press on the backdrop is delivered to the `<dialog>` element itself; one on the panel is
    // not. Both halves have to land there, or selecting the password and releasing past the panel's
    // edge dismisses the dialog — `click` reports that release as a click on the backdrop.
    const dismiss = useDismissOnOutsidePress(cancel);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        // The disabled button already blocks Enter in a browser; this is the same rule for any other
        // way a submit arrives.
        if (busy) return;

        // Answered here rather than with the server's validation message, which names a field
        // rather than saying what to do.
        if (password.length === 0) {
            setError('Enter your password to confirm.');
            return;
        }

        setError(null);
        setConfirming(true);
        try {
            await onConfirm(password);
        } catch (err) {
            setError(err instanceof Error ? err.message : failure);
            setConfirming(false);
        }
    };

    return (
        <dialog
            ref={dialog}
            className="dialog-modal"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            // Escape. Always prevented, and the dialog closed by unmounting instead, so the page's
            // state and the browser's never disagree about whether it is open.
            onCancel={event => {
                event.preventDefault();
                cancel();
            }}
            // The browser can still close it without a preventable `cancel` — its close-watcher rules
            // let somebody out of a dialog that keeps refusing Escape. The page is told, so it does
            // not go on holding a dialog nobody can see, whose button would then open nothing. A
            // download still running stays held: its state is the card's, not this dialog's.
            onClose={onCancel}
            {...dismiss}
        >
            <div className="dialog-panel">
                <h2 id={titleId} className="dialog-title">{title}</h2>

                <div id={descriptionId} className="dialog-text">{children}</div>

                <div className="dialog-export">
                    <span>Want a copy first?</span>
                    <button
                        type="button"
                        className="dialog-btn-secondary"
                        onClick={() => void exporter.download()}
                        disabled={busy}
                    >
                        {exporter.downloading ? 'Preparing…' : 'Download your data'}
                    </button>
                </div>
                {exporter.error && <div className="dialog-error" role="alert">{exporter.error}</div>}

                <form onSubmit={handleSubmit} noValidate>
                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor={passwordId}>Password</label>
                        <input
                            ref={passwordInput}
                            id={passwordId}
                            type="password"
                            className="dialog-input"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            autoComplete="current-password"
                            disabled={confirming}
                            required
                        />
                    </div>

                    {error && <div className="dialog-error" role="alert">{error}</div>}

                    <div className="dialog-actions">
                        <button
                            type="button"
                            className="dialog-btn-secondary"
                            onClick={cancel}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                        <button type="submit" className="dialog-btn-danger" disabled={busy}>
                            {confirming ? confirmingLabel : confirmLabel}
                        </button>
                    </div>
                </form>
            </div>
        </dialog>
    );
}
