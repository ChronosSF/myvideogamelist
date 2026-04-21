import { createContext } from 'react';
import type { ListId } from '@/types/list';
import type { GameDto } from '@/types/game';

export interface ListsContextValue {
    lists: Record<ListId, GameDto[]>;
    addToList: (listId: ListId, game: GameDto) => void;
    removeFromList: (listId: ListId, gameId: number) => void;
    isInList: (listId: ListId, gameId: number) => boolean;
    getListFor: (gameId: number) => ListId | null;
}

export const ListsContext = createContext<ListsContextValue | null>(null);
