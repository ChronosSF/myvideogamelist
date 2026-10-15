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
    | 'critic_score'
    | 'manual';

export interface SortState {
    key: SortKey;
    descending: boolean;
}

/** Newest first: what someone wants to see when they open a list they have been adding to. */
export const DEFAULT_SORT: SortState = { key: 'added', descending: true };

/**
 * The order the user arranged by hand. It has no direction — a hand order read backwards is not one
 * anybody arranged — so `descending` is always false and is ignored. Offered only on the lists in
 * `HAND_ORDERED_LISTS`; see `docs/decisions/0054-*`.
 */
export const MANUAL_SORT: SortState = { key: 'manual', descending: false };

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

/**
 * The hand order, kept out of `SORT_OPTIONS` because it is not every list's: the toolbar appends it
 * where the list offers it, and no table column sorts by it.
 */
export const MANUAL_OPTION: SortOption = {
    key: 'manual',
    label: 'My order',
    defaultDescending: false,
    columnLabel: 'Order',
};

export function sortOption(key: SortKey): SortOption {
    if (key === MANUAL_OPTION.key) return MANUAL_OPTION;
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
        case 'manual':
            return entry.position;
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

    if (sort.key === 'manual') return [...entries].sort((left, right) => byHand(left, right, collator));

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

/**
 * The hand order: placed games by position, then every game never placed in the order it joined the
 * list — oldest first, so a game added today queues at the end rather than taking a place nobody gave
 * it. The two rules above still hold, reworded: "no position" is not a low position, and a tie is
 * broken the same way every time.
 *
 * A game joins a list when its status changes, which `statusChangedAt` records; an import leaves that
 * null (ADR 0026), and `addedAt` is then the best date there is. Title and then the game's id break
 * what is left, which is two games placed at the same number by two tabs at once, or two that arrived
 * in one import.
 *
 * `@/lib/handOrder`'s `planMove` reads this order and only this one, so the two must agree on what
 * "after" means — which is why the unplaced have an order of their own rather than the title's.
 */
function byHand(left: ListEntryDto, right: ListEntryDto, collator: Intl.Collator): number {
    if (left.position !== right.position) {
        if (left.position === null) return 1;
        if (right.position === null) return -1;
        return left.position - right.position;
    }

    return arrival(left) - arrival(right)
        || byTitle(left, right, collator)
        || left.game.id - right.game.id;
}

function arrival(entry: ListEntryDto): number {
    return Date.parse(entry.statusChangedAt ?? entry.addedAt);
}
