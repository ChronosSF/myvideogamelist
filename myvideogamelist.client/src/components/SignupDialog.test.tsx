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
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
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
    vi.mocked(auth.register).mockResolvedValue(undefined);
});

describe('SignupDialog', () => {
    it('registers with what was typed and closes', async () => {
        const actor = userEvent.setup();
        renderDialog();

        await fillIn(actor);
        await actor.click(screen.getByRole('button', { name: 'Create Account' }));

        expect(auth.register).toHaveBeenCalledWith('alex@test.local', 'Passw0rd1', 'alex');
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
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
