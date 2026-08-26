import { useEffect, useReducer, useState, type ReactNode } from 'react';
import type { GameDto } from '@/types/game';
import { type ListId, type ListEntryDto, type ViewMode, LIST_IDS, emptyLists } from '@/types/list';
import { type SortState, DEFAULT_SORT } from '@/lib/listSort';
import { useAuth } from '@/hooks/useAuth';
import { ListsContext } from './ListsContext';

interface ApiListsResponse {
    lists: Record<ListId, ListEntryDto[]>;
}

interface ApiPreferencesResponse {
    view: ViewMode;
    /** Only the lists the user has actually changed; everything else uses `DEFAULT_SORT`. */
    sorts: Partial<Record<ListId, { sortKey: SortState['key']; descending: boolean }>>;
}

interface ListsState {
    lists: Record<ListId, ListEntryDto[]>;
    view: ViewMode;
    sorts: Partial<Record<ListId, SortState>>;
    loading: boolean;
    /** Set only on the initial fetch failure — triggers the full-page error state. */
    error: string | null;
    /** Set on per-card mutation failures — shown as a dismissible banner. */
    mutationError: string | null;
}

type ListsAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START' }
    | { type: 'FETCH_SUCCESS'; lists: Record<ListId, ListEntryDto[]> }
    | { type: 'FETCH_ERROR'; error: string }
    | { type: 'PREFERENCES_LOADED'; view: ViewMode; sorts: Partial<Record<ListId, SortState>> }
    | { type: 'SET_LIST'; listId: ListId; entries: ListEntryDto[] }
    | { type: 'SET_ENTRIES'; lists: Record<ListId, ListEntryDto[]> }
    | { type: 'SET_VIEW'; view: ViewMode }
    | { type: 'SET_SORT'; listId: ListId; sort: SortState }
    | { type: 'MUTATION_ERROR'; error: string }
    | { type: 'CLEAR_MUTATION_ERROR' };

const initialState: ListsState = {
    lists: emptyLists(),
    view: 'tiles',
    sorts: {},
    loading: false,
    error: null,
    mutationError: null,
};

function reducer(state: ListsState, action: ListsAction): ListsState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'FETCH_START':
            return { ...state, loading: true, error: null };
        case 'FETCH_SUCCESS':
            return {
                ...state,
                loading: false,
                error: null,
                mutationError: null,
                // Spread over a complete empty set, so a status the server has not sent yet
                // still resolves to [] rather than undefined.
                lists: { ...emptyLists(), ...action.lists },
            };
        case 'FETCH_ERROR':
            return { ...state, loading: false, error: action.error };
        case 'PREFERENCES_LOADED':
            return { ...state, view: action.view, sorts: action.sorts };
        case 'SET_LIST':
            return { ...state, lists: { ...state.lists, [action.listId]: action.entries } };
        case 'SET_ENTRIES':
            return { ...state, lists: action.lists };
        case 'SET_VIEW':
            return { ...state, view: action.view };
        case 'SET_SORT':
            return { ...state, sorts: { ...state.sorts, [action.listId]: action.sort } };
        case 'MUTATION_ERROR':
            return { ...state, mutationError: action.error };
        case 'CLEAR_MUTATION_ERROR':
            return { ...state, mutationError: null };
        default:
            return state;
    }
}

/** Finds a game's entry wherever it sits, so a move can carry the score across. */
function findEntry(lists: Record<ListId, ListEntryDto[]>, gameId: number): ListEntryDto | null {
    for (const id of LIST_IDS) {
        const found = lists[id].find(entry => entry.game.id === gameId);
        if (found) return found;
    }
    return null;
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
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', lists: data.lists });
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                dispatch({
                    type: 'FETCH_ERROR',
                    error: err instanceof Error ? err.message : 'Failed to load lists.',
                });
            });

        // Fetched alongside rather than before: preferences only affect presentation, so failing
        // to load them falls back to the defaults rather than blocking the lists themselves.
        fetch('/api/user/list-preferences', { credentials: 'include', signal: controller.signal })
            .then(res => (res.ok ? (res.json() as Promise<ApiPreferencesResponse>) : null))
            .then(data => {
                if (!data || controller.signal.aborted) return;
                const sorts: Partial<Record<ListId, SortState>> = {};
                for (const [id, sort] of Object.entries(data.sorts) as [ListId, { sortKey: SortState['key']; descending: boolean }][]) {
                    sorts[id] = { key: sort.sortKey, descending: sort.descending };
                }
                dispatch({ type: 'PREFERENCES_LOADED', view: data.view, sorts });
            })
            .catch(() => {
                // Swallowed by design — the defaults are a perfectly good fallback and a failed
                // preference load is not worth an error state over the user's actual lists.
            });

        return () => controller.abort();
    }, [user, authLoading]);

    /** Sends the whole preference set, matching the endpoint's replace-wholesale contract. */
    const persistPreferences = (view: ViewMode, sorts: Partial<Record<ListId, SortState>>) => {
        void fetch('/api/user/list-preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                view,
                sorts: Object.entries(sorts).map(([status, sort]) => ({
                    status,
                    sortKey: sort.key,
                    descending: sort.descending,
                })),
            }),
        }).catch(() => {
            // A preference that fails to save is not worth interrupting anyone over. The UI keeps
            // the new setting and the next page load reconciles with whatever the server has.
        });
    };

    const setView = (view: ViewMode) => {
        dispatch({ type: 'SET_VIEW', view });
        persistPreferences(view, state.sorts);
    };

    const setSort = (listId: ListId, sort: SortState) => {
        dispatch({ type: 'SET_SORT', listId, sort });
        persistPreferences(state.view, { ...state.sorts, [listId]: sort });
    };

    const sortFor = (listId: ListId): SortState => state.sorts[listId] ?? DEFAULT_SORT;

    const addToList = async (listId: ListId, game: GameDto): Promise<void> => {
        if (pendingIds.has(game.id)) return;
        setPendingIds(prev => new Set(prev).add(game.id));

        const prevLists = state.lists;

        // A move carries the existing entry across so the score does not blink out and back.
        const existing = findEntry(prevLists, game.id);
        const moved: ListEntryDto = existing
            ? { ...existing, statusChangedAt: new Date().toISOString() }
            : { game, score: null, addedAt: new Date().toISOString(), statusChangedAt: new Date().toISOString() };

        const updated: Record<ListId, ListEntryDto[]> = emptyLists();
        for (const id of LIST_IDS) {
            updated[id] = prevLists[id].filter(entry => entry.game.id !== game.id);
        }
        updated[listId] = [...updated[listId], moved];
        dispatch({ type: 'SET_ENTRIES', lists: updated });

        try {
            const res = await fetch(`/api/lists/${game.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status: listId }),
            });

            if (!res.ok) {
                dispatch({ type: 'SET_ENTRIES', lists: prevLists });
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to update list. Please try again.' });
            }
        } finally {
            setPendingIds(prev => { const s = new Set(prev); s.delete(game.id); return s; });
        }
    };

    const removeFromList = async (listId: ListId, gameId: number): Promise<void> => {
        if (pendingIds.has(gameId)) return;
        setPendingIds(prev => new Set(prev).add(gameId));

        const prevEntries = state.lists[listId];

        dispatch({
            type: 'SET_LIST',
            listId,
            entries: prevEntries.filter(entry => entry.game.id !== gameId),
        });

        try {
            const res = await fetch(`/api/lists/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            if (!res.ok) {
                dispatch({ type: 'SET_LIST', listId, entries: prevEntries });
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to remove from list. Please try again.' });
            }
        } finally {
            setPendingIds(prev => { const s = new Set(prev); s.delete(gameId); return s; });
        }
    };

    const setScore = async (gameId: number, score: number | null): Promise<boolean> => {
        const prevLists = state.lists;

        // The entry may be in no list at all, in which case there is nothing on screen to update
        // optimistically and the server call is the whole operation.
        const updated: Record<ListId, ListEntryDto[]> = emptyLists();
        for (const id of LIST_IDS) {
            updated[id] = prevLists[id].map(entry =>
                entry.game.id === gameId ? { ...entry, score } : entry);
        }
        dispatch({ type: 'SET_ENTRIES', lists: updated });

        try {
            const res = await fetch(`/api/entries/${gameId}/score`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ score }),
            });

            if (!res.ok) {
                dispatch({ type: 'SET_ENTRIES', lists: prevLists });
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to save your score. Please try again.' });
                return false;
            }
            return true;
        } catch {
            dispatch({ type: 'SET_ENTRIES', lists: prevLists });
            dispatch({ type: 'MUTATION_ERROR', error: 'Failed to save your score. Please try again.' });
            return false;
        }
    };

    const deleteEntry = async (gameId: number): Promise<void> => {
        if (pendingIds.has(gameId)) return;
        setPendingIds(prev => new Set(prev).add(gameId));

        const prevLists = state.lists;

        const updated: Record<ListId, ListEntryDto[]> = emptyLists();
        for (const id of LIST_IDS) {
            updated[id] = prevLists[id].filter(entry => entry.game.id !== gameId);
        }
        dispatch({ type: 'SET_ENTRIES', lists: updated });

        try {
            const res = await fetch(`/api/entries/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            // 404 means there was nothing recorded, which is the state the caller wanted anyway.
            if (!res.ok && res.status !== 404) {
                dispatch({ type: 'SET_ENTRIES', lists: prevLists });
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to remove your data. Please try again.' });
            }
        } finally {
            setPendingIds(prev => { const s = new Set(prev); s.delete(gameId); return s; });
        }
    };

    const isInList = (listId: ListId, gameId: number): boolean =>
        state.lists[listId].some(entry => entry.game.id === gameId);

    const getListFor = (gameId: number): ListId | null =>
        LIST_IDS.find(id => state.lists[id].some(entry => entry.game.id === gameId)) ?? null;

    const scoreFor = (gameId: number): number | null => findEntry(state.lists, gameId)?.score ?? null;

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
            scoreFor,
            setScore,
            deleteEntry,
            view: state.view,
            setView,
            sortFor,
            setSort,
        }}>
            {children}
        </ListsContext.Provider>
    );
}
