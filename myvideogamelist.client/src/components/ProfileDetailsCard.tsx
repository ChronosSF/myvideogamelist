import { useId, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/Avatar';
import { AVATAR_SERVICES } from '@/lib/avatar';
import {
    AVATAR_URL_MAX_LENGTH,
    BIO_MAX_LENGTH,
    DISPLAY_NAME_MAX_LENGTH,
    ProfileDetailsError,
    type ProfileDetails,
    type UserProfile,
} from '@/types/auth';

type Field = keyof ProfileDetails;
type Drafts = Record<Field, string>;

function detailsOf(user: UserProfile): ProfileDetails {
    return { displayName: user.displayName, avatarUrl: user.avatarUrl, bio: user.bio };
}

function draftsFrom(details: ProfileDetails): Drafts {
    return {
        displayName: details.displayName ?? '',
        avatarUrl: details.avatarUrl ?? '',
        bio: details.bio ?? '',
    };
}

/**
 * The drafts as the server will store them, after its three policies' `Normalise`: the name trimmed
 * with its whitespace folded, the address trimmed, the bio's line endings one `\n` and its ends
 * trimmed, and a blank as nothing. The server is the authority; this only decides whether there is
 * anything to save.
 */
function normalised(drafts: Drafts): ProfileDetails {
    const displayName = drafts.displayName.trim().replace(/\s+/g, ' ');
    const avatarUrl = drafts.avatarUrl.trim();
    const bio = drafts.bio.replace(/\r\n?/g, '\n').trim();

    return {
        displayName: displayName === '' ? null : displayName,
        avatarUrl: avatarUrl === '' ? null : avatarUrl,
        bio: bio === '' ? null : bio,
    };
}

function sameDetails(a: ProfileDetails, b: ProfileDetails): boolean {
    return a.displayName === b.displayName && a.avatarUrl === b.avatarUrl && a.bio === b.bio;
}

/**
 * What the account says about itself on its public profile: a display name, a picture and a few
 * lines, on the owner's settings page (ADR 0056).
 *
 * One form and one Save, because the three are one thing to the person filling them in — how they
 * introduce themselves — and a refusal comes back beside the field it is about while the others keep
 * what was typed. The preview at the top is what is stored, not what is typed: a picture is a
 * request to somebody else's server, and one per keystroke would be a request for every half-typed
 * address on the way to the real one.
 */
export function ProfileDetailsCard({ user }: { user: UserProfile }) {
    const { updateProfileDetails } = useAuth();
    const fieldId = useId();

    const stored = detailsOf(user);

    const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(stored));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
    const [error, setError] = useState<string | null>(null);

    // Follow what is stored when it changes — saved here, or arriving with a refreshed account —
    // compared by value rather than by reference. Making the profile public on this same page hands
    // back a new account object, and a reference check would wipe a half-written bio.
    const [lastStored, setLastStored] = useState(stored);
    if (!sameDetails(lastStored, stored)) {
        setLastStored(stored);
        setDrafts(draftsFrom(stored));
    }

    const unchanged = sameDetails(normalised(drafts), stored);
    const isPublic = user.profileVisibility === 'public';

    const handleChange = (field: Field, value: string) => {
        setSaved(false);
        setDrafts(current => ({ ...current, [field]: value }));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setSaved(false);
        setError(null);
        setFieldErrors({});

        try {
            await updateProfileDetails(normalised(drafts));
            setSaved(true);
        } catch (err) {
            if (err instanceof ProfileDetailsError && Object.keys(err.fieldErrors).length > 0) {
                setFieldErrors(err.fieldErrors);
            } else if (err instanceof ProfileDetailsError) {
                setError(err.message);
            } else {
                // A rejected fetch: the API never answered, so there is no sentence of its to show.
                setError('Your profile details could not be saved. Please try again.');
            }
        } finally {
            setSaving(false);
        }
    };

    const ids = {
        displayName: `${fieldId}-display-name`,
        avatarUrl: `${fieldId}-avatar`,
        bio: `${fieldId}-bio`,
    } satisfies Record<Field, string>;

    /** The ids an input is described by: its standing hint, then its refusal when it has one. */
    const describedBy = (field: Field, hint?: string) =>
        [hint, fieldErrors[field] !== undefined ? `${ids[field]}-error` : undefined]
            .filter(Boolean)
            .join(' ') || undefined;

    const refusal = (field: Field) => fieldErrors[field] !== undefined && (
        <p id={`${ids[field]}-error`} className="user-pref-error" role="alert">{fieldErrors[field]}</p>
    );

    return (
        <div className="user-card">
            <div className="user-card-label">Profile details</div>

            {/* What the public page shows at its top, as stored. The handle is always there: the
                display name sits beside it and never stands in for it. */}
            <div className="profile-details-preview">
                <Avatar
                    userName={user.userName}
                    avatarUrl={user.avatarUrl}
                    className="profile-details-avatar"
                />
                <div className="profile-details-names">
                    {user.displayName !== null && (
                        <bdi className="profile-details-display-name">{user.displayName}</bdi>
                    )}
                    <span className="profile-details-handle">@{user.userName}</span>
                </div>
            </div>

            <p className="user-card-hint">
                {isPublic
                    ? 'Shown at the top of your public profile, beside your username.'
                    : 'Shown at the top of your public profile once you make it public. Until then, '
                        + 'nobody else sees them.'}
            </p>

            <form className="profile-details-form" onSubmit={event => void handleSubmit(event)} noValidate>
                <div className="profile-details-field">
                    <label htmlFor={ids.displayName}>Display name</label>
                    <input
                        id={ids.displayName}
                        type="text"
                        value={drafts.displayName}
                        placeholder={user.userName}
                        maxLength={DISPLAY_NAME_MAX_LENGTH}
                        autoComplete="nickname"
                        onChange={event => handleChange('displayName', event.target.value)}
                        disabled={saving}
                        aria-invalid={fieldErrors.displayName !== undefined}
                        aria-describedby={describedBy('displayName')}
                    />
                    {refusal('displayName')}
                </div>

                <div className="profile-details-field">
                    <label htmlFor={ids.avatarUrl}>Avatar</label>
                    <input
                        id={ids.avatarUrl}
                        type="url"
                        inputMode="url"
                        value={drafts.avatarUrl}
                        placeholder="https://"
                        maxLength={AVATAR_URL_MAX_LENGTH}
                        autoComplete="photo"
                        spellCheck={false}
                        onChange={event => handleChange('avatarUrl', event.target.value)}
                        disabled={saving}
                        aria-invalid={fieldErrors.avatarUrl !== undefined}
                        aria-describedby={describedBy('avatarUrl', `${ids.avatarUrl}-hint`)}
                    />
                    <p id={`${ids.avatarUrl}-hint`} className="user-card-hint">
                        {`The address of a picture on ${AVATAR_SERVICES}. Each reader's browser `
                            + 'loads it from there. Leave it empty for your initial.'}
                    </p>
                    {refusal('avatarUrl')}
                </div>

                <div className="profile-details-field">
                    <label htmlFor={ids.bio}>Bio</label>
                    <textarea
                        id={ids.bio}
                        rows={4}
                        value={drafts.bio}
                        maxLength={BIO_MAX_LENGTH}
                        onChange={event => handleChange('bio', event.target.value)}
                        disabled={saving}
                        aria-invalid={fieldErrors.bio !== undefined}
                        aria-describedby={describedBy('bio', `${ids.bio}-count`)}
                    />
                    <p id={`${ids.bio}-count`} className="user-card-hint">
                        {`Plain text, line breaks kept. ${drafts.bio.length} of ${BIO_MAX_LENGTH} characters.`}
                    </p>
                    {refusal('bio')}
                </div>

                {/* Only the failure that is about no one field; the others sit beside theirs. */}
                {error !== null && (
                    <p className="user-pref-error" role="alert">{error}</p>
                )}

                <button
                    type="submit"
                    className="user-btn user-btn-block"
                    disabled={saving || unchanged}
                >
                    {saving ? 'Saving…' : saved && unchanged ? '✓ Saved' : 'Save details'}
                </button>
            </form>
        </div>
    );
}
