import { useEffect, useReducer, useState, type ReactNode } from 'react';
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
    /** Set only on the initial fetch failure — triggers the full-page error state. */
    error: string | null;
    /** Set on per-card mutation failures — shown as a dismissible banner. */
    mutationError: string | null;
}

type ListsAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START' }
    | { type: 'FETCH_SUCCESS'; data: ApiListsResponse }
    | { type: 'FETCH_ERROR'; error: string }
    | { type: 'SET_LIST'; listId: ListId; games: GameDto[] }
    | { type: 'MUTATION_ERROR'; error: string }
    | { type: 'CLEAR_MUTATION_ERROR' };

const EMPTY_LISTS: Record<ListId, GameDto[]> = { playing: [], backlog: [], finished: [] };

const initialState: ListsState = { lists: EMPTY_LISTS, loading: false, error: null, mutationError: null };

function reducer(state: ListsState, action: ListsAction): ListsState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'FETCH_START':
            return { ...state, loading: true, error: null };
        case 'FETCH_SUCCESS':
            return {
                loading: false,
                error: null,
                mutationError: null,
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
        case 'MUTATION_ERROR':
            return { ...state, mutationError: action.error };
        case 'CLEAR_MUTATION_ERROR':
            return { ...state, mutationError: null };
        default:
            return state;
    }
}

export function ListsProvider({ children }: { children: ReactNode }) {
    const { user, loading: authLoading } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);
    // Track gameIds with in-flight mutations to prevent concurrent-update corruption
    const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            dispatch({ type: 'RESET' });
            return;
        }

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
        if (pendingIds.has(game.id)) return;

        // Mark as pending to prevent concurrent mutations
        setPendingIds(prev => new Set(prev).add(game.id));

        // Capture previous state for rollback
        const prevLists = state.lists;

        // Optimistically update — a game lives in at most one list
        const updated: Record<ListId, GameDto[]> = { playing: [], backlog: [], finished: [] };
        for (const id of LIST_IDS) {
            updated[id] = state.lists[id].filter(g => g.id !== game.id);
        }
        updated[listId] = [...updated[listId], game];
        for (const id of LIST_IDS) {
            dispatch({ type: 'SET_LIST', listId: id, games: updated[id] });
        }

        try {
            const res = await fetch(`/api/lists/${game.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ listType: listId }),
            });

            if (!res.ok) {
                for (const id of LIST_IDS) {
                    dispatch({ type: 'SET_LIST', listId: id, games: prevLists[id] });
                }
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to update list. Please try again.' });
            }
        } finally {
            setPendingIds(prev => { const s = new Set(prev); s.delete(game.id); return s; });
        }
    };

    const removeFromList = async (listId: ListId, gameId: number): Promise<void> => {
        if (pendingIds.has(gameId)) return;

        // Mark as pending to prevent concurrent mutations
        setPendingIds(prev => new Set(prev).add(gameId));

        // Capture previous state for rollback
        const prevGames = state.lists[listId];

        dispatch({
            type: 'SET_LIST',
            listId,
            games: state.lists[listId].filter(g => g.id !== gameId),
        });

        try {
            const res = await fetch(`/api/lists/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            if (!res.ok) {
                dispatch({ type: 'SET_LIST', listId, games: prevGames });
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to remove from list. Please try again.' });
            }
        } finally {
            setPendingIds(prev => { const s = new Set(prev); s.delete(gameId); return s; });
        }
    };

    const isInList = (listId: ListId, gameId: number): boolean =>
        state.lists[listId].some(g => g.id === gameId);

    const getListFor = (gameId: number): ListId | null =>
        LIST_IDS.find(id => state.lists[id].some(g => g.id === gameId)) ?? null;

    const isPending = (gameId: number): boolean => pendingIds.has(gameId);

    return (
        <ListsContext.Provider value={{
            lists: state.lists,
            loading: state.loading,
            error: state.error,
            mutationError: state.mutationError,
            isPending,
            addToList,
            removeFromList,
            isInList,
            getListFor,
        }}>
            {children}
        </ListsContext.Provider>
    );
}
