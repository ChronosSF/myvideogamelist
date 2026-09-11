import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AccountIdentityCard } from '@/components/AccountIdentityCard';
import type { UserProfile } from '@/types/auth';

/**
 * One module-level object handed back on every call, never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure.
 */
const authValue = {
    user: null as UserProfile | null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue }));

function user(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        id: 'user-1',
        email: 'alex@test.local',
        userName: 'alex',
        theme: 'dark',
        profileVisibility: 'private',
        ...overrides,
    };
}

function renderCard(overrides: Partial<UserProfile> = {}) {
    return render(
        <MemoryRouter>
            <AccountIdentityCard user={user(overrides)} />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    authValue.updateUserName.mockReset();
    authValue.updateUserName.mockResolvedValue(undefined);
    authValue.updateProfileVisibility.mockReset();
    authValue.updateProfileVisibility.mockResolvedValue(undefined);
});

describe('AccountIdentityCard username', () => {
    it('shows the current username with its @', () => {
        renderCard();

        expect(screen.getByText('@alex')).toBeInTheDocument();
    });

    it('saves a new one', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Change' }));
        await actor.clear(screen.getByLabelText('Username'));
        await actor.type(screen.getByLabelText('Username'), 'alexandra');
        await actor.click(screen.getByRole('button', { name: /save username/i }));

        await waitFor(() => expect(authValue.updateUserName).toHaveBeenCalledWith('alexandra'));
    });

    it('refuses an obviously bad name without a round trip', async () => {
        // The server enforces the same rules plus a reserved list and availability. This is only
        // about not spending a request to be told what the form already knows.
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Change' }));
        await actor.clear(screen.getByLabelText('Username'));
        await actor.type(screen.getByLabelText('Username'), 'a b');
        await actor.click(screen.getByRole('button', { name: /save username/i }));

        expect(screen.getByText(/letters, numbers and underscores only/i)).toBeInTheDocument();
        expect(authValue.updateUserName).not.toHaveBeenCalled();
    });

    it("shows the server's own refusal, which says which of several things went wrong", async () => {
        // "Taken", "reserved" and "too soon after your last change" are three different sentences
        // and only the server knows which applies; a generic failure message would lose all three.
        const actor = userEvent.setup();
        authValue.updateUserName.mockRejectedValue(new Error('That username is taken.'));
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Change' }));
        await actor.clear(screen.getByLabelText('Username'));
        await actor.type(screen.getByLabelText('Username'), 'sam');
        await actor.click(screen.getByRole('button', { name: /save username/i }));

        // Found by role: the refusal arrives after the form has been submitted and focus is still
        // on the button, so a screen reader is told about it only if it is a live region.
        expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken.');
    });

    it('warns that renaming breaks links before it happens', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Change' }));

        expect(screen.getByText(/breaks existing links/i)).toBeInTheDocument();
    });

    it('puts the original name back when the edit is cancelled', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('button', { name: 'Change' }));
        await actor.clear(screen.getByLabelText('Username'));
        await actor.type(screen.getByLabelText('Username'), 'somethingelse');
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.getByText('@alex')).toBeInTheDocument();
        expect(authValue.updateUserName).not.toHaveBeenCalled();
    });
});

describe('AccountIdentityCard profile visibility', () => {
    it('starts private and says nobody else can see anything', () => {
        renderCard();

        expect(screen.getByRole('checkbox', { name: /public/i })).not.toBeChecked();
        expect(screen.getByText(/nobody else can see your lists/i)).toBeInTheDocument();
    });

    it('says what publishing will and will not show', () => {
        // Publishing republishes prose the user wrote, so the toggle names what it covers rather
        // than leaving them to find out from the resulting page.
        renderCard();

        expect(screen.getByText(/reviews you marked public/i)).toBeInTheDocument();
        expect(screen.getByText(/never your email address/i)).toBeInTheDocument();
    });

    it('publishes on request', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.click(screen.getByRole('checkbox', { name: /public/i }));

        await waitFor(() =>
            expect(authValue.updateProfileVisibility).toHaveBeenCalledWith('public'));
    });

    it('unpublishes on request', async () => {
        const actor = userEvent.setup();
        renderCard({ profileVisibility: 'public' });

        await actor.click(screen.getByRole('checkbox', { name: /public/i }));

        await waitFor(() =>
            expect(authValue.updateProfileVisibility).toHaveBeenCalledWith('private'));
    });

    it('offers the address only once there is one', () => {
        renderCard();
        expect(screen.queryByRole('link', { name: '/u/alex' })).not.toBeInTheDocument();

        renderCard({ profileVisibility: 'public' });
        expect(screen.getByRole('link', { name: '/u/alex' })).toHaveAttribute('href', '/u/alex');
    });

    it('reports a failed change rather than leaving the toggle looking saved', async () => {
        const actor = userEvent.setup();
        authValue.updateProfileVisibility.mockRejectedValue(new Error('Network is down.'));
        renderCard();

        await actor.click(screen.getByRole('checkbox', { name: /public/i }));

        // The toggle is the only thing that moved, and it moves back — nothing else on screen
        // changes to say it failed, so the failure has to announce itself.
        expect(await screen.findByRole('alert')).toHaveTextContent('Network is down.');
    });

    it('leaves the standing hint out of the live region', async () => {
        // The hint is the permanent explanation of what publishing covers, not news. Printing the
        // failure into it would have a screen reader read that paragraph out on every re-render.
        const actor = userEvent.setup();
        authValue.updateProfileVisibility.mockRejectedValue(new Error('Network is down.'));
        renderCard();

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await actor.click(screen.getByRole('checkbox', { name: /public/i }));

        const alerts = await screen.findAllByRole('alert');
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toHaveTextContent('Network is down.');
        expect(screen.getByText(/nobody else can see your lists/i)).toBeInTheDocument();
    });
});
