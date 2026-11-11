import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupDialog } from '@/components/SignupDialog';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { mousePress } from '@/test/press';

/**
 * Auth, mocked rather than provided: the real provider fetches, and this dialog only calls
 * `register`. One module-level object handed back on every call, never a fresh literal — a new
 * object per render re-runs any effect depending on it, which ends in a heap crash rather than a
 * failed assertion.
 */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => ({ emailSent: true })),
    resendConfirmation: vi.fn(async () => {}),
    confirmEmail: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    updateLook: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const onClose = vi.fn();
const onSwitchToLogin = vi.fn();

function renderDialog() {
    render(<SignupDialog onClose={onClose} onSwitchToLogin={onSwitchToLogin} />);
}

/** The overlay, which is what carries the dialog role here. */
const overlay = () => screen.getByRole('dialog', { name: 'Create Account' });
const userNameField = () => screen.getByLabelText('Username');

async function fillIn(actor: ReturnType<typeof userEvent.setup>) {
    await actor.type(userNameField(), 'alex');
    await actor.type(screen.getByLabelText('Email'), 'alex@test.local');
    await actor.type(screen.getByLabelText('Password'), 'Passw0rd1');
    await actor.type(screen.getByLabelText('Confirm Password'), 'Passw0rd1');
}

beforeEach(() => {
    onClose.mockReset();
    onSwitchToLogin.mockReset();
    vi.mocked(auth.register).mockResolvedValue({ emailSent: true });
    vi.mocked(auth.resendConfirmation).mockReset().mockResolvedValue(undefined);
});

describe('SignupDialog', () => {
    it('registers with what was typed and says where the link went, signing nobody in', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await fillIn(actor);
        await actor.click(screen.getByRole('button', { name: 'Create Account' }));

        expect(auth.register).toHaveBeenCalledWith('alex@test.local', 'Passw0rd1', 'alex');
        // Named by what is on it now, and still open: the account waits for its confirmation.
        const dialog = await screen.findByRole('dialog', { name: 'Check your inbox' });
        expect(dialog).toHaveTextContent('alex@test.local');
        expect(onClose).not.toHaveBeenCalled();
        // An address SES has stopped sending to is told nothing by the API, so a person is the way out (ADR 0091).
        expect(screen.getByRole('link', { name: 'support@myvideogamelist.net' }))
            .toHaveAttribute('href', 'mailto:support@myvideogamelist.net');
    });

    it('says so when the account was made and its email did not go', async () => {
        vi.mocked(auth.register).mockResolvedValue({ emailSent: false });
        const actor = userEvent.setup();
        renderDialog();

        await fillIn(actor);
        await actor.click(screen.getByRole('button', { name: 'Create Account' }));

        await screen.findByRole('dialog', { name: 'Your account is ready' });
        expect(screen.getByRole('alert')).toHaveTextContent(/did not go/i);
    });

    it('sends the link again to the address it was made with', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await fillIn(actor);
        await actor.click(screen.getByRole('button', { name: 'Create Account' }));
        await actor.click(await screen.findByRole('button', { name: 'Send the link again' }));

        expect(auth.resendConfirmation).toHaveBeenCalledWith('alex@test.local');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/new link is on its way/i));
    });

    it('offers to sign in from where the link went', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await fillIn(actor);
        await actor.click(screen.getByRole('button', { name: 'Create Account' }));
        await actor.click(await screen.findByRole('button', { name: 'Sign In' }));

        expect(onSwitchToLogin).toHaveBeenCalledTimes(1);
    });

    it('answers a mistyped confirmation without a round trip', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await fillIn(actor);
        await actor.type(screen.getByLabelText('Confirm Password'), 'typo');
        await actor.click(screen.getByRole('button', { name: 'Create Account' }));

        expect(screen.getByRole('alert')).toHaveTextContent(/passwords do not match/i);
        expect(auth.register).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});

/**
 * The same four cases as the sign-in dialog, because this overlay is that one: both take the guard
 * from `useDismissOnOutsidePress`, and asserting it on only one of them is how the two drift apart.
 */
describe('SignupDialog dismissal', () => {
    it('stays open when a selection started in a field ends on the overlay', () => {
        renderDialog();

        mousePress(userNameField(), overlay());

        expect(onClose).not.toHaveBeenCalled();
    });

    it('stays open when a press on the overlay is released inside the panel', () => {
        renderDialog();

        mousePress(overlay(), userNameField());

        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes when the press goes down and comes up on the overlay', () => {
        renderDialog();

        mousePress(overlay());

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on the close button', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
