/** Whether an account has a public page at `/u/{userName}`. */
export type ProfileVisibility = 'public' | 'private';

/**
 * The signed-in user, mirroring `UserProfileDto` on the server.
 *
 * `userName` is the public handle — the whole of `/u/{userName}` — and is what the navbar renders.
 * The email is still here because the account settings page shows it, and nothing public does.
 */
export interface UserProfile extends ProfileDetails {
    id: string;
    email: string;
    userName: string;
    /**
     * Carried on every page load so the navbar can tell whether there is a public profile to link
     * to, without a second request for a one-word answer.
     */
    profileVisibility: ProfileVisibility;
    /**
     * Whether the navbar links to the admin page. Presentation only: every admin endpoint asks the
     * server's policy for itself, so a client that believed this wrongly would be refused, not let in.
     */
    isAdmin: boolean;
}

/**
 * What an account says about itself on its public profile, mirroring the three fields of
 * `UpdateProfileDetailsDto` on the server. Null is "none": the handle alone, its initial for a
 * picture, no bio. See `docs/decisions/0056-*`.
 */
export interface ProfileDetails {
    /** Shown beside the handle, never instead of it. Never unique, never in a URL. */
    displayName: string | null;
    /** An `https:` address on one of `AVATAR_HOSTS`, which each reader's browser loads from there. */
    avatarUrl: string | null;
    /** Plain text, its line breaks its owner's. */
    bio: string | null;
}

/**
 * The limits `DisplayNamePolicy`, `AvatarUrlPolicy` and `BioPolicy` hold on the server, here for the
 * inputs' `maxLength`. Both sides count UTF-16 code units, which is what `maxLength` counts.
 */
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const AVATAR_URL_MAX_LENGTH = 512;
export const BIO_MAX_LENGTH = 500;

/**
 * A save of the profile details that the server refused, with the reason for each field it refused
 * keyed by that field, so the form can put each message beside its input. `message` is the one to
 * show when no field is named — the server unreachable, a conflict, or a body that was not the
 * validation problem it should have been.
 */
export class ProfileDetailsError extends Error {
    readonly fieldErrors: Partial<Record<keyof ProfileDetails, string>>;

    constructor(message: string, fieldErrors: Partial<Record<keyof ProfileDetails, string>> = {}) {
        super(message);
        this.name = 'ProfileDetailsError';
        this.fieldErrors = fieldErrors;
    }
}

/**
 * What a username may be, mirroring `UserNamePolicy` on the server.
 *
 * Here so the form can say what is wrong before a round trip, **never** as the enforcement: the
 * server checks the same rules plus a reserved list this does not carry, and plus availability,
 * which only the database can answer.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function userNameProblem(userName: string): string | null {
    if (userName.length < USERNAME_MIN_LENGTH || userName.length > USERNAME_MAX_LENGTH) {
        return `A username is ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters long.`;
    }

    return USERNAME_PATTERN.test(userName)
        ? null
        : 'A username can use letters, numbers and underscores only.';
}
