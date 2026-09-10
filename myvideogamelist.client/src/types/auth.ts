/** Whether an account has a public page at `/u/{userName}`. */
export type ProfileVisibility = 'public' | 'private';

/**
 * The signed-in user, mirroring `UserProfileDto` on the server.
 *
 * `userName` is the public handle — the whole of `/u/{userName}` — and is what the navbar renders.
 * The email is still here because the account settings page shows it, and nothing public does.
 */
export interface UserProfile {
    id: string;
    email: string;
    userName: string;
    theme: 'dark' | 'light';
    /**
     * Carried on every page load so the navbar can tell whether there is a public profile to link
     * to, without a second request for a one-word answer.
     */
    profileVisibility: ProfileVisibility;
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
