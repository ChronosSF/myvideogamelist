import type { ReactNode } from 'react';
import { type GameAxisOptions, useGameAxis } from '@/hooks/useGameAxis';
import { WishlistContext } from './WishlistContext';

/** Module-level, so the fetch effect sees the same object on every render. */
const WISHLIST: GameAxisOptions = {
    endpoint: '/api/wishlist',
    loadFailed: status => `Failed to load your wishlist (${status})`,
    loadUnreachable: 'Failed to load your wishlist.',
    mutationFailed: 'Failed to update your wishlist. Please try again.',
};

/**
 * Holds the user's wishlist.
 *
 * A provider of its own rather than more fields on `ListsProvider`, for the same reason the server
 * has a separate service and controller: the wishlist shares nothing with the status lists but the
 * game id. Folding it in would have meant one context whose name described half of what it held,
 * and a pending-mutation set shared between two independent axes — so a status change in flight
 * would have blocked a wishlist click on the same game for no reason.
 *
 * The state itself — the session stamps, the per-game lock, the surgical rollback — lives in
 * `useGameAxis`, which the favourites share. This provider's pending set is still its own: a
 * favourite toggle in flight does not disable the wishlist one.
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
    const axis = useGameAxis(WISHLIST);

    return (
        <WishlistContext.Provider value={{
            items: axis.items,
            loading: axis.loading,
            error: axis.error,
            mutationError: axis.mutationError,
            isWishlisted: axis.has,
            isPending: axis.isPending,
            add: axis.add,
            remove: axis.remove,
            reload: axis.reload,
        }}>
            {children}
        </WishlistContext.Provider>
    );
}
