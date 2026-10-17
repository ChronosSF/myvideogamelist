import { formatCount } from '@/lib/format';

/**
 * One of the signed-in user's tags, from `GET /api/tags`, and how many of their games carry it.
 *
 * Tags are their owner's alone — never on a public profile or in anything a stranger reads — and a
 * list row carries only their ids, so a rename is one row of the account's tags and no row of the
 * lists (`docs/decisions/0065-*`).
 */
export interface TagDto {
    id: number;
    name: string;
    /** Games carrying it, whether or not they are in a list. */
    count: number;
}

/** The server's `TagNamePolicy.MaxLength`, for the input's own limit. */
export const TAG_NAME_MAX = 30;

/** The server's `TagNamePolicy.MaxTagsPerEntry`: the most tags one game may carry. */
export const MAX_TAGS_PER_GAME = 20;

/**
 * A name as the server will store it: composed, trimmed, and every run of whitespace one space. The
 * server's `TagNamePolicy.Normalise` is the authority; this is for deciding what to offer.
 */
export function normaliseTagName(raw: string): string {
    return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * Two names that are one tag. The server folds case with .NET's invariant upper-casing, which differs
 * from JavaScript's in a handful of characters; that only matters to what the client offers, because
 * creating a name the account already has answers with that tag rather than a second one.
 */
export function sameTagName(a: string, b: string): boolean {
    return normaliseTagName(a).toLowerCase() === normaliseTagName(b).toLowerCase();
}

/**
 * Name order, for every place tags are listed. A fixed locale rather than the runtime's, so the order
 * is the same in every browser, and numeric, so "2" comes before "10".
 */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function compareTags(a: TagDto, b: TagDto): number {
    return collator.compare(a.name, b.name) || a.id - b.id;
}

export function sortTags(tags: readonly TagDto[]): TagDto[] {
    return [...tags].sort(compareTags);
}

/**
 * The tags a row's ids name, in name order. An id the account's tags do not have — a tag deleted since
 * the lists loaded — is left out rather than shown as a blank chip.
 */
export function tagsFor(ids: readonly number[], byId: ReadonlyMap<number, TagDto>): TagDto[] {
    const found: TagDto[] = [];
    for (const id of ids) {
        const tag = byId.get(id);
        if (tag !== undefined) found.push(tag);
    }
    return found.sort(compareTags);
}

/** "1 game", "3 games". */
export function gamesCarrying(count: number): string {
    return count === 1 ? '1 game' : `${formatCount(count)} games`;
}
