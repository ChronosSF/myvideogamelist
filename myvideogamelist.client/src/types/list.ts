import type { GameDto } from '@/types/game';

/**
 * The five predefined status lists. A game is in exactly one of them — which is what separates
 * a status from a custom list (many per game) or the wishlist (a separate axis).
 *
 * These keys are the server's `ListStatus.Key` values and are permanent: they are written into
 * the status event log, so renaming one would reinterpret history that has already been recorded.
 * Display names are a separate concern and will eventually be user-editable, at which point
 * `LIST_NAMES` becomes a fallback for the server-supplied name rather than the only source.
 */
export type ListId = 'backlog' | 'playing' | 'on_hold' | 'finished' | 'dropped';

/**
 * One game plus what this user has recorded about it. `statusChangedAt` is null for an entry that
 * has never been in a list, and `score` is independent of list membership entirely — a game keeps
 * its score after it leaves every list.
 */
export interface ListEntryDto {
    game: GameDto;
    score: number | null;
    addedAt: string;
    statusChangedAt: string | null;
}

/** Layout of the list views. Global, unlike the sort order which is per status list. */
export type ViewMode = 'tiles' | 'table';

export const VIEW_MODES: ViewMode[] = ['tiles', 'table'];

export interface GameList {
    id: ListId;
    name: string;
    games: GameDto[];
}

/** Lifecycle order, not alphabetical — the set reads as a pipeline. */
export const LIST_IDS: ListId[] = ['backlog', 'playing', 'on_hold', 'finished', 'dropped'];

export const LIST_NAMES: Record<ListId, string> = {
    backlog: 'Backlog',
    playing: 'Playing',
    on_hold: 'On Hold',
    finished: 'Finished',
    dropped: 'Dropped',
};

/**
 * An empty list per status, so callers never have to guard a missing key. Built from
 * `LIST_IDS` rather than written out, so adding a status cannot leave a hole here.
 */
export function emptyLists<T = ListEntryDto>(): Record<ListId, T[]> {
    const lists = {} as Record<ListId, T[]>;
    for (const id of LIST_IDS) lists[id] = [];
    return lists;
}
