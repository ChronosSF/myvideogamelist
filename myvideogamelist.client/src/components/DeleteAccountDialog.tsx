import { PasswordConfirmDialog } from '@/components/PasswordConfirmDialog';
import type { UseDataExportResult } from '@/hooks/useDataExport';

interface Props {
    userName: string;
    /** Takes the dialog away. Also called when the browser closes it without asking. */
    onCancel: () => void;
    /**
     * Deletes the account. Rejects with a sentence for the user — a wrong password, most often. On
     * success the page moves on to a signed-out state and this dialog unmounts with it.
     */
    onDelete: (password: string) => Promise<void>;
    /** The card's download. See `PasswordConfirmDialog`. */
    exporter: UseDataExportResult;
}

/**
 * The confirmation in front of `DELETE /api/user`, which has no undo: the account's password, with
 * the export offered first (ADR 0024). How it asks is `PasswordConfirmDialog`'s, which it shares with
 * starting over.
 */
export function DeleteAccountDialog({ userName, onCancel, onDelete, exporter }: Props) {
    return (
        <PasswordConfirmDialog
            title="Delete your account?"
            confirmLabel="Delete my account"
            confirmingLabel="Deleting…"
            failure="Failed to delete your account."
            onCancel={onCancel}
            onConfirm={onDelete}
            exporter={exporter}
        >
            <p>
                This permanently deletes <strong>@{userName}</strong> and everything recorded
                under it: your lists and scores, playthroughs, reviews, wishlist, and the
                history behind your stats.
            </p>
            <p>It cannot be undone.</p>
        </PasswordConfirmDialog>
    );
}
