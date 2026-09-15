import { createContext } from 'react';
import type { ListId, ListEntryDto, Ownership, ViewMode } from '@/types/list';
import type { SortState } from '@/lib/listSort';
import type { GameDto } from '@/types/game';

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
    /** Deletes everything recorded about a game. The only call that discards a score. */
    deleteEntry: (gameId: number) => Promise<void>;

    view: ViewMode;
    setView: (view: ViewMode) => void;
    sortFor: (listId: ListId) => SortState;
    setSort: (listId: ListId, sort: SortState) => void;
}

export const ListsContext = createContext<ListsContextValue | null>(null);
