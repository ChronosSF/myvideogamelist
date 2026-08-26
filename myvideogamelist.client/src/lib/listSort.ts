import type { ListEntryDto } from '@/types/list';

/**
 * The keys a list can be sorted by. These strings are persisted server-side, so they are part of
 * the API contract and cannot be renamed freely.
 */
export type SortKey =
    | 'added'
    | 'status_changed'
    | 'title'
    | 'release_date'
    | 'score'
    | 'rating'
    | 'critic_score';

export interface SortState {
    key: SortKey;
    descending: boolean;
}

/** Newest first: what someone wants to see when they open a list they have been adding to. */
export const DEFAULT_SORT: SortState = { key: 'added', descending: true };

interface SortOption {
    key: SortKey;
    label: string;
    /** Which direction reads as "best first", used when a sort is first chosen. */
    defaultDescending: boolean;
    /** Label for the table column header, where space is tighter. */
    columnLabel: string;
}

export const SORT_OPTIONS: SortOption[] = [
    { key: 'added', label: 'Date added', defaultDescending: true, columnLabel: 'Added' },
    { key: 'status_changed', label: 'Recently moved', defaultDescending: true, columnLabel: 'Moved' },
    { key: 'title', label: 'Title', defaultDescending: false, columnLabel: 'Title' },
    { key: 'release_date', label: 'Release date', defaultDescending: true, columnLabel: 'Released' },
    { key: 'score', label: 'My score', defaultDescending: true, columnLabel: 'Score' },
    { key: 'rating', label: 'Rating', defaultDescending: true, columnLabel: 'Rating' },
    { key: 'critic_score', label: 'Critic score', defaultDescending: true, columnLabel: 'Critics' },
];

export function sortOption(key: SortKey): SortOption {
    return SORT_OPTIONS.find(option => option.key === key) ?? SORT_OPTIONS[0];
}

/**
 * The value a sort key reads off an entry. `null` means "this entry has nothing to sort by", which
 * is treated separately from a low value — see `compare`.
 */
function sortValue(entry: ListEntryDto, key: SortKey): number | string | null {
    switch (key) {
        case 'added':
            return Date.parse(entry.addedAt);
        case 'status_changed':
            return entry.statusChangedAt === null ? null : Date.parse(entry.statusChangedAt);
        case 'title':
            return entry.game.title.toLocaleLowerCase();
        case 'release_date':
            return entry.game.releaseDate === null ? null : Date.parse(entry.game.releaseDate);
        case 'score':
            return entry.score;
        case 'rating':
            return entry.game.rating;
        case 'critic_score':
            return entry.game.criticScore;
    }
}

/**
 * Sorts a copy of the entries.
 *
 * Two rules worth stating because they are easy to get wrong:
 *
 * - **Entries with no value always sort last**, in both directions. Flipping to ascending should
 *   not promote every unscored game to the top of the list; "no score" is not a low score.
 * - **Title is the tie-breaker** for every other key, so a list sorted by score does not reshuffle
 *   its equal-scoring games on each render. Array.prototype.sort is stable in modern engines, but
 *   relying on input order would make the result depend on how the API happened to return it.
 */
export function sortEntries(entries: ListEntryDto[], sort: SortState): ListEntryDto[] {
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

    return [...entries].sort((left, right) => {
        const a = sortValue(left, sort.key);
        const b = sortValue(right, sort.key);

        if (a === null && b === null) return byTitle(left, right, collator);
        if (a === null) return 1;
        if (b === null) return -1;

        const ordered = typeof a === 'string' && typeof b === 'string'
            ? collator.compare(a, b)
            : Number(a) - Number(b);

        if (ordered !== 0) return sort.descending ? -ordered : ordered;
        return byTitle(left, right, collator);
    });
}

function byTitle(left: ListEntryDto, right: ListEntryDto, collator: Intl.Collator): number {
    return collator.compare(left.game.title, right.game.title);
}
