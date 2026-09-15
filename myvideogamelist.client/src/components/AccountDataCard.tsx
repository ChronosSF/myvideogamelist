import { useRef, useState } from 'react';
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
    const exporter = useDataExport();
    const [confirming, setConfirming] = useState(false);
    const deleteButton = useRef<HTMLButtonElement>(null);

    // Focus goes back to the button that opened the dialog, or a keyboard user who cancels is left
    // at the top of the document.
    const closeDialog = () => {
        setConfirming(false);
        deleteButton.current?.focus();
    };

    return (
        <div className="user-card">
            <div className="user-card-label">Your data</div>
            <p className="user-card-hint">
                Everything you have entered — lists, scores, playthroughs, reviews, your wishlist
                and the history behind your stats — as one JSON file. Games are identified by their
                IGDB id.
            </p>

            {/* A live region, because the button beside it just goes back to how it was. */}
            {exporter.error && <p className="user-pref-error" role="alert">{exporter.error}</p>}

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

            <button
                ref={deleteButton}
                type="button"
                className="user-btn user-btn-block user-btn-danger user-card-action"
                onClick={() => setConfirming(true)}
                aria-haspopup="dialog"
            >
                Delete my account
            </button>

            {confirming && (
                <DeleteAccountDialog
                    userName={userName}
                    onCancel={closeDialog}
                    onDelete={onDeleteAccount}
                />
            )}
        </div>
    );
}
