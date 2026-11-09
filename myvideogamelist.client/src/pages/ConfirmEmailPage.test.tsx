import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmEmailPage, { headers, meta } from '@/pages/ConfirmEmailPage';
import { linkIn } from '@/lib/confirmationLink';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { AuthDialogContextValue } from '@/contexts/AuthDialogContext';

/** One module-level object, never a fresh literal per render (see the other page tests). */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => ({ emailSent: true })),
    resendConfirmation: vi.fn(async () => {}),
    confirmEmail: vi.fn(async () => {}),
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

function openAt(fragment: string) {
    window.history.replaceState(null, '', `/confirm-email${fragment}`);
    render(<ConfirmEmailPage />);
}

beforeEach(() => {
    vi.mocked(auth.confirmEmail).mockReset().mockResolvedValue(undefined);
    vi.mocked(dialog.open).mockReset();
});

afterEach(() => {
    window.history.replaceState(null, '', '/');
});

describe('linkIn', () => {
    it('reads the account and the token, decoded', () => {
        expect(linkIn('#user=0f8a-id&token=CfDJ8%2Ba%2Fb%3D')).toEqual({ userId: '0f8a-id', token: 'CfDJ8+a/b=' });
    });

    it.each(['', '#', '#user=0f8a-id', '#token=abc', '#user=&token=abc'])('finds no link in %j', fragment => {
        expect(linkIn(fragment)).toBeNull();
    });
});

describe('ConfirmEmailPage', () => {
    it('posts the two halves of the link, says the address is confirmed, and offers to sign in', async () => {
        const actor = userEvent.setup();
        openAt('#user=0f8a-id&token=CfDJ8%2Ba%2Fb%3D');

        expect(await screen.findByText(/your email address is confirmed/i)).toBeInTheDocument();
        expect(auth.confirmEmail).toHaveBeenCalledWith('0f8a-id', 'CfDJ8+a/b=');

        await actor.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(dialog.open).toHaveBeenCalledWith('login');
    });

    it('takes the token out of the address bar once it has been used', async () => {
        openAt('#user=0f8a-id&token=secret');

        await screen.findByText(/your email address is confirmed/i);

        await waitFor(() => expect(window.location.hash).toBe(''));
        expect(window.location.pathname).toBe('/confirm-email');
    });

    it("shows the API's sentence when the link is refused, and takes the token out all the same", async () => {
        vi.mocked(auth.confirmEmail).mockRejectedValueOnce(new Error('This link has expired or is not complete.'));
        openAt('#user=0f8a-id&token=old');

        expect(await screen.findByText('This link has expired or is not complete.')).toBeInTheDocument();
        expect(screen.getByText('That link did not work')).toBeInTheDocument();
        await waitFor(() => expect(window.location.hash).toBe(''));
    });

    it('confirms a second link opened in the same tab, which changes only the fragment', async () => {
        // A browser follows a link that differs only after the `#` without loading the page again.
        vi.mocked(auth.confirmEmail).mockRejectedValueOnce(new Error('This link has expired or is not complete.'));
        openAt('#user=0f8a-id&token=old');
        await screen.findByText('That link did not work');

        act(() => {
            window.location.hash = '#user=0f8a-id&token=new';
        });

        expect(await screen.findByText(/your email address is confirmed/i)).toBeInTheDocument();
        expect(auth.confirmEmail).toHaveBeenLastCalledWith('0f8a-id', 'new');
        expect(screen.queryByText('That link did not work')).toBeNull();
    });

    it('says a link with a half missing is not complete, and asks the API nothing', async () => {
        openAt('#user=0f8a-id');

        expect(await screen.findByText('This link is not complete')).toBeInTheDocument();
        expect(auth.confirmEmail).not.toHaveBeenCalled();
    });

    it('is never cached and never indexed', () => {
        expect(headers()).toEqual({ 'Cache-Control': 'private, no-store' });
        expect(meta()).toContainEqual({ name: 'robots', content: 'noindex' });
    });
});
