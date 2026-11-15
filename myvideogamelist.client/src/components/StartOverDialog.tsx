import { PasswordConfirmDialog } from '@/components/PasswordConfirmDialog';
import type { UseDataExportResult } from '@/hooks/useDataExport';

interface Props {
    userName: string;
    /** Takes the dialog away. Also called when the browser closes it without asking. */
    onCancel: () => void;
    /**
     * Empties the library. Rejects with a sentence for the user — a wrong password, most often. On
     * success the card takes the dialog away and says what went.
     */
    onStartOver: (password: string) => Promise<void>;
    /** The card's download. See `PasswordConfirmDialog`. */
    exporter: UseDataExportResult;
}

/**
 * The confirmation in front of `DELETE /api/user/library`, which empties the library and keeps the
 * account, for somebody whose import went wrong and wants to import again from scratch (ADR 0095).
 *
 * Asked as deleting the account is asked, with the password and the export first, because nothing it
 * deletes comes back either. It says what stays as plainly as what goes, since keeping the account is
 * the whole difference between the two.
 */
export function StartOverDialog({ userName, onCancel, onStartOver, exporter }: Props) {
    return (
        <PasswordConfirmDialog
            title="Empty your library?"
            confirmLabel="Empty my library"
            confirmingLabel="Emptying…"
            failure="Your library could not be emptied. Please try again."
            onCancel={onCancel}
            onConfirm={onStartOver}
            exporter={exporter}
        >
            <p>
                This deletes every game recorded under <strong>@{userName}</strong>: your lists and
                scores, playthroughs, reviews and the tags on your games, your wishlist, your
                favourites, and the history behind your stats.
            </p>
            <p>
                Your account stays, with your profile, your look, your tags and your list names, so you
                can import again from scratch. It cannot be undone.
            </p>
        </PasswordConfirmDialog>
    );
}
