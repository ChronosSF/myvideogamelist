import { useState, type ReactNode } from 'react';
import type { GameDto } from '@/types/game';
import { type ListId, LIST_IDS } from '@/types/list';
import { ListsContext } from './ListsContext';

const STORAGE_KEY = 'mvgl_lists';

function loadFromStorage(): Record<ListId, GameDto[]> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as Record<ListId, GameDto[]>;
    } catch {
        // ignore parse errors
    }
    return { playing: [], backlog: [], finished: [] };
}

function saveToStorage(lists: Record<ListId, GameDto[]>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
    } catch {
        // ignore storage errors
    }
}

export function ListsProvider({ children }: { children: ReactNode }) {
    const [lists, setLists] = useState<Record<ListId, GameDto[]>>(loadFromStorage);

    const addToList = (listId: ListId, game: GameDto) => {
        setLists(prev => {
            // A game lives in at most one list — remove it from all lists first
            const next: Record<ListId, GameDto[]> = { playing: [], backlog: [], finished: [] };
            for (const id of LIST_IDS) {
                next[id] = prev[id].filter(g => g.id !== game.id);
            }
            next[listId] = [...next[listId], game];
            saveToStorage(next);
            return next;
        });
    };

    const removeFromList = (listId: ListId, gameId: number) => {
        setLists(prev => {
            const next = { ...prev, [listId]: prev[listId].filter(g => g.id !== gameId) };
            saveToStorage(next);
            return next;
        });
    };

    const isInList = (listId: ListId, gameId: number): boolean =>
        lists[listId].some(g => g.id === gameId);

    const getListFor = (gameId: number): ListId | null =>
        LIST_IDS.find(id => lists[id].some(g => g.id === gameId)) ?? null;

    return (
        <ListsContext.Provider value={{ lists, addToList, removeFromList, isInList, getListFor }}>
            {children}
        </ListsContext.Provider>
    );
}
