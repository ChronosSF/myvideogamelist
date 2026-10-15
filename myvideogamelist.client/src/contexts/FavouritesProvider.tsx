import type { ReactNode } from 'react';
import { type GameAxisOptions, useGameAxis } from '@/hooks/useGameAxis';
import { FavouritesContext } from './FavouritesContext';

/** Module-level, so the fetch effect sees the same object on every render. */
const FAVOURITES: GameAxisOptions = {
    endpoint: '/api/favourites',
    loadFailed: status => `Failed to load your favourites (${status})`,
    loadUnreachable: 'Failed to load your favourites.',
    mutationFailed: 'Failed to update your favourites. Please try again.',
    order: {
        endpoint: '/api/favourites/positions',
        failed: 'Failed to save the order of your favourites. Please try again.',
    },
};

/**
 * Holds the user's favourite games.
 *
 * A third axis beside the lists and the wishlist, with a provider of its own for the reason the
 * wishlist has one (ADR 0022 §5): its own pending set, so that a wishlist toggle in flight on a game
 * never disables the favourite toggle on it. The state and its guards are `useGameAxis`, shared
 * with the wishlist, so a fix to one cannot miss the other. See `docs/decisions/0029-*`.
 *
 * The one axis with an order its owner arranges, so the one that gives `useGameAxis` an `order` and
 * hands `moveInOrder` on (`docs/decisions/0064-*`).
 */
export function FavouritesProvider({ children }: { children: ReactNode }) {
    const axis = useGameAxis(FAVOURITES);

    return (
        <FavouritesContext.Provider value={{
            items: axis.items,
            loading: axis.loading,
            error: axis.error,
            mutationError: axis.mutationError,
            orderError: axis.orderError,
            isFavourite: axis.has,
            isPending: axis.isPending,
            add: axis.add,
            remove: axis.remove,
            moveInOrder: axis.moveInOrder,
            reload: axis.reload,
        }}>
            {children}
        </FavouritesContext.Provider>
    );
}
