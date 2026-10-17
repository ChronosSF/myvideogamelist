import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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

/** The order the fields are drawn in, which is the order a refusal moves the focus through. */
const FIELDS: readonly Field[] = ['displayName', 'avatarUrl', 'bio'];

/** What is stored, with a field an older API did not send read as the null it means. */
function detailsOf(user: UserProfile): ProfileDetails {
    return {
        displayName: user.displayName ?? null,
        avatarUrl: user.avatarUrl ?? null,
        bio: user.bio ?? null,
    };
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
 * with its whitespace folded, the address trimmed, the bio's line endings one `\n`, its blank lines
 * one at most and its ends trimmed, and a blank as nothing. The server is the authority; this only
 * decides whether there is anything to save.
 */
function normalised(drafts: Drafts): ProfileDetails {
    const displayName = drafts.displayName.trim().replace(/\s+/g, ' ');
    const avatarUrl = drafts.avatarUrl.trim();
    const bio = drafts.bio
        .replace(/\r\n?/g, '\n')
        .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')
        .trim();

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
 *
 * Nothing here is disabled while a save is out, only read-only, and the button says it cannot be
 * pressed rather than being switched off: a control that is disabled under the keyboard's focus
 * drops it, and the person saving would be sent back to the top of the page.
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

    // The saved picture's address when the preview could not load it, so the card can say so.
    const [unavailableAvatar, setUnavailableAvatar] = useState<string | null>(null);
    const avatarUnavailable = stored.avatarUrl !== null && unavailableAvatar === stored.avatarUrl;

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

    const displayNameInput = useRef<HTMLInputElement>(null);
    const avatarInput = useRef<HTMLInputElement>(null);
    const bioInput = useRef<HTMLTextAreaElement>(null);
    const inputFor = (field: Field) => ({
        displayName: displayNameInput,
        avatarUrl: avatarInput,
        bio: bioInput,
    })[field].current;

    const handleChange = (field: Field, value: string) => {
        setSaved(false);
        setError(null);
        // A field's refusal is about what was in it, so it goes once the field is changed.
        setFieldErrors(({ [field]: _changed, ...rest }) => rest);
        setDrafts(current => ({ ...current, [field]: value }));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (saving || unchanged) return;

        setSaving(true);
        setSaved(false);
        setError(null);
        setFieldErrors({});

        try {
            await updateProfileDetails(normalised(drafts));
            setSaved(true);
        } catch (err) {
            if (err instanceof ProfileDetailsError && Object.keys(err.fieldErrors).length > 0) {
                // The focus goes to the first field refused, whose description then carries the
                // reason — read out once, rather than one alert per refused field. The refusals are
                // put on the page first, so the description is there when the focus arrives.
                flushSync(() => setFieldErrors(err.fieldErrors));
                const first = FIELDS.find(field => err.fieldErrors[field] !== undefined);
                if (first !== undefined) inputFor(first)?.focus();
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

    /** The ids an input is described by: its standing hints, then its refusal when it has one. */
    const describedBy = (field: Field, ...hints: (string | false)[]) =>
        [...hints, fieldErrors[field] !== undefined && `${ids[field]}-error`]
            .filter(Boolean)
            .join(' ') || undefined;

    const refusal = (field: Field) => fieldErrors[field] !== undefined && (
        <p id={`${ids[field]}-error`} className="user-pref-error">{fieldErrors[field]}</p>
    );

    return (
        <div className="user-card">
            <div className="user-card-label">Profile details</div>

            {/* What the public page shows at its top, as stored. The handle is always there: the
                display name sits beside it and never stands in for it. */}
            <div className="profile-details-preview">
                <Avatar
                    userName={user.userName}
                    avatarUrl={stored.avatarUrl}
                    className="profile-details-avatar"
                    onUnavailable={setUnavailableAvatar}
                />
                <div className="profile-details-names">
                    {stored.displayName !== null && (
                        <bdi className="profile-details-display-name">{stored.displayName}</bdi>
                    )}
                    <span className="profile-details-handle">@{user.userName}</span>
                </div>
            </div>

            {/* The edge keeps a public profile for up to about an hour (ADR 0027 §10), so the second
                sentence is what stops "✓ Saved" reading as "everybody sees it now". */}
            <p className="user-card-hint">
                {isPublic
                    ? 'The top of your public profile, as last saved. A change can take up to about an '
                        + 'hour to reach everybody who reads it.'
                    : 'The top of your public profile, as last saved, once you make it public. Until '
                        + 'then, nobody else sees it.'}
            </p>

            <form className="profile-details-form" onSubmit={event => void handleSubmit(event)} noValidate>
                <div className="profile-details-field">
                    <label htmlFor={ids.displayName}>Display name</label>
                    <input
                        id={ids.displayName}
                        ref={displayNameInput}
                        type="text"
                        value={drafts.displayName}
                        placeholder={user.userName}
                        maxLength={DISPLAY_NAME_MAX_LENGTH}
                        autoComplete="nickname"
                        onChange={event => handleChange('displayName', event.target.value)}
                        readOnly={saving}
                        aria-invalid={fieldErrors.displayName !== undefined}
                        aria-describedby={describedBy('displayName')}
                    />
                    {refusal('displayName')}
                </div>

                <div className="profile-details-field">
                    <label htmlFor={ids.avatarUrl}>Avatar address</label>
                    <input
                        id={ids.avatarUrl}
                        ref={avatarInput}
                        type="url"
                        inputMode="url"
                        value={drafts.avatarUrl}
                        placeholder="https://"
                        maxLength={AVATAR_URL_MAX_LENGTH}
                        autoComplete="photo"
                        spellCheck={false}
                        onChange={event => handleChange('avatarUrl', event.target.value)}
                        readOnly={saving}
                        aria-invalid={fieldErrors.avatarUrl !== undefined}
                        aria-describedby={describedBy(
                            'avatarUrl',
                            `${ids.avatarUrl}-hint`,
                            avatarUnavailable && `${ids.avatarUrl}-unavailable`,
                        )}
                    />
                    <p id={`${ids.avatarUrl}-hint`} className="user-card-hint">
                        {`A picture's own address on ${AVATAR_SERVICES}: right-click the picture there `
                            + 'and copy the image address. Each reader\'s browser loads it from there. '
                            + 'Leave it empty for your initial. A Gravatar address is made from your '
                            + 'email address, and can be matched to it.'}
                    </p>
                    {avatarUnavailable && (
                        <p id={`${ids.avatarUrl}-unavailable`} className="user-pref-error">
                            Your saved picture did not load, so your initial is shown in its place.
                            Check that the address is the picture&apos;s own, not the page it is on.
                        </p>
                    )}
                    {refusal('avatarUrl')}
                </div>

                <div className="profile-details-field">
                    <label htmlFor={ids.bio}>Bio</label>
                    <textarea
                        id={ids.bio}
                        ref={bioInput}
                        rows={4}
                        value={drafts.bio}
                        maxLength={BIO_MAX_LENGTH}
                        onChange={event => handleChange('bio', event.target.value)}
                        readOnly={saving}
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
                    aria-disabled={saving || unchanged}
                >
                    {saving ? 'Saving…' : saved && unchanged ? '✓ Saved' : 'Save details'}
                </button>

                {/* Always in the page, so that what is put in it is read out: a button's label
                    changing is not announced. */}
                <p className="sr-only" role="status">{saved ? 'Your profile details are saved.' : ''}</p>
            </form>
        </div>
    );
}
