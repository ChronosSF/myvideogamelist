import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginDialog } from '@/components/LoginDialog';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { mousePress } from '@/test/press';

/**
 * Auth, mocked rather than provided: the real provider fetches, and this dialog only calls `login`.
 *
 * One module-level object handed back on every call, never a fresh literal — a new object per render
 * re-runs any effect depending on it, which ends in a heap crash rather than a failed assertion.
 */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const onClose = vi.fn();
const onSwitchToRegister = vi.fn();

function renderDialog() {
    render(<LoginDialog onClose={onClose} onSwitchToRegister={onSwitchToRegister} />);
}

/** The overlay, which is what carries the dialog role here. */
const overlay = () => screen.getByRole('dialog', { name: 'Sign In' });
const emailField = () => screen.getByLabelText('Email or username');

beforeEach(() => {
    onClose.mockReset();
    onSwitchToRegister.mockReset();
    vi.mocked(auth.login).mockResolvedValue(undefined);
});

describe('LoginDialog', () => {
    it('signs in with what was typed and closes', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await actor.type(emailField(), 'alex@test.local');
        await actor.type(screen.getByLabelText('Password'), 'Passw0rd1');
        await actor.click(screen.getByRole('button', { name: 'Sign In' }));

        expect(auth.login).toHaveBeenCalledWith('alex@test.local', 'Passw0rd1', false);
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("shows the API's own sentence when the sign-in is refused", async () => {
        // A rate-limited login read as "Login failed" is what made showing the server's message a rule.
        const actor = userEvent.setup();
        vi.mocked(auth.login).mockRejectedValueOnce(new Error('Too many attempts. Try again later.'));
        renderDialog();

        await actor.type(emailField(), 'alex@test.local');
        await actor.type(screen.getByLabelText('Password'), 'Passw0rd1');
        await actor.click(screen.getByRole('button', { name: 'Sign In' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again later.');
        expect(onClose).not.toHaveBeenCalled();
    });
});

/**
 * Dismissal takes a press that is outside at both ends. Everything here goes through `mousePress`,
 * which fires the `click` where the DOM fires it — at the nearest common ancestor — because reading
 * that one event is what made a selection dragged out of a field close the dialog.
 */
describe('LoginDialog dismissal', () => {
    it('stays open when a selection started in a field ends on the overlay', () => {
        renderDialog();

        mousePress(emailField(), overlay());

        expect(onClose).not.toHaveBeenCalled();
    });

    it('stays open when a press on the overlay is released inside the panel', () => {
        renderDialog();

        mousePress(overlay(), emailField());

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
