import { createContext } from 'react';
import type { ListId } from '@/types/list';
import type { GameDto } from '@/types/game';

export interface ListsContextValue {
    lists: Record<ListId, GameDto[]>;
    loading: boolean;
    error: string | null;
    mutationError: string | null;
    isPending: (gameId: number) => boolean;
    addToList: (listId: ListId, game: GameDto) => Promise<void>;
    removeFromList: (listId: ListId, gameId: number) => Promise<void>;
    isInList: (listId: ListId, gameId: number) => boolean;
    getListFor: (gameId: number) => ListId | null;
}

export const ListsContext = createContext<ListsContextValue | null>(null);
