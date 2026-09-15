import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteAccountDialog } from '@/components/DeleteAccountDialog';
import { downloadDataExport } from '@/lib/dataExport';

vi.mock('@/lib/dataExport', () => ({ downloadDataExport: vi.fn(async () => {}) }));

const onCancel = vi.fn();
const onDelete = vi.fn(async (_password: string) => {});

function renderDialog() {
    return render(<DeleteAccountDialog userName="alex" onCancel={onCancel} onDelete={onDelete} />);
}

const dialog = () => screen.getByRole('dialog', { name: 'Delete your account?' });
const password = () => screen.getByLabelText('Password');
const deleteButton = () => screen.getByRole('button', { name: /delete my account|deleting/i });

/**
 * What a browser fires at a modal dialog when Escape is pressed. jsdom maps no key to it, so the
 * event is fired directly — which tests this component's handling of it, and leaves the mapping from
 * the key to the event where it belongs, with the browser.
 */
function pressEscape() {
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog(), cancel);
    return cancel;
}

/** Holds the export open until the returned function is called. */
function holdDownload() {
    let finish: () => void = () => {};
    vi.mocked(downloadDataExport).mockImplementationOnce(
        () => new Promise<void>(resolve => { finish = resolve; }));
    return () => finish();
}

beforeEach(() => {
    onCancel.mockReset();
    onDelete.mockReset();
    onDelete.mockResolvedValue(undefined);
    vi.mocked(downloadDataExport).mockReset();
    vi.mocked(downloadDataExport).mockResolvedValue(undefined);
});

describe('DeleteAccountDialog', () => {
    it('opens as a modal that names the account it deletes', () => {
        // showModal rather than an `open` attribute: only the modal makes the page behind it inert
        // and keeps focus inside, which is what the review of the first version found missing.
        const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
        renderDialog();

        expect(showModal).toHaveBeenCalledTimes(1);
        expect(dialog()).toHaveAttribute('open');
        expect(dialog()).toHaveAccessibleDescription(/permanently deletes @alex/i);
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
});

describe('DeleteAccountDialog closing', () => {
    it('closes on Cancel', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape, by unmounting rather than by letting the browser close it', () => {
        // Prevented, so the page's state and the browser's never disagree about whether it is open.
        renderDialog();

        const escape = pressEscape();

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(escape.defaultPrevented).toBe(true);
    });

    it('closes on a click on the backdrop, and not on one inside', async () => {
        // A click on the backdrop is delivered to the dialog element itself.
        const actor = userEvent.setup();
        renderDialog();

        await actor.click(screen.getByText('It cannot be undone.'));
        expect(onCancel).not.toHaveBeenCalled();

        await actor.click(dialog());
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('tells the page when the browser closes it anyway', () => {
        // A browser may close a dialog that keeps refusing Escape. Holding on to one nobody can see
        // would leave the card's button opening nothing.
        renderDialog();

        fireEvent(dialog(), new Event('close'));

        expect(onCancel).toHaveBeenCalledTimes(1);
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

        const escape = pressEscape();
        await actor.click(dialog());

        expect(onCancel).not.toHaveBeenCalled();
        expect(escape.defaultPrevented).toBe(true);

        finish();
    });
});

describe('DeleteAccountDialog export', () => {
    it('offers the export before anything is deleted', async () => {
        // The one moment somebody is certain to want a copy is just before it is gone (ADR 0024).
        const actor = userEvent.setup();
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Download your data' }));

        await waitFor(() => expect(downloadDataExport).toHaveBeenCalledTimes(1));
        expect(onDelete).not.toHaveBeenCalled();
    });

    it('will not delete while that export is still downloading', async () => {
        // The export reads table by table. A deletion cascading through them part way would leave a
        // partial copy — or none — of the data about to be lost.
        const actor = userEvent.setup();
        const finishDownload = holdDownload();
        renderDialog();

        await actor.type(password(), 'Passw0rd1');
        await actor.click(screen.getByRole('button', { name: 'Download your data' }));

        expect(deleteButton()).toBeDisabled();
        await actor.type(password(), '{Enter}');
        expect(onDelete).not.toHaveBeenCalled();

        finishDownload();

        await waitFor(() => expect(deleteButton()).toBeEnabled());
        await actor.click(deleteButton());
        expect(onDelete).toHaveBeenCalledWith('Passw0rd1');
    });

    it('says so when that export fails', async () => {
        const actor = userEvent.setup();
        vi.mocked(downloadDataExport).mockRejectedValueOnce(new Error('Export failed (500)'));
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Download your data' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be downloaded/i);
    });
});
