import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteAccountDialog } from '@/components/DeleteAccountDialog';
import { downloadDataExport } from '@/lib/dataExport';

vi.mock('@/lib/dataExport', () => ({ downloadDataExport: vi.fn(async () => {}) }));

const onCancel = vi.fn();
const onDelete = vi.fn(async (_password: string) => {});

function renderDialog() {
    return render(<DeleteAccountDialog userName="alex" onCancel={onCancel} onDelete={onDelete} />);
}

const password = () => screen.getByLabelText('Password');
const deleteButton = () => screen.getByRole('button', { name: /delete my account|deleting/i });

beforeEach(() => {
    onCancel.mockReset();
    onDelete.mockReset();
    onDelete.mockResolvedValue(undefined);
    vi.mocked(downloadDataExport).mockReset();
    vi.mocked(downloadDataExport).mockResolvedValue(undefined);
});

describe('DeleteAccountDialog', () => {
    it('is a modal dialog that names the account it deletes', () => {
        renderDialog();

        const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleDescription(/permanently deletes @alex/i);
        expect(password()).toHaveFocus();
    });

    it('deletes with the password that was typed', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await actor.type(password(), 'Passw0rd1');
        await actor.click(deleteButton());

        expect(onDelete).toHaveBeenCalledWith('Passw0rd1');
    });

    it('asks for the password rather than sending an empty one', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await actor.click(deleteButton());

        expect(screen.getByRole('alert')).toHaveTextContent(/enter your password/i);
        expect(onDelete).not.toHaveBeenCalled();
    });

    it("shows the server's refusal and lets the user try again", async () => {
        // A wrong password is the likely failure, and the API's sentence for it is the one to show.
        const actor = userEvent.setup();
        onDelete.mockRejectedValueOnce(new Error('Password is incorrect.'));
        renderDialog();

        await actor.type(password(), 'wrong');
        await actor.click(deleteButton());

        expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect.');
        expect(deleteButton()).toBeEnabled();
        expect(password()).toBeEnabled();
    });

    it('holds every way out while the deletion is in flight', async () => {
        // A deletion that lands after its dialog was dismissed would sign somebody out unexplained.
        const actor = userEvent.setup();
        let finish: () => void = () => {};
        onDelete.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        renderDialog();

        await actor.type(password(), 'Passw0rd1');
        await actor.click(deleteButton());

        expect(deleteButton()).toHaveTextContent('Deleting…');
        expect(deleteButton()).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

        await actor.keyboard('{Escape}');
        expect(onCancel).not.toHaveBeenCalled();

        finish();
    });

    it('closes on Cancel and on Escape', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);

        await actor.click(password());
        await actor.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledTimes(2);
    });

    it('offers the export before anything is deleted', async () => {
        // The one moment somebody is certain to want a copy is just before it is gone (ADR 0024).
        const actor = userEvent.setup();
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Download your data' }));

        await waitFor(() => expect(downloadDataExport).toHaveBeenCalledTimes(1));
        expect(onDelete).not.toHaveBeenCalled();
    });

    it('says so when that export fails', async () => {
        const actor = userEvent.setup();
        vi.mocked(downloadDataExport).mockRejectedValueOnce(new Error('Export failed (500)'));
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Download your data' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be downloaded/i);
    });
});
