import { createContext } from 'react';
import type { ListId, ListEntryDto, ViewMode } from '@/types/list';
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
    /** Deletes everything recorded about a game. The only call that discards a score. */
    deleteEntry: (gameId: number) => Promise<void>;

    view: ViewMode;
    setView: (view: ViewMode) => void;
    sortFor: (listId: ListId) => SortState;
    setSort: (listId: ListId, sort: SortState) => void;
}

export const ListsContext = createContext<ListsContextValue | null>(null);
