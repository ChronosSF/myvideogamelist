import { createContext } from 'react';
import type { GameDto } from '@/types/game';
import type { WishlistItemDto } from '@/types/wishlist';

export interface WishlistContextValue {
    /** Most recently wanted first, which is the order the server returns. */
    items: WishlistItemDto[];
    loading: boolean;
    /**
     * Set only when the initial fetch fails, because that is the case where there is nothing
     * trustworthy to show. Kept apart from `mutationError` so a failed toggle cannot hide a
     * wishlist that loaded perfectly well.
     */
    error: string | null;
    /** Set when an add or remove fails. Shown alongside the items, and cleared by the next success. */
    mutationError: string | null;

    isWishlisted: (gameId: number) => boolean;
    /**
     * True while this game has a wishlist mutation in flight, and while the initial load is still
     * running — membership is unknown until it lands, so offering the toggle would let a
     * successful write be overwritten by the older response. Independent of list mutations.
     */
    isPending: (gameId: number) => boolean;

    /** Idempotent: wishlisting an already-wishlisted game changes nothing, including its position. */
    add: (game: GameDto) => Promise<void>;
    /** Takes the game off the wishlist and touches nothing else — its status and score are untouched. */
    remove: (gameId: number) => Promise<void>;
}

export const WishlistContext = createContext<WishlistContextValue | null>(null);
