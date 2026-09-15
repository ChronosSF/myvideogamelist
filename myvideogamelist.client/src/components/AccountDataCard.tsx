import { useEffect, useRef, useState } from 'react';
import { DeleteAccountDialog } from '@/components/DeleteAccountDialog';
import { useDataExport } from '@/hooks/useDataExport';

interface Props {
    userName: string;
    /** Rejects with a sentence for the user. See `DeleteAccountDialog`. */
    onDeleteAccount: (password: string) => Promise<void>;
}

/**
 * Taking your data with you, and leaving with it — the two halves of ADR 0024's ownership contract,
 * which shipped as endpoints and waited here for their buttons.
 *
 * One card because they are one obligation seen from either side. The download is free and needs
 * no confirmation; the deletion needs the account's password, asked for in a dialog that offers
 * the download again.
 */
export function AccountDataCard({ userName, onDeleteAccount }: Props) {
    /**
     * One download for the card and its dialog, held here because the card outlives the dialog. A
     * download started in the dialog keeps the deletion held however the dialog is then closed —
     * including by the browser, which can close a modal the dialog itself refuses to.
     */
    const exporter = useDataExport();
    const [confirming, setConfirming] = useState(false);
    const deleteButton = useRef<HTMLButtonElement>(null);

    /**
     * Set when the dialog is dismissed, and acted on once the dismissal has rendered. Focus cannot go
     * back to the opener from the handler itself: the modal is still open at that point, the opener
     * behind it is inert, and a browser ignores `focus()` on an inert element.
     */
    const refocusOpener = useRef(false);

    const closeDialog = () => {
        refocusOpener.current = true;
        setConfirming(false);
    };

    // Runs after the commit that removes the dialog, when the page behind it is no longer inert.
    // Without it a keyboard user who cancels is left at the top of the document.
    useEffect(() => {
        if (confirming || !refocusOpener.current) return;

        refocusOpener.current = false;
        deleteButton.current?.focus();
    }, [confirming]);

    return (
        <div className="user-card">
            <div className="user-card-label">Your data</div>
            <p className="user-card-hint">
                Everything you have entered — lists, scores, playthroughs, reviews, your wishlist
                and the history behind your stats — as one JSON file. Games are identified by their
                IGDB id.
            </p>

            {/* A live region, because the button beside it just goes back to how it was. Not while
                the dialog is open: the download is shared, and the dialog reports its own. */}
            {exporter.error && !confirming && <p className="user-pref-error" role="alert">{exporter.error}</p>}

            <button
                type="button"
                className="user-btn user-btn-block user-card-action"
                onClick={() => void exporter.download()}
                disabled={exporter.downloading}
            >
                {exporter.downloading ? 'Preparing your file…' : 'Download my data'}
            </button>

            <hr className="user-card-rule" />

            <div className="user-card-label">Delete account</div>
            <p className="user-card-hint">
                Removes your account and everything in it, for good. You will be asked for your
                password first.
            </p>

            {/* Held while a download is running, whichever button started it. The export reads the
                account table by table, and a deletion cascading through those tables part way
                through would leave a partial copy of the data about to be lost. */}
            <button
                ref={deleteButton}
                type="button"
                className="user-btn user-btn-block user-btn-danger user-card-action"
                onClick={() => setConfirming(true)}
                disabled={exporter.downloading}
                aria-haspopup="dialog"
            >
                Delete my account
            </button>

            {confirming && (
                <DeleteAccountDialog
                    userName={userName}
                    onCancel={closeDialog}
                    onDelete={onDeleteAccount}
                    exporter={exporter}
                />
            )}
        </div>
    );
}
