import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileDetailsCard } from '@/components/ProfileDetailsCard';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { ProfileDetailsError, type ProfileDetails, type UserProfile } from '@/types/auth';
import { userProfile } from '@/test/factories';

/**
 * One module-level object handed back on every call, never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure.
 */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async (_details: ProfileDetails) => {}),
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const saveDetails = vi.mocked(auth.updateProfileDetails);

function renderCard(overrides: Partial<UserProfile> = {}) {
    const user = userProfile(overrides);
    return { user, ...render(<ProfileDetailsCard user={user} />) };
}

beforeEach(() => {
    saveDetails.mockReset();
    saveDetails.mockResolvedValue(undefined);
});

describe('ProfileDetailsCard', () => {
    it('opens on what is stored', () => {
        renderCard({
            displayName: 'Alex Smith',
            avatarUrl: 'https://i.imgur.com/removed.png',
            bio: 'Mostly RPGs.',
        });

        expect(screen.getByLabelText('Display name')).toHaveValue('Alex Smith');
        expect(screen.getByLabelText('Avatar')).toHaveValue('https://i.imgur.com/removed.png');
        expect(screen.getByLabelText('Bio')).toHaveValue('Mostly RPGs.');
    });

    it('previews the handle beside the display name, never in place of it', () => {
        renderCard({ displayName: 'Alex Smith' });

        expect(screen.getByText('Alex Smith')).toBeInTheDocument();
        expect(screen.getByText('@alex')).toBeInTheDocument();
    });

    it('has nothing to save until something changes', () => {
        renderCard({ displayName: 'Alex Smith' });

        expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
    });

    it('saves all three as the server will store them', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Display name'), '  Alex   Smith ');
        await actor.type(screen.getByLabelText('Avatar'), ' https://i.imgur.com/removed.png ');
        await actor.type(screen.getByLabelText('Bio'), '  Mostly RPGs.{Enter}{Enter}Slowly.  ');
        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        await waitFor(() => expect(saveDetails).toHaveBeenCalledWith({
            displayName: 'Alex Smith',
            avatarUrl: 'https://i.imgur.com/removed.png',
            // The line breaks inside are the owner's; only the ends are trimmed.
            bio: 'Mostly RPGs.\n\nSlowly.',
        }));
    });

    it('clears a field left empty', async () => {
        const actor = userEvent.setup();
        renderCard({ displayName: 'Alex Smith', avatarUrl: 'https://i.imgur.com/removed.png', bio: 'Hi.' });

        await actor.clear(screen.getByLabelText('Avatar'));
        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        await waitFor(() => expect(saveDetails).toHaveBeenCalledWith({
            displayName: 'Alex Smith',
            avatarUrl: null,
            bio: 'Hi.',
        }));
    });

    it('puts each refusal beside the field it is about', async () => {
        saveDetails.mockRejectedValue(new ProfileDetailsError('An avatar can come from Gravatar.', {
            avatarUrl: 'An avatar can come from Gravatar, GitHub, Steam, Imgur or Twitch.',
        }));
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Avatar'), 'https://example.com/me.png');
        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        const avatar = screen.getByLabelText('Avatar');
        await waitFor(() => expect(avatar).toHaveAttribute('aria-invalid', 'true'));
        expect(avatar).toHaveAccessibleDescription(/An avatar can come from Gravatar, GitHub/);
        expect(screen.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'false');
        // What was typed is still there to be corrected.
        expect(avatar).toHaveValue('https://example.com/me.png');
    });

    it('says so when the refusal is about no one field', async () => {
        saveDetails.mockRejectedValue(new ProfileDetailsError('The account was changed elsewhere.'));
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Display name'), 'Alex');
        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('The account was changed elsewhere.');
    });

    it('says so when the API never answered', async () => {
        // A rejected fetch, which `!response.ok` never sees.
        saveDetails.mockRejectedValue(new TypeError('Failed to fetch'));
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Display name'), 'Alex');
        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    });

    it('follows what is stored once a save comes back', async () => {
        const actor = userEvent.setup();
        const { user, rerender } = renderCard();

        await actor.type(screen.getByLabelText('Display name'), '  Alex  ');
        await actor.click(screen.getByRole('button', { name: 'Save details' }));
        await waitFor(() => expect(saveDetails).toHaveBeenCalled());

        // The provider hands back the stored account; the form shows what the public page will.
        rerender(<ProfileDetailsCard user={{ ...user, displayName: 'Alex' }} />);

        expect(screen.getByLabelText('Display name')).toHaveValue('Alex');
        expect(await screen.findByRole('button', { name: '✓ Saved' })).toBeDisabled();
    });

    it('says the details stay unpublished while the profile is private', () => {
        renderCard({ profileVisibility: 'private' });

        expect(screen.getByText(/once you make it public/)).toBeInTheDocument();
    });

    it('says where the details are shown once the profile is public', () => {
        renderCard({ profileVisibility: 'public' });

        expect(screen.getByText(/Shown at the top of your public profile, beside your username/))
            .toBeInTheDocument();
    });

    it('counts the bio against its limit', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Bio'), 'Hello');

        expect(screen.getByLabelText('Bio')).toHaveAccessibleDescription(/5 of 500 characters/);
        expect(screen.getByLabelText('Bio')).toHaveAttribute('maxlength', '500');
    });
});
