import type { GameDto } from '@/types/game';

/**
 * One of the user's favourite games, when they made it one, and where they put it in their showcase,
 * mirroring `FavouriteDto`.
 *
 * Not a `WishlistItemDto`, although the two began with the same fields: favourites are an axis of
 * their own, and a game can be a favourite, on the wishlist and in any status list at once.
 * See `docs/decisions/0029-*`.
 */
export interface FavouriteDto {
    game: GameDto;
    addedAt: string;
    /**
     * Where the owner put the game by hand — a sparse number from `@/lib/handOrder`, not an index — or
     * null when they never placed it (`docs/decisions/0064-*`). The server sends it for every favourite;
     * it is optional here because a favourite this client has just made has none until the favourites
     * are next loaded, which reads the same as null.
     */
    position?: number | null;
}
