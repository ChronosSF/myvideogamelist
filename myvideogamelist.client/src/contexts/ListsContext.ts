import { createContext } from 'react';
import type { ListId, ListEntryDto, ListNames, Ownership, ViewMode } from '@/types/list';
import type { SortState } from '@/lib/listSort';
import type { GameDto } from '@/types/game';

/**
 * How a names save ended. A refusal carries a message per list, keyed as the inputs are, and a
 * failure that is about no one list — the API down, a 500 — carries `error` instead.
 */
export type SaveListNamesResult =
    | { ok: true }
    | { ok: false; fieldErrors: Partial<Record<ListId, string>>; error: string | null };

export interface ListsContextValue {
    /** Every status list, keyed by status. Entries with no status appear in none of them. */
    lists: Record<ListId, ListEntryDto[]>;
    loading: boolean;
    error: string | null;
    mutationError: string | null;
    isPending: (gameId: number) => boolean;

    addToList: (listId: ListId, game: GameDto) => Promise<void>;
    /** Takes the game out of every list. The score and everything else on the entry survive. */
    removeFromList: (listId: ListId, gameId: number) => Promise<void>;
    isInList: (listId: ListId, gameId: number) => boolean;
    getListFor: (gameId: number) => ListId | null;

    /** The user's score for a game, wherever it sits — null when they have not scored it. */
    scoreFor: (gameId: number) => number | null;
    /** Returns false when the save failed, so a caller holding its own copy can revert. */
    setScore: (gameId: number, score: number | null) => Promise<boolean>;
    /**
     * Says how the user has the game, or clears it with null. Takes the per-game lock, because it
     * writes the same entry row as a score or a move; nothing in the lists shows it, so the caller
     * holds the value and reverts on false.
     */
    setOwnership: (gameId: number, ownership: Ownership | null) => Promise<boolean>;
    /** Replaces the user's private notes on the game. The same lock and the same contract. */
    setNotes: (gameId: number, notes: string | null) => Promise<boolean>;
    /**
     * Deletes everything recorded about a game. The only call that discards a score. False when
     * nothing was deleted — the request failed, or another write to the game was still out — so a
     * caller showing its own copy of the entry knows to keep showing it.
     */
    deleteEntry: (gameId: number) => Promise<boolean>;

    view: ViewMode;
    setView: (view: ViewMode) => void;
    sortFor: (listId: ListId) => SortState;
    setSort: (listId: ListId, sort: SortState) => void;

    /** What the user calls the lists they have renamed. Every label should go through `nameFor`. */
    names: ListNames;
    /** The user's name for a list, or its default. */
    nameFor: (listId: ListId) => string;
    /**
     * Whether `names` is known. Not the same as `loading`: the names arrive with the preferences,
     * which can fail while the lists load fine — and a names form filled from a failed load would
     * show every list at its default and save that over what the user had chosen.
     */
    namesStatus: 'loading' | 'ready' | 'failed';
    /** Replaces all five names at once; a list given no name, or its default, goes back to it. */
    saveListNames: (names: ListNames) => Promise<SaveListNamesResult>;
}

export const ListsContext = createContext<ListsContextValue | null>(null);
