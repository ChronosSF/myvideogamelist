import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountDataCard } from '@/components/AccountDataCard';
import { downloadDataExport } from '@/lib/dataExport';

vi.mock('@/lib/dataExport', () => ({ downloadDataExport: vi.fn(async () => {}) }));

const onDeleteAccount = vi.fn(async (_password: string) => {});

function renderCard() {
    return render(<AccountDataCard userName="alex" onDeleteAccount={onDeleteAccount} />);
}

beforeEach(() => {
    onDeleteAccount.mockReset();
    vi.mocked(downloadDataExport).mockReset();
    vi.mocked(downloadDataExport).mockResolvedValue(undefined);
});

describe('AccountDataCard download', () => {
    it('downloads the export', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Download my data' }));

        await waitFor(() => expect(downloadDataExport).toHaveBeenCalledTimes(1));
    });

    it('holds the button while the file is being prepared', async () => {
        // The export is one query per table; a second press while it runs would fetch it twice.
        const actor = userEvent.setup();
        let finish: () => void = () => {};
        vi.mocked(downloadDataExport).mockImplementationOnce(
            () => new Promise<void>(resolve => { finish = resolve; }));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Download my data' }));

        expect(screen.getByRole('button', { name: /preparing your file/i })).toBeDisabled();

        finish();
        expect(await screen.findByRole('button', { name: 'Download my data' })).toBeEnabled();
    });

    it('holds the deletion while the file is being prepared', async () => {
        // The export reads table by table, and a deletion cascading through those tables part way
        // through would leave a partial copy of the data about to be lost.
        const actor = userEvent.setup();
        let finish: () => void = () => {};
        vi.mocked(downloadDataExport).mockImplementationOnce(
            () => new Promise<void>(resolve => { finish = resolve; }));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Download my data' }));

        expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();

        finish();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled());
    });

    it('announces a failed download', async () => {
        const actor = userEvent.setup();
        vi.mocked(downloadDataExport).mockRejectedValueOnce(new Error('Export failed (500)'));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Download my data' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be downloaded/i);
        expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
    });
});

describe('AccountDataCard deletion', () => {
    it('asks for confirmation rather than deleting', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Delete my account' }));

        expect(screen.getByRole('dialog', { name: 'Delete your account?' })).toBeInTheDocument();
        expect(onDeleteAccount).not.toHaveBeenCalled();
    });

    it('hands focus back to its button once the dialog has gone', async () => {
        // Otherwise a keyboard user who backs out is left at the top of the document. The test setup's
        // modal makes everything outside it inert, as a browser does, so this passes only when focus
        // moves after the dialog has unmounted — from the Cancel handler itself it would be ignored.
        const actor = userEvent.setup();
        renderCard();
        const opener = screen.getByRole('button', { name: 'Delete my account' });

        await actor.click(opener);
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });

    it('keeps the deletion held when the dialog is closed while its download runs', async () => {
        // The dialog refuses to close mid-download, but a browser can close a modal anyway. The
        // download's state is the card's, so reopening the dialog cannot race the export.
        const actor = userEvent.setup();
        let finish: () => void = () => {};
        vi.mocked(downloadDataExport).mockImplementationOnce(
            () => new Promise<void>(resolve => { finish = resolve; }));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Delete my account' }));
        await actor.click(screen.getByRole('button', { name: 'Download your data' }));
        fireEvent(screen.getByRole('dialog'), new Event('close'));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /preparing your file/i })).toBeDisabled();

        finish();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled());
    });

    it('reports a download that failed in the dialog once, in the dialog', async () => {
        // The download is shared, so the card holds back its own copy of the error while the dialog
        // is open rather than announcing it twice.
        const actor = userEvent.setup();
        vi.mocked(downloadDataExport).mockRejectedValueOnce(new Error('Export failed (500)'));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Delete my account' }));
        await actor.click(screen.getByRole('button', { name: 'Download your data' }));

        const alert = await within(screen.getByRole('dialog')).findByRole('alert');
        expect(alert).toHaveTextContent(/could not be downloaded/i);
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });
});
