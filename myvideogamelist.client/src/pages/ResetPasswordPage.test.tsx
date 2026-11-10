import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ResetPasswordPage, { headers, meta } from '@/pages/ResetPasswordPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { AuthDialogContextValue } from '@/contexts/AuthDialogContext';
import { InvalidResetLinkError } from '@/types/auth';
import { type Actor, quickActor } from '@/test/actor';

/** One module-level object, never a fresh literal per render (see the other page tests). */
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
const dialog: AuthDialogContextValue = { open: vi.fn() };

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useAuthDialog', () => ({ useAuthDialog: () => dialog }));

const CHOSEN = 'new-passw0rd';

function openAt(fragment: string) {
    window.history.replaceState(null, '', `/reset-password${fragment}`);
    render(<ResetPasswordPage />);
}

async function choose(actor: Actor, password = CHOSEN, confirm = password) {
    await actor.type(screen.getByLabelText('New password'), password);
    await actor.type(screen.getByLabelText('Confirm new password'), confirm);
    await actor.click(screen.getByRole('button', { name: 'Set the new password' }));
}

beforeEach(() => {
    vi.mocked(auth.resetPassword).mockResolvedValue(undefined);
});

afterEach(() => {
    window.history.replaceState(null, '', '/');
});

describe('ResetPasswordPage', () => {
    it('takes the link out of the address bar before anything is typed, and keeps it', async () => {
        // A reset link left in the history is a new password for whoever uses the browser next (ADR 0090).
        const actor = quickActor();
        openAt('#user=0f8a-id&token=CfDJ8%2Ba%2Fb%3D');

        expect(await screen.findByLabelText('New password')).toBeInTheDocument();
        expect(window.location.hash).toBe('');
        expect(window.location.pathname).toBe('/reset-password');

        await choose(actor);
        expect(auth.resetPassword).toHaveBeenCalledWith('0f8a-id', 'CfDJ8+a/b=', CHOSEN);
    });

    it('says the password is changed and everyone signed out, and offers the sign-in', async () => {
        const actor = quickActor();
        openAt('#user=0f8a-id&token=secret');

        await choose(actor);

        expect(await screen.findByRole('status')).toHaveTextContent(/your password is changed, and you are signed out everywhere/i);
        await actor.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(dialog.open).toHaveBeenCalledWith('login');
    });

    it('asks the API nothing while the two passwords differ', async () => {
        const actor = quickActor();
        openAt('#user=0f8a-id&token=secret');

        await choose(actor, CHOSEN, 'something-else-1');

        expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
        expect(auth.resetPassword).not.toHaveBeenCalled();
    });

    it("shows the rules' sentences beside the form when the API refuses the password, and lets it be tried again", async () => {
        // The link still works: a refused password spends nothing.
        const actor = quickActor();
        vi.mocked(auth.resetPassword).mockRejectedValueOnce(new Error("Passwords must have at least one digit ('0'-'9')."));
        openAt('#user=0f8a-id&token=secret');

        await choose(actor, 'no-digits-here');
        expect(await screen.findByRole('alert')).toHaveTextContent('Passwords must have at least one digit');

        await actor.clear(screen.getByLabelText('New password'));
        await actor.clear(screen.getByLabelText('Confirm new password'));
        await choose(actor);
        expect(await screen.findByRole('status')).toHaveTextContent(/your password is changed/i);
        expect(auth.resetPassword).toHaveBeenLastCalledWith('0f8a-id', 'secret', CHOSEN);
    });

    it('offers a new link when the API says this one is no good', async () => {
        const actor = quickActor();
        vi.mocked(auth.resetPassword).mockRejectedValueOnce(
            new InvalidResetLinkError('This link has expired or has already been used. Ask for a new one.'));
        openAt('#user=0f8a-id&token=old');

        await choose(actor);

        expect(await screen.findByText('That link did not work')).toBeInTheDocument();
        expect(screen.getByText('This link has expired or has already been used. Ask for a new one.')).toBeInTheDocument();
        expect(screen.queryByLabelText('New password')).toBeNull();
        await actor.click(screen.getByRole('button', { name: 'Ask for a new link' }));
        expect(dialog.open).toHaveBeenCalledWith('forgot-password');
    });

    it('takes a second link opened in the same tab in place of the first', async () => {
        // A browser follows a link that differs only after the `#` without loading the page again.
        const actor = quickActor();
        vi.mocked(auth.resetPassword).mockRejectedValueOnce(new InvalidResetLinkError('This link has expired.'));
        openAt('#user=0f8a-id&token=old');
        await choose(actor);
        await screen.findByText('That link did not work');

        act(() => {
            window.location.hash = '#user=0f8a-id&token=new';
        });

        expect(await screen.findByLabelText('New password')).toBeInTheDocument();
        expect(screen.queryByText('That link did not work')).toBeNull();
        await choose(actor);
        expect(auth.resetPassword).toHaveBeenLastCalledWith('0f8a-id', 'new', CHOSEN);
    });

    it.each(['#user=0f8a-id', ''])('says a link without both halves (%j) is not complete, and offers a new one', async fragment => {
        const actor = quickActor();
        openAt(fragment);

        expect(await screen.findByText('This link is not complete')).toBeInTheDocument();
        expect(screen.queryByLabelText('New password')).toBeNull();
        await actor.click(screen.getByRole('button', { name: 'Ask for a new link' }));
        expect(dialog.open).toHaveBeenCalledWith('forgot-password');
    });

    it('is never cached and never indexed', () => {
        expect(headers()).toEqual({ 'Cache-Control': 'private, no-store' });
        expect(meta()).toContainEqual({ name: 'robots', content: 'noindex' });
    });
});
