import { pageSearch } from './paging';

/**
 * A profile's address: `/u/{publicId}/{userName}`, where only the id is looked up (ADR 0096).
 *
 * The id never changes and is never another account's, so a link built on it survives a rename and is
 * never handed to whoever claims the old name. The name is there for people to read, and the page
 * redirects any other name, or none, to the one its owner has now.
 */

/** How many characters a public id has, exactly. Mirrors `PublicIdPolicy.Length`. */
export const PUBLIC_ID_LENGTH = 12;

/** The digits and the lower-case consonants but `l`. Mirrors `PublicIdPolicy.Alphabet`. */
export const PUBLIC_ID_ALPHABET = '0123456789bcdfghjkmnpqrstvwxyz';

/**
 * Whether a path segment could be a public id at all. One that cannot is answered as an id nobody holds,
 * without asking the API, which would answer the same 404.
 */
export function isPublicId(value: string): boolean {
    return value.length === PUBLIC_ID_LENGTH && [...value].every(character => PUBLIC_ID_ALPHABET.includes(character));
}

/** The two halves of a profile's address, as every DTO that links to a profile carries them. */
export interface ProfileAddress {
    publicId: string;
    userName: string;
}

/**
 * Whether a value carries both halves of an address. Not so from an API a release behind, mid-deploy,
 * which sends names alone: an address built from that would be `/u/undefined/…`.
 */
export function isProfileAddress(value: unknown): value is ProfileAddress {
    if (typeof value !== 'object' || value === null) return false;
    const { publicId, userName } = value as Partial<Record<keyof ProfileAddress, unknown>>;
    return typeof publicId === 'string' && isPublicId(publicId) && typeof userName === 'string';
}

/**
 * The address of a profile, or of one page of its reviews past the first. The one place it is built, so
 * that a link, the canonical URL, the redirect and the sitemap all write the same string.
 */
export function profilePath({ publicId, userName }: ProfileAddress, page = 1): string {
    return `/u/${publicId}/${encodeURIComponent(userName)}${pageSearch(page)}`;
}
