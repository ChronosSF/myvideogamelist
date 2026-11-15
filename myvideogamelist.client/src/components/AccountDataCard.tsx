import { useEffect, useRef, useState } from 'react';
import { DeleteAccountDialog } from '@/components/DeleteAccountDialog';
import { StartOverDialog } from '@/components/StartOverDialog';
import { useDataExport } from '@/hooks/useDataExport';
import { startOverSummary, type StartOverResult } from '@/lib/startOver';

interface Props {
    userName: string;
    /** Rejects with a sentence for the user. See `DeleteAccountDialog`. */
    onDeleteAccount: (password: string) => Promise<void>;
    /** Empties the library and keeps the account. Rejects with a sentence for the user (ADR 0095). */
    onStartOver: (password: string) => Promise<StartOverResult>;
}

/** Which of the card's two confirmations is open, if either. */
type Confirming = 'start-over' | 'delete' | null;

/**
 * Taking your data with you, starting over, and leaving with it: ADR 0024's ownership contract, and
 * ADR 0095's way back to an empty library that keeps the account.
 *
 * One card because they are one subject seen from three sides. The download is free and needs no
 * confirmation; emptying the library and deleting the account each need the account's password,
 * asked for in a dialog that offers the download again.
 */
export function AccountDataCard({ userName, onDeleteAccount, onStartOver }: Props) {
    /**
     * One download for the card and its dialogs, held here because the card outlives them. A download
     * started in a dialog keeps both deeds held however the dialog is then closed — including by the
     * browser, which can close a modal the dialog itself refuses to.
     */
    const exporter = useDataExport();
    const [confirming, setConfirming] = useState<Confirming>(null);
    const [startedOver, setStartedOver] = useState<StartOverResult | null>(null);
    const startOverButton = useRef<HTMLButtonElement>(null);
    const deleteButton = useRef<HTMLButtonElement>(null);

    /**
     * Which opener to hand focus back to, set when a dialog goes and acted on once that has rendered.
     * Focus cannot go back from the handler itself: the modal is still open at that point, the opener
     * behind it is inert, and a browser ignores `focus()` on an inert element.
     */
    const refocusOpener = useRef<Confirming>(null);

    const closeDialog = () => {
        refocusOpener.current = confirming;
        setConfirming(null);
    };

    // Runs after the commit that removes the dialog, when the page behind it is no longer inert.
    // Without it a keyboard user who cancels is left at the top of the document.
    useEffect(() => {
        if (confirming !== null || refocusOpener.current === null) return;

        const opener = refocusOpener.current === 'start-over' ? startOverButton : deleteButton;
        refocusOpener.current = null;
        opener.current?.focus();
    }, [confirming]);

    // The dialog goes once the library is empty, and the card says what went where the button is.
    const startOver = async (password: string) => {
        const result = await onStartOver(password);
        setStartedOver(result);
        closeDialog();
    };

    return (
        <div className="user-card">
            <div className="user-card-label">Your data</div>
            <p className="user-card-hint">
                Everything you have entered — lists, scores, playthroughs, reviews, your wishlist
                and the history behind your stats — as one JSON file. Games are identified by their
                IGDB id. It can be imported back, here or into another account, though only your
                games come back with it, not their history, tags or settings.
            </p>

            {/* A live region, because the button beside it just goes back to how it was. Not while
                a dialog is open: the download is shared, and the dialog reports its own. */}
            {exporter.error && confirming === null && <p className="user-pref-error" role="alert">{exporter.error}</p>}

            <button
                type="button"
                className="user-btn user-btn-block user-card-action"
                onClick={() => void exporter.download()}
                disabled={exporter.downloading}
            >
                {exporter.downloading ? 'Preparing your file…' : 'Download my data'}
            </button>

            <hr className="user-card-rule" />

            <div className="user-card-label">Start over</div>
            <p className="user-card-hint">
                Empties your library and keeps your account, so you can import again from scratch.
                Your lists, scores, playthroughs, reviews, wishlist, favourites and the history behind
                your stats go; your profile, look, tags and list names stay. You will be asked for your
                password first.
            </p>

            {/* Held while a download is running, as the deletion is: the export reads the account table
                by table, and emptying those tables part way through would leave a partial copy. */}
            <button
                ref={startOverButton}
                type="button"
                className="user-btn user-btn-block user-btn-danger user-card-action"
                onClick={() => setConfirming('start-over')}
                disabled={exporter.downloading}
                aria-haspopup="dialog"
            >
                Empty my library
            </button>

            {/* In the document before it has anything to say, so that what it then says is announced:
                the dialog that made the request has just gone. */}
            <div role="status">
                {startedOver !== null && <p className="user-card-hint">{startOverSummary(startedOver)}</p>}
            </div>

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
                onClick={() => setConfirming('delete')}
                disabled={exporter.downloading}
                aria-haspopup="dialog"
            >
                Delete my account
            </button>

            {confirming === 'start-over' && (
                <StartOverDialog
                    userName={userName}
                    onCancel={closeDialog}
                    onStartOver={startOver}
                    exporter={exporter}
                />
            )}

            {confirming === 'delete' && (
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
