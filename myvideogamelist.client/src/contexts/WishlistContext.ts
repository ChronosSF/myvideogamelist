import { createContext } from 'react';
import type { GameDto } from '@/types/game';
import type { WishlistItemDto } from '@/types/wishlist';

export interface WishlistContextValue {
    /** Most recently wanted first, which is the order the server returns. */
    items: WishlistItemDto[];
    loading: boolean;
    /**
     * Set only when the fetch fails, because that is the case where there is nothing trustworthy
     * to show. Kept apart from `mutationError` so a failed toggle cannot hide a wishlist that
     * loaded perfectly well.
     */
    error: string | null;
    /** Set when an add or remove fails. Shown alongside the items, and cleared by the next success. */
    mutationError: string | null;

    isWishlisted: (gameId: number) => boolean;
    /**
     * True while this game has a wishlist mutation in flight, and whenever membership is unknown —
     * during the first load, and after a load that failed. Offering a membership toggle without
     * knowing the membership is how a successful write gets overwritten by a later response, or
     * how every game comes to read as "not wishlisted" when the truth is "we have no idea".
     *
     * Independent of list mutations: a status change in flight does not disable this.
     */
    isPending: (gameId: number) => boolean;

    /**
     * Idempotent: wishlisting an already-wishlisted game changes nothing, including its position.
     * Returns whether the wishlist now holds what the caller asked for, so a component that has
     * no error state of its own can react — see `setScore` on the lists context.
     */
    add: (game: GameDto) => Promise<boolean>;
    /** Takes the game off the wishlist and touches nothing else — its status and score are untouched. */
    remove: (gameId: number) => Promise<boolean>;

    /** Retries the fetch. The way out of a load failure without reloading the page. */
    reload: () => void;
}

export const WishlistContext = createContext<WishlistContextValue | null>(null);
