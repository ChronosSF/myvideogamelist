import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForgotPasswordDialog } from '@/components/ForgotPasswordDialog';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { quickActor } from '@/test/actor';
import { mousePress } from '@/test/press';

/** One module-level object, never a fresh literal per render (see the LoginDialog suite). */
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

function renderDialog(initial = '') {
    render(<ForgotPasswordDialog initialEmailOrUserName={initial} onClose={onClose} onSwitchToLogin={onSwitchToLogin} />);
}

const field = () => screen.getByLabelText('Email or username');

beforeEach(() => {
    vi.mocked(auth.requestPasswordReset).mockResolvedValue(undefined);
});

describe('ForgotPasswordDialog', () => {
    it('starts from what the sign-in dialog held, asks for the link, and says where to look', async () => {
        const actor = quickActor();
        renderDialog('alex');

        expect(field()).toHaveValue('alex');
        await actor.click(screen.getByRole('button', { name: 'Send the link' }));

        expect(auth.requestPasswordReset).toHaveBeenCalledWith('alex');
        expect(await screen.findByRole('dialog', { name: 'Check your inbox' })).toBeInTheDocument();
        // Hedged, because the API answers the same whether or not an account goes by it (ADR 0090), and
        // naming only what was typed: a username's address is never shown.
        expect(screen.getByRole('status')).toHaveTextContent('If an account goes by alex, we have sent a link to its email address.');
    });

    it('sends what was typed without the spaces around it', async () => {
        const actor = quickActor();
        renderDialog();

        await actor.type(field(), '  alex@test.local ');
        await actor.click(screen.getByRole('button', { name: 'Send the link' }));

        expect(auth.requestPasswordReset).toHaveBeenCalledWith('alex@test.local');
    });

    it('asks the API nothing until something is typed', async () => {
        const actor = quickActor();
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Send the link' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Enter the email address or the username you signed up with.');
        expect(auth.requestPasswordReset).not.toHaveBeenCalled();
    });

    it("shows the API's own sentence when the request is refused, and stays on the form", async () => {
        // A rate-limited request, which is the refusal it can meet.
        const actor = quickActor();
        vi.mocked(auth.requestPasswordReset).mockRejectedValueOnce(
            new Error('Too many attempts from this device. Wait a few minutes and try again.'));
        renderDialog('alex');

        await actor.click(screen.getByRole('button', { name: 'Send the link' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts from this device.');
        expect(screen.getByRole('dialog', { name: 'Forgot your password?' })).toBeInTheDocument();
    });

    it('goes back to the sign-in', async () => {
        const actor = quickActor();
        renderDialog();

        await actor.click(screen.getByRole('button', { name: 'Sign In' }));

        expect(onSwitchToLogin).toHaveBeenCalledTimes(1);
    });

    it('closes on a press that is outside at both ends, as the other dialogs do', () => {
        renderDialog();

        mousePress(field(), screen.getByRole('dialog'));
        expect(onClose).not.toHaveBeenCalled();

        mousePress(screen.getByRole('dialog'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
