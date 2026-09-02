import { createContext } from 'react';
import type { GameDto } from '@/types/game';
import type { WishlistItemDto } from '@/types/wishlist';

export interface WishlistContextValue {
    /** Most recently wanted first, which is the order the server returns. */
    items: WishlistItemDto[];
    loading: boolean;
    error: string | null;

    isWishlisted: (gameId: number) => boolean;
    /** True while this game has a wishlist mutation in flight. Independent of list mutations. */
    isPending: (gameId: number) => boolean;

    /** Idempotent: wishlisting an already-wishlisted game changes nothing, including its position. */
    add: (game: GameDto) => Promise<void>;
    /** Takes the game off the wishlist and touches nothing else — its status and score are untouched. */
    remove: (gameId: number) => Promise<void>;
}

export const WishlistContext = createContext<WishlistContextValue | null>(null);
