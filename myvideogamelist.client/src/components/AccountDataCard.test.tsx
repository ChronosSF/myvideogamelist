import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

    it('hands focus back to its button when the dialog is cancelled', async () => {
        // Otherwise a keyboard user who backs out is left at the top of the document.
        const actor = userEvent.setup();
        renderCard();
        const opener = screen.getByRole('button', { name: 'Delete my account' });

        await actor.click(opener);
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });
});
