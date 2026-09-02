import { useEffect, useReducer, useState, type ReactNode } from 'react';
import type { GameDto } from '@/types/game';
import type { WishlistItemDto } from '@/types/wishlist';
import { useAuth } from '@/hooks/useAuth';
import { WishlistContext } from './WishlistContext';

interface WishlistState {
    items: WishlistItemDto[];
    loading: boolean;
    error: string | null;
}

type WishlistAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START' }
    | { type: 'FETCH_SUCCESS'; items: WishlistItemDto[] }
    | { type: 'FETCH_ERROR'; error: string }
    | { type: 'SET_ITEMS'; items: WishlistItemDto[] }
    | { type: 'MUTATION_ERROR'; error: string };

const initialState: WishlistState = { items: [], loading: false, error: null };

function reducer(state: WishlistState, action: WishlistAction): WishlistState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'FETCH_START':
            return { ...state, loading: true, error: null };
        case 'FETCH_SUCCESS':
            return { items: action.items, loading: false, error: null };
        case 'FETCH_ERROR':
            return { ...state, loading: false, error: action.error };
        case 'SET_ITEMS':
            return { ...state, items: action.items };
        case 'MUTATION_ERROR':
            return { ...state, error: action.error };
        default:
            return state;
    }
}

/**
 * Holds the user's wishlist.
 *
 * A provider of its own rather than more fields on `ListsProvider`, for the same reason the server
 * has a separate service and controller: the wishlist shares nothing with the status lists but the
 * game id. Folding it in would have meant one context whose name described half of what it held,
 * and a pending-mutation set shared between two independent axes — so a status change in flight
 * would have blocked a wishlist click on the same game for no reason.
 *
 * The state is a reducer rather than four `useState` calls because the fetch effect has to set
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

    const startPending = (gameId: number) => setPendingIds(prev => new Set(prev).add(gameId));
    const endPending = (gameId: number) =>
        setPendingIds(prev => { const next = new Set(prev); next.delete(gameId); return next; });

    const add = async (game: GameDto): Promise<void> => {
        if (pendingIds.has(game.id) || state.items.some(item => item.game.id === game.id)) return;
        startPending(game.id);

        const previous = state.items;
        // Newest first, matching the server's order, so the optimistic row lands where the real
        // one will after the next load.
        dispatch({
            type: 'SET_ITEMS',
            items: [{ game, addedAt: new Date().toISOString() }, ...previous],
        });

        try {
            const res = await fetch(`/api/wishlist/${game.id}`, {
                method: 'PUT',
                credentials: 'include',
            });

            if (!res.ok) {
                dispatch({ type: 'SET_ITEMS', items: previous });
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to update your wishlist. Please try again.' });
            }
        } catch {
            dispatch({ type: 'SET_ITEMS', items: previous });
            dispatch({ type: 'MUTATION_ERROR', error: 'Failed to update your wishlist. Please try again.' });
        } finally {
            endPending(game.id);
        }
    };

    const remove = async (gameId: number): Promise<void> => {
        if (pendingIds.has(gameId)) return;
        startPending(gameId);

        const previous = state.items;
        dispatch({ type: 'SET_ITEMS', items: previous.filter(item => item.game.id !== gameId) });

        try {
            const res = await fetch(`/api/wishlist/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            // 404 means it was not on the wishlist, which is the state the caller asked for.
            if (!res.ok && res.status !== 404) {
                dispatch({ type: 'SET_ITEMS', items: previous });
                dispatch({ type: 'MUTATION_ERROR', error: 'Failed to update your wishlist. Please try again.' });
            }
        } catch {
            dispatch({ type: 'SET_ITEMS', items: previous });
            dispatch({ type: 'MUTATION_ERROR', error: 'Failed to update your wishlist. Please try again.' });
        } finally {
            endPending(gameId);
        }
    };

    const isWishlisted = (gameId: number): boolean =>
        state.items.some(item => item.game.id === gameId);

    const isPending = (gameId: number): boolean => pendingIds.has(gameId);

    return (
        <WishlistContext.Provider value={{
            items: state.items,
            loading: state.loading,
            error: state.error,
            isWishlisted,
            isPending,
            add,
            remove,
        }}>
            {children}
        </WishlistContext.Provider>
    );
}
