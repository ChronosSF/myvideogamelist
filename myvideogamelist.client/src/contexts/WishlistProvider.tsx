import { useEffect, useReducer, useState, type ReactNode } from 'react';
import type { GameDto } from '@/types/game';
import type { WishlistItemDto } from '@/types/wishlist';
import { useAuth } from '@/hooks/useAuth';
import { WishlistContext } from './WishlistContext';

interface WishlistState {
    items: WishlistItemDto[];
    loading: boolean;
    /** Fetch failure only — the page has nothing trustworthy to show. */
    error: string | null;
    /** Add or remove failure — shown next to the items, not instead of them. */
    mutationError: string | null;
    /**
     * Whose wishlist these items are, as the user id, or null when nobody is signed in.
     *
     * It lives here rather than in a ref so that the check and the data it protects move together.
     * A mutation can still be in flight when one account signs out and another signs in; its
     * rollback closes over the row captured from the first account, and every action that would
     * write it carries the session it was captured under. A ref cannot do this job: written from
     * an effect it lags the commit, leaving a window where the new account is on screen while the
     * marker still names the old one, and written during render it can be moved by a render React
     * then throws away.
     *
     * Only local state was ever at risk: a request already carries whichever cookie was current
     * when it was sent, so nothing crosses accounts on the server.
     */
    session: string | null;
}

type WishlistAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; session: string | null }
    | { type: 'FETCH_SUCCESS'; items: WishlistItemDto[] }
    | { type: 'FETCH_ERROR'; error: string }
    | { type: 'PREPEND_ITEM'; session: string | null; item: WishlistItemDto }
    | { type: 'RESTORE_ITEM'; session: string | null; item: WishlistItemDto }
    | { type: 'DROP_ITEM'; session: string | null; gameId: number }
    | { type: 'MUTATION_ERROR'; session: string | null; error: string }
    | { type: 'CLEAR_MUTATION_ERROR' };

const initialState: WishlistState = {
    items: [],
    loading: false,
    error: null,
    mutationError: null,
    session: null,
};

function has(items: WishlistItemDto[], gameId: number): boolean {
    return items.some(item => item.game.id === gameId);
}

/** Drops an action that was raised against an account other than the one on screen. */
function ifCurrent(
    state: WishlistState,
    session: string | null,
    next: () => WishlistState,
): WishlistState {
    return session === state.session ? next() : state;
}

function reducer(state: WishlistState, action: WishlistAction): WishlistState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'FETCH_START':
            // A different account means none of the current state belongs to it. Cleared here
            // rather than waiting for the fetch to land, because a fetch that *fails* would
            // otherwise leave the previous account's wishlist on screen under the new account's
            // error message.
            return action.session === state.session
                ? { ...state, loading: true, error: null }
                : { ...initialState, session: action.session, loading: true };
        case 'FETCH_SUCCESS':
            return { ...state, items: action.items, loading: false, error: null, mutationError: null };
        case 'FETCH_ERROR':
            return { ...state, loading: false, error: action.error };

        // A newly wanted game goes to the front because it *is* the newest, and saying so beats
        // sorting on a timestamp this client invented: a browser clock running behind the server
        // would otherwise file a brand-new item below older ones until the next load.
        case 'PREPEND_ITEM':
            return ifCurrent(state, action.session, () =>
                has(state.items, action.item.game.id)
                    ? state
                    : { ...state, items: [action.item, ...state.items] });

        // A restore is the opposite case: the row has a server timestamp and a place it came
        // from, so it is sorted back into it rather than pushed to the front.
        case 'RESTORE_ITEM':
            return ifCurrent(state, action.session, () =>
                has(state.items, action.item.game.id)
                    ? state
                    : {
                        ...state,
                        items: [...state.items, action.item]
                            .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)),
                    });

        // Both of the above and this one work off whatever the current state is, rather than
        // restoring a snapshot taken before the request. Mutations for different games run
        // concurrently by design, so replacing the whole list on rollback would undo whichever
        // of them happened to succeed in the meantime.
        case 'DROP_ITEM':
            return ifCurrent(state, action.session, () => ({
                ...state,
                items: state.items.filter(item => item.game.id !== action.gameId),
            }));

        case 'MUTATION_ERROR':
            return ifCurrent(state, action.session, () => ({ ...state, mutationError: action.error }));
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
    const [reloadToken, setReloadToken] = useState(0);

    /**
     * The account every mutation below stamps its actions with — see `WishlistState.session` for
     * what that protects against. Read from this render, never from a ref at completion time.
     */
    const session = user?.id ?? null;

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            dispatch({ type: 'RESET' });
            return;
        }

        const controller = new AbortController();
        dispatch({ type: 'FETCH_START', session: user.id });

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
    }, [user, authLoading, reloadToken]);

    const reload = () => setReloadToken(token => token + 1);

    /**
     * Membership is unknown both while the first fetch runs and after one that failed, and in
     * neither case may anything be toggled: during the fetch a successful write would be
     * overwritten by the older response, and after a failure every game reads as "not
     * wishlisted" when the truth is that nothing is known.
     */
    const isPending = (gameId: number): boolean =>
        state.loading || state.error !== null || pendingIds.has(gameId);

    const startPending = (gameId: number) => setPendingIds(prev => new Set(prev).add(gameId));
    const endPending = (gameId: number) =>
        setPendingIds(prev => { const next = new Set(prev); next.delete(gameId); return next; });

    const add = async (game: GameDto): Promise<boolean> => {
        if (isPending(game.id)) return false;
        // Already there, so the caller already has what it asked for.
        if (has(state.items, game.id)) return true;

        startPending(game.id);
        dispatch({ type: 'PREPEND_ITEM', session, item: { game, addedAt: new Date().toISOString() } });

        try {
            const res = await fetch(`/api/wishlist/${game.id}`, {
                method: 'PUT',
                credentials: 'include',
            });

            if (res.ok) {
                dispatch({ type: 'CLEAR_MUTATION_ERROR' });
                return true;
            }
            dispatch({ type: 'DROP_ITEM', session, gameId: game.id });
            dispatch({ type: 'MUTATION_ERROR', session, error: MUTATION_FAILED });
            return false;
        } catch {
            dispatch({ type: 'DROP_ITEM', session, gameId: game.id });
            dispatch({ type: 'MUTATION_ERROR', session, error: MUTATION_FAILED });
            return false;
        } finally {
            endPending(game.id);
        }
    };

    const remove = async (gameId: number): Promise<boolean> => {
        if (isPending(gameId)) return false;

        startPending(gameId);

        // Only the one row is remembered, so putting it back cannot disturb anything else. Its
        // AddedAt is what returns it to its original position rather than the top of the list.
        const removed = state.items.find(item => item.game.id === gameId);
        dispatch({ type: 'DROP_ITEM', session, gameId });

        try {
            const res = await fetch(`/api/wishlist/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            // 404 means it was not on the wishlist, which is the state the caller asked for.
            if (res.ok || res.status === 404) {
                dispatch({ type: 'CLEAR_MUTATION_ERROR' });
                return true;
            }
            if (removed) dispatch({ type: 'RESTORE_ITEM', session, item: removed });
            dispatch({ type: 'MUTATION_ERROR', session, error: MUTATION_FAILED });
            return false;
        } catch {
            if (removed) dispatch({ type: 'RESTORE_ITEM', session, item: removed });
            dispatch({ type: 'MUTATION_ERROR', session, error: MUTATION_FAILED });
            return false;
        } finally {
            endPending(gameId);
        }
    };

    const isWishlisted = (gameId: number): boolean => has(state.items, gameId);

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
            reload,
        }}>
            {children}
        </WishlistContext.Provider>
    );
}
