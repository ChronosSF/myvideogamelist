/**
 * Where an account's picture may come from, and what to show when it does not come at all.
 *
 * An avatar is an address, not a file: the server stores what its owner pasted and never fetches it,
 * and every reader's browser loads it from its host. That request carries the reader's address to
 * a host somebody else chose, before the reader has chosen anything, so the host has to be one of a
 * short list — see `docs/decisions/0056-*`.
 */

/**
 * The hosts an avatar may be loaded from, mirroring `AvatarUrlPolicy.Hosts` on the server, which is
 * the authority on what may be saved.
 *
 * This copy is what lets a page load them: the document policy's `img-src` adds these to its own
 * sources (`IMAGE_SOURCES` in `@/lib/securityHeaders`), so a host here is a host every reader's
 * browser may be sent to. An image host that is not an avatar host belongs there, not here.
 * `serverMirrors.test.ts` reads the server's list and fails when the two differ — a host on the
 * server's list and not on this one would be saved and then refused by every browser.
 */
export const AVATAR_HOSTS: readonly string[] = [
    'gravatar.com',
    'www.gravatar.com',
    'secure.gravatar.com',
    '0.gravatar.com',
    '1.gravatar.com',
    '2.gravatar.com',
    'avatars.githubusercontent.com',
    'avatars.steamstatic.com',
    'avatars.akamai.steamstatic.com',
    'avatars.fastly.steamstatic.com',
    'i.imgur.com',
];

/** The services behind `AVATAR_HOSTS`, as the settings page names them: `AvatarUrlPolicy.Services`. */
export const AVATAR_SERVICES = 'Gravatar, GitHub, Steam or Imgur';

/**
 * The address to load, or null to show the initial instead.
 *
 * The server only ever stores an `https:` address on a listed host, so this refuses nothing it
 * hands out. It is here for the day the list shrinks under an address already saved: an image the
 * page's policy would refuse is not asked for, so the initial shows at once rather than after a
 * refused request and a line in the console. The address is returned as stored, never rebuilt.
 */
export function avatarSource(url: string | null | undefined): string | null {
    if (!url) return null;

    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && AVATAR_HOSTS.includes(parsed.hostname) ? url : null;
    } catch {
        return null;
    }
}

/**
 * The generated avatar: the first character of the handle, capitalised. The handle and not the
 * display name, because every account has one and it is always a letter, a digit or an underscore.
 */
export function avatarInitial(userName: string): string {
    return userName.charAt(0).toUpperCase();
}
