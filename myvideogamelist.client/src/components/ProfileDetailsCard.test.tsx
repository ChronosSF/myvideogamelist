import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const saveButton = () => screen.getByRole('button', { name: /save details|saved|saving/i });

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
        expect(screen.getByLabelText('Avatar address')).toHaveValue('https://i.imgur.com/removed.png');
        expect(screen.getByLabelText('Bio')).toHaveValue('Mostly RPGs.');
    });

    it('previews the handle beside the display name, never in place of it', () => {
        renderCard({ displayName: 'Alex Smith' });

        expect(screen.getByText('Alex Smith')).toBeInTheDocument();
        expect(screen.getByText('@alex')).toBeInTheDocument();
    });

    it('previews the picture that is stored, not the one being typed', async () => {
        // A preview that followed the input would ask somebody's server for every half-typed address.
        const actor = userEvent.setup();
        const { container } = renderCard({ avatarUrl: 'https://i.imgur.com/stored.png' });

        await actor.clear(screen.getByLabelText('Avatar address'));
        await actor.type(screen.getByLabelText('Avatar address'), 'https://i.imgur.com/typed.png');

        expect(container.querySelector('img')).toHaveAttribute('src', 'https://i.imgur.com/stored.png');
    });

    it('has nothing to save until something changes, and keeps the focus while it has not', () => {
        renderCard({ displayName: 'Alex Smith' });

        // Unavailable rather than disabled: a disabled button under the keyboard's focus drops it.
        expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
        expect(saveButton()).not.toBeDisabled();
    });

    it('treats an edit that changes nothing stored as nothing to save', async () => {
        const actor = userEvent.setup();
        renderCard({ displayName: 'Alex Smith' });

        await actor.type(screen.getByLabelText('Display name'), '   ');

        expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    });

    it('saves all three as the server will store them', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Display name'), '  Alex   Smith ');
        await actor.type(screen.getByLabelText('Avatar address'), 'https://i.imgur.com/removed.png');
        await actor.type(screen.getByLabelText('Bio'), '  Mostly RPGs.{Enter}{Enter}{Enter}{Enter}Slowly.  ');
        await actor.click(saveButton());

        await waitFor(() => expect(saveDetails).toHaveBeenCalledWith({
            displayName: 'Alex Smith',
            avatarUrl: 'https://i.imgur.com/removed.png',
            // The line breaks inside are the owner's, a run of blank lines one blank line, the ends
            // trimmed.
            bio: 'Mostly RPGs.\n\nSlowly.',
        }));
    });

    it('clears a field left empty', async () => {
        const actor = userEvent.setup();
        renderCard({ displayName: 'Alex Smith', avatarUrl: 'https://i.imgur.com/removed.png', bio: 'Hi.' });

        await actor.clear(screen.getByLabelText('Avatar address'));
        await actor.click(saveButton());

        await waitFor(() => expect(saveDetails).toHaveBeenCalledWith({
            displayName: 'Alex Smith',
            avatarUrl: null,
            bio: 'Hi.',
        }));
    });

    it('says when a save has gone through, where a screen reader hears it', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Display name'), 'Alex');
        await actor.click(saveButton());

        expect(await screen.findByRole('status')).toHaveTextContent('Your profile details are saved.');
    });

    it('puts each refusal beside its field, and the focus on the first one refused', async () => {
        saveDetails.mockRejectedValue(new ProfileDetailsError('ignored', {
            avatarUrl: 'An avatar has to be a picture\'s own address on Gravatar, GitHub, Steam or Imgur.',
            bio: 'A bio can be at most 500 characters.',
        }));
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Avatar address'), 'https://example.com/me.png');
        await actor.type(screen.getByLabelText('Bio'), 'Hi.');
        await actor.click(saveButton());

        const avatar = screen.getByLabelText('Avatar address');
        await waitFor(() => expect(avatar).toHaveFocus());
        expect(avatar).toHaveAttribute('aria-invalid', 'true');
        expect(avatar).toHaveAccessibleDescription(/own address on Gravatar, GitHub, Steam or Imgur/);
        expect(screen.getByLabelText('Bio')).toHaveAccessibleDescription(/at most 500 characters/);
        expect(screen.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'false');
        // Read out through the focus and the description, not as alerts on top of it.
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        // What was typed is still there to be corrected.
        expect(avatar).toHaveValue('https://example.com/me.png');
    });

    it('takes a field\'s refusal away once the field is changed', async () => {
        saveDetails.mockRejectedValue(new ProfileDetailsError('ignored', {
            avatarUrl: 'An avatar has to be the address of a picture, starting https://.',
        }));
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Avatar address'), 'ftp://x');
        await actor.click(saveButton());
        await waitFor(() => expect(screen.getByLabelText('Avatar address')).toHaveAttribute('aria-invalid', 'true'));

        // Emptied again, it matches what is stored and there is nothing to save — so nothing must be
        // left saying it is wrong.
        await actor.clear(screen.getByLabelText('Avatar address'));

        expect(screen.getByLabelText('Avatar address')).toHaveAttribute('aria-invalid', 'false');
        expect(screen.queryByText(/starting https/)).not.toBeInTheDocument();
    });

    it('says so when the refusal is about no one field', async () => {
        saveDetails.mockRejectedValue(new ProfileDetailsError('Your account was changed somewhere else at the same moment. Please save again.'));
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Display name'), 'Alex');
        await actor.click(saveButton());

        expect(await screen.findByRole('alert')).toHaveTextContent('changed somewhere else');
    });

    it('says so when the API never answered', async () => {
        // A rejected fetch, which `!response.ok` never sees.
        saveDetails.mockRejectedValue(new TypeError('Failed to fetch'));
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Display name'), 'Alex');
        await actor.click(saveButton());

        expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    });

    it('follows what is stored once a save comes back', async () => {
        const actor = userEvent.setup();
        const { user, rerender } = renderCard();

        await actor.type(screen.getByLabelText('Display name'), '  Alex  ');
        await actor.click(saveButton());
        await waitFor(() => expect(saveDetails).toHaveBeenCalled());

        // The provider hands back the stored account; the form shows what the public page will.
        rerender(<ProfileDetailsCard user={{ ...user, displayName: 'Alex' }} />);

        expect(screen.getByLabelText('Display name')).toHaveValue('Alex');
        expect(await screen.findByRole('button', { name: '✓ Saved' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('keeps a half-written bio when the account changes in some other way', async () => {
        // Making the profile public on the same page hands back a new account object; only a change
        // to what is stored may replace what is being typed.
        const actor = userEvent.setup();
        const { user, rerender } = renderCard({ profileVisibility: 'private' });

        await actor.type(screen.getByLabelText('Bio'), 'Half a thought');
        rerender(<ProfileDetailsCard user={{ ...user, profileVisibility: 'public' }} />);

        expect(screen.getByLabelText('Bio')).toHaveValue('Half a thought');
    });

    it('says when the saved picture did not load', () => {
        const { container } = renderCard({ avatarUrl: 'https://i.imgur.com/gone.png' });

        fireEvent.error(container.querySelector('img')!);

        expect(screen.getByLabelText('Avatar address'))
            .toHaveAccessibleDescription(/Your saved picture did not load/);
    });

    it('reads a field an older API did not send as nothing stored', () => {
        // Mid-deploy, the account can come from an API a release behind, without the three fields.
        const { displayName: _name, avatarUrl: _avatar, bio: _bio, ...older } = userProfile();
        render(<ProfileDetailsCard user={older as UserProfile} />);

        expect(screen.getByLabelText('Display name')).toHaveValue('');
        expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    });

    it('says the details stay unpublished while the profile is private', () => {
        renderCard({ profileVisibility: 'private' });

        expect(screen.getByText(/once you make it public/)).toBeInTheDocument();
    });

    it('says a change takes a while to reach every reader once the profile is public', () => {
        renderCard({ profileVisibility: 'public' });

        expect(screen.getByText(/up to about an hour to reach everybody/)).toBeInTheDocument();
    });

    it('counts the bio against its limit', async () => {
        const actor = userEvent.setup();
        renderCard();

        await actor.type(screen.getByLabelText('Bio'), 'Hello');

        expect(screen.getByLabelText('Bio')).toHaveAccessibleDescription(/5 of 500 characters/);
        expect(screen.getByLabelText('Bio')).toHaveAttribute('maxlength', '500');
    });
});
