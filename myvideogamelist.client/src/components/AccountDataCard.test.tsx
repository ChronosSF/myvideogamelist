import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountDataCard } from '@/components/AccountDataCard';
import { downloadDataExport } from '@/lib/dataExport';
import type { StartOverResult } from '@/lib/startOver';

vi.mock('@/lib/dataExport', () => ({ downloadDataExport: vi.fn(async () => {}) }));

const onDeleteAccount = vi.fn(async (_password: string) => {});

const emptied: StartOverResult = { games: 312, wishlist: 4, favourites: 2, importRowsReselected: 0 };
const onStartOver = vi.fn(async (_password: string): Promise<StartOverResult> => emptied);

function renderCard() {
    return render(<AccountDataCard userName="alex" onDeleteAccount={onDeleteAccount} onStartOver={onStartOver} />);
}

beforeEach(() => {
    onDeleteAccount.mockReset();
    onStartOver.mockReset();
    onStartOver.mockResolvedValue(emptied);
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

describe('AccountDataCard start over', () => {
    it('asks for confirmation rather than emptying the library', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Empty my library' }));

        expect(screen.getByRole('dialog', { name: 'Empty your library?' })).toBeInTheDocument();
        expect(onStartOver).not.toHaveBeenCalled();
    });

    it('empties the library with the password, then says what went where its button is', async () => {
        // The dialog goes, so the outcome is said in a live region beside the button it was opened from,
        // and focus goes back to that button rather than to the top of the document.
        const actor = userEvent.setup();
        renderCard();
        const opener = screen.getByRole('button', { name: 'Empty my library' });

        await actor.click(opener);
        await actor.type(screen.getByLabelText('Password'), 'hunter2');
        await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Empty my library' }));

        expect(onStartOver).toHaveBeenCalledWith('hunter2');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('status')).toHaveTextContent(
            'Your library is empty: 312 games, 4 wishlisted games and 2 favourites removed.');
        expect(opener).toHaveFocus();
        expect(onDeleteAccount).not.toHaveBeenCalled();
    });

    it("keeps the dialog open with the server's refusal", async () => {
        const actor = userEvent.setup();
        onStartOver.mockRejectedValueOnce(new Error('Password is incorrect.'));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Empty my library' }));
        await actor.type(screen.getByLabelText('Password'), 'wrong');
        await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Empty my library' }));

        expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Password is incorrect.');
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('holds the start over while the file is being prepared', async () => {
        // The export reads table by table, and emptying those tables part way through would leave a
        // partial copy of the data about to be lost.
        const actor = userEvent.setup();
        let finish: () => void = () => {};
        vi.mocked(downloadDataExport).mockImplementationOnce(
            () => new Promise<void>(resolve => { finish = resolve; }));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Download my data' }));

        expect(screen.getByRole('button', { name: 'Empty my library' })).toBeDisabled();

        finish();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Empty my library' })).toBeEnabled());
    });

    it('forgets a download that failed in the dialog, rather than announcing it again beside the result', async () => {
        const actor = userEvent.setup();
        vi.mocked(downloadDataExport).mockRejectedValueOnce(new Error('Export failed (500)'));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Empty my library' }));
        await actor.click(screen.getByRole('button', { name: 'Download your data' }));
        expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(/could not be downloaded/i);

        await actor.type(screen.getByLabelText('Password'), 'hunter2');
        await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Empty my library' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('status')).toHaveTextContent(/your library is empty/i);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('clears the last result as the dialog opens, so the next one is announced even in the same words', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Empty my library' }));
        await actor.type(screen.getByLabelText('Password'), 'hunter2');
        await actor.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Empty my library' }));
        await waitFor(() => expect(screen.getByRole('status')).not.toBeEmptyDOMElement());

        await actor.click(screen.getByRole('button', { name: 'Empty my library' }));

        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('hands focus back to the button that opened the dialog, not the other one', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Empty my library' }));
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.getByRole('button', { name: 'Empty my library' })).toHaveFocus();

        await actor.click(screen.getByRole('button', { name: 'Delete my account' }));
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.getByRole('button', { name: 'Delete my account' })).toHaveFocus();
    });
});
