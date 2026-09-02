import { useEffect, useReducer, useState, type ReactNode } from 'react';
import type { GameDto } from '@/types/game';
import type { WishlistItemDto } from '@/types/wishlist';
import { useAuth } from '@/hooks/useAuth';
import { WishlistContext } from './WishlistContext';

interface WishlistState {
    items: WishlistItemDto[];
    loading: boolean;
    /** Initial fetch failure only — the page has nothing trustworthy to show. */
    error: string | null;
    /** Add or remove failure — shown next to the items, not instead of them. */
    mutationError: string | null;
}

type WishlistAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START' }
    | { type: 'FETCH_SUCCESS'; items: WishlistItemDto[] }
    | { type: 'FETCH_ERROR'; error: string }
    | { type: 'ADD_ITEM'; item: WishlistItemDto }
    | { type: 'DROP_ITEM'; gameId: number }
    | { type: 'MUTATION_ERROR'; error: string }
    | { type: 'CLEAR_MUTATION_ERROR' };

const initialState: WishlistState = {
    items: [],
    loading: false,
    error: null,
    mutationError: null,
};

/** Most recently wanted first, the invariant the server's ordering also follows. */
function newestFirst(items: WishlistItemDto[]): WishlistItemDto[] {
    return [...items].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
}

function reducer(state: WishlistState, action: WishlistAction): WishlistState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'FETCH_START':
            return { ...state, loading: true, error: null };
        case 'FETCH_SUCCESS':
            return { items: action.items, loading: false, error: null, mutationError: null };
        case 'FETCH_ERROR':
            return { ...state, loading: false, error: action.error };
        // ADD_ITEM and DROP_ITEM both work off whatever the current state is, rather than
        // restoring a snapshot taken before the request. Mutations for different games run
        // concurrently by design, so replacing the whole list on rollback would undo whichever
        // of them happened to succeed in the meantime.
        case 'ADD_ITEM':
            return state.items.some(item => item.game.id === action.item.game.id)
                ? state
                : { ...state, items: newestFirst([...state.items, action.item]) };
        case 'DROP_ITEM':
            return {
                ...state,
                items: state.items.filter(item => item.game.id !== action.gameId),
            };
        case 'MUTATION_ERROR':
            return { ...state, mutationError: action.error };
        case 'CLEAR_MUTATION_ERROR':
            return { ...state, mutationError: null };
        default:
            return state;
    }
}

const MUTATION_FAILED = 'Failed to update your wishlist. Please try again.';

/**
 * Holds the user's wishlist.
 *
 * A provider of its own rather than more fields on `ListsProvider`, for the same reason the server
 * has a separate service and controller: the wishlist shares nothing with the status lists but the
 * game id. Folding it in would have meant one context whose name described half of what it held,
 * and a pending-mutation set shared between two independent axes — so a status change in flight
 * would have blocked a wishlist click on the same game for no reason.
 *
 * The state is a reducer rather than several `useState` calls because the fetch effect has to set
 * state synchronously, and `react-hooks/set-state-in-effect` forbids that for a setter while
 * allowing a `dispatch`. `ListsProvider` is shaped the same way for the same reason.
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
    const { user, loading: authLoading } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);
    // Wishlist mutations only. Deliberately not shared with the list mutations in ListsProvider:
    // the two axes are independent, so one being in flight must not disable the other.
    const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            dispatch({ type: 'RESET' });
            return;
        }

        const controller = new AbortController();
        dispatch({ type: 'FETCH_START' });

        fetch('/api/wishlist', { credentials: 'include', signal: controller.signal })
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load your wishlist (${res.status})`);
                return res.json() as Promise<WishlistItemDto[]>;
            })
            .then(items => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', items });
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                // Surfaced rather than swallowed: an empty wishlist and one that failed to load
                // look identical on screen, and the second must not read as the first.
                dispatch({
                    type: 'FETCH_ERROR',
                    error: err instanceof Error ? err.message : 'Failed to load your wishlist.',
                });
            });

        return () => controller.abort();
    }, [user, authLoading]);

    /**
     * Membership is not known until the initial fetch lands, so nothing may be toggled before
     * then: a write that succeeded during the fetch would be silently overwritten when the older
     * response arrived and replaced the list.
     */
    const isPending = (gameId: number): boolean => state.loading || pendingIds.has(gameId);

    const startPending = (gameId: number) => setPendingIds(prev => new Set(prev).add(gameId));
    const endPending = (gameId: number) =>
        setPendingIds(prev => { const next = new Set(prev); next.delete(gameId); return next; });

    const add = async (game: GameDto): Promise<void> => {
        if (isPending(game.id) || state.items.some(item => item.game.id === game.id)) return;
        startPending(game.id);

        dispatch({ type: 'ADD_ITEM', item: { game, addedAt: new Date().toISOString() } });

        try {
            const res = await fetch(`/api/wishlist/${game.id}`, {
                method: 'PUT',
                credentials: 'include',
            });

            if (res.ok) dispatch({ type: 'CLEAR_MUTATION_ERROR' });
            else {
                dispatch({ type: 'DROP_ITEM', gameId: game.id });
                dispatch({ type: 'MUTATION_ERROR', error: MUTATION_FAILED });
            }
        } catch {
            dispatch({ type: 'DROP_ITEM', gameId: game.id });
            dispatch({ type: 'MUTATION_ERROR', error: MUTATION_FAILED });
        } finally {
            endPending(game.id);
        }
    };

    const remove = async (gameId: number): Promise<void> => {
        if (isPending(gameId)) return;
        startPending(gameId);

        // Only the one row is remembered, so putting it back cannot disturb anything else. Its
        // AddedAt is what returns it to its original position rather than the top of the list.
        const removed = state.items.find(item => item.game.id === gameId);
        dispatch({ type: 'DROP_ITEM', gameId });

        try {
            const res = await fetch(`/api/wishlist/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            // 404 means it was not on the wishlist, which is the state the caller asked for.
            if (res.ok || res.status === 404) dispatch({ type: 'CLEAR_MUTATION_ERROR' });
            else {
                if (removed) dispatch({ type: 'ADD_ITEM', item: removed });
                dispatch({ type: 'MUTATION_ERROR', error: MUTATION_FAILED });
            }
        } catch {
            if (removed) dispatch({ type: 'ADD_ITEM', item: removed });
            dispatch({ type: 'MUTATION_ERROR', error: MUTATION_FAILED });
        } finally {
            endPending(gameId);
        }
    };

    const isWishlisted = (gameId: number): boolean =>
        state.items.some(item => item.game.id === gameId);

    return (
        <WishlistContext.Provider value={{
            items: state.items,
            loading: state.loading,
            error: state.error,
            mutationError: state.mutationError,
            isWishlisted,
            isPending,
            add,
            remove,
        }}>
            {children}
        </WishlistContext.Provider>
    );
}
