import { useEffect, useReducer, type ReactNode } from 'react';
import type { GameDto } from '@/types/game';
import { type ListId, LIST_IDS } from '@/types/list';
import { useAuth } from '@/hooks/useAuth';
import { ListsContext } from './ListsContext';

interface ApiListsResponse {
    playing: GameDto[];
    backlog: GameDto[];
    finished: GameDto[];
}

interface ListsState {
    lists: Record<ListId, GameDto[]>;
    loading: boolean;
    error: string | null;
}

type ListsAction =
    | { type: 'FETCH_START' }
    | { type: 'FETCH_SUCCESS'; data: ApiListsResponse }
    | { type: 'FETCH_ERROR'; error: string }
    | { type: 'SET_LIST'; listId: ListId; games: GameDto[] }
    | { type: 'CLEAR_ERROR' };

const EMPTY_LISTS: Record<ListId, GameDto[]> = { playing: [], backlog: [], finished: [] };

const initialState: ListsState = { lists: EMPTY_LISTS, loading: false, error: null };

function reducer(state: ListsState, action: ListsAction): ListsState {
    switch (action.type) {
        case 'FETCH_START':
            return { ...state, loading: true, error: null };
        case 'FETCH_SUCCESS':
            return {
                loading: false,
                error: null,
                lists: {
                    playing: action.data.playing,
                    backlog: action.data.backlog,
                    finished: action.data.finished,
                },
            };
        case 'FETCH_ERROR':
            return { ...state, loading: false, error: action.error };
        case 'SET_LIST':
            return { ...state, lists: { ...state.lists, [action.listId]: action.games } };
        case 'CLEAR_ERROR':
            return { ...state, error: null };
        default:
            return state;
    }
}

export function ListsProvider({ children }: { children: ReactNode }) {
    const { user, loading: authLoading } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);

    useEffect(() => {
        if (authLoading || !user) return;

        const controller = new AbortController();
        dispatch({ type: 'FETCH_START' });

        fetch('/api/lists', { credentials: 'include', signal: controller.signal })
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load lists (${res.status})`);
                return res.json() as Promise<ApiListsResponse>;
            })
            .then(data => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', data });
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                dispatch({
                    type: 'FETCH_ERROR',
                    error: err instanceof Error ? err.message : 'Failed to load lists.',
                });
            });

        return () => controller.abort();
    }, [user, authLoading]);

    const addToList = async (listId: ListId, game: GameDto): Promise<void> => {
        // Optimistically update — a game lives in at most one list
        const updated: Record<ListId, GameDto[]> = { playing: [], backlog: [], finished: [] };
        for (const id of LIST_IDS) {
            updated[id] = state.lists[id].filter(g => g.id !== game.id);
        }
        updated[listId] = [...updated[listId], game];
        for (const id of LIST_IDS) {
            dispatch({ type: 'SET_LIST', listId: id, games: updated[id] });
        }

        const res = await fetch(`/api/lists/${game.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ listType: listId }),
        });

        if (!res.ok) {
            dispatch({ type: 'FETCH_ERROR', error: 'Failed to update list. Please try again.' });
        }
    };

    const removeFromList = async (listId: ListId, gameId: number): Promise<void> => {
        dispatch({
            type: 'SET_LIST',
            listId,
            games: state.lists[listId].filter(g => g.id !== gameId),
        });

        const res = await fetch(`/api/lists/${gameId}`, {
            method: 'DELETE',
            credentials: 'include',
        });

        if (!res.ok) {
            dispatch({ type: 'FETCH_ERROR', error: 'Failed to remove from list. Please try again.' });
        }
    };

    const isInList = (listId: ListId, gameId: number): boolean =>
        state.lists[listId].some(g => g.id === gameId);

    const getListFor = (gameId: number): ListId | null =>
        LIST_IDS.find(id => state.lists[id].some(g => g.id === gameId)) ?? null;

    return (
        <ListsContext.Provider value={{
            lists: state.lists,
            loading: state.loading,
            error: state.error,
            addToList,
            removeFromList,
            isInList,
            getListFor,
        }}>
            {children}
        </ListsContext.Provider>
    );
}
