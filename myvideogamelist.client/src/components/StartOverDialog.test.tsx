import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StartOverDialog } from '@/components/StartOverDialog';
import { useDataExport } from '@/hooks/useDataExport';

vi.mock('@/lib/dataExport', () => ({ downloadDataExport: vi.fn(async () => {}) }));

const onCancel = vi.fn();
const onStartOver = vi.fn(async (_password: string) => {});

/**
 * How it asks — the modal, its ways out, the export it waits for — is `PasswordConfirmDialog`'s,
 * which `DeleteAccountDialog`'s tests cover. These are about what this one says and sends.
 */
function Harness() {
    const exporter = useDataExport();
    return <StartOverDialog userName="alex" onCancel={onCancel} onStartOver={onStartOver} exporter={exporter} />;
}

const dialog = () => screen.getByRole('dialog', { name: 'Empty your library?' });
const confirm = () => within(dialog()).getByRole('button', { name: /empty my library|emptying/i });

beforeEach(() => {
    onCancel.mockReset();
    onStartOver.mockReset();
    onStartOver.mockResolvedValue(undefined);
});

describe('StartOverDialog', () => {
    it('opens as a modal that names the account and says what goes and what stays', () => {
        render(<Harness />);

        expect(dialog()).toHaveAttribute('open');
        expect(dialog()).toHaveAccessibleDescription(/every game recorded under @alex/i);
        expect(dialog()).toHaveAccessibleDescription(/your wishlist, your favourites, and the history behind your stats/i);
        expect(dialog()).toHaveAccessibleDescription(/your account stays, with your profile, your look, your tags and your list names/i);
        expect(dialog()).toHaveAccessibleDescription(/cannot be undone/i);
        expect(screen.getByLabelText('Password')).toHaveFocus();
    });

    it('offers the export first', () => {
        render(<Harness />);

        expect(within(dialog()).getByRole('button', { name: 'Download your data' })).toBeEnabled();
    });

    it('empties the library with the password that was typed, and holds while it does', async () => {
        const actor = userEvent.setup();
        let finish: () => void = () => {};
        onStartOver.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        render(<Harness />);

        await actor.type(screen.getByLabelText('Password'), 'hunter2');
        await actor.click(confirm());

        expect(onStartOver).toHaveBeenCalledWith('hunter2');
        expect(confirm()).toHaveTextContent('Emptying…');
        expect(confirm()).toBeDisabled();
        expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeDisabled();

        finish();
    });

    it('asks for the password rather than sending an empty one', async () => {
        const actor = userEvent.setup();
        render(<Harness />);

        await actor.click(confirm());

        expect(within(dialog()).getByRole('alert')).toHaveTextContent('Enter your password to confirm.');
        expect(onStartOver).not.toHaveBeenCalled();
    });

    it("shows the server's refusal and lets the user try again", async () => {
        const actor = userEvent.setup();
        onStartOver.mockRejectedValueOnce(new Error('Password is incorrect.'));
        render(<Harness />);

        await actor.type(screen.getByLabelText('Password'), 'wrong');
        await actor.click(confirm());

        expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Password is incorrect.');
        expect(confirm()).toHaveTextContent('Empty my library');
        expect(confirm()).toBeEnabled();
    });
});
