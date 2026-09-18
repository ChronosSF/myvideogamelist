import type { GameDto } from '@/types/game';

/**
 * One of the user's favourite games and when they made it one, mirroring `FavouriteDto`.
 *
 * The same fields as a `WishlistItemDto` and deliberately a different name: favourites are an axis
 * of their own, and a game can be a favourite, on the wishlist and in any status list at once.
 * See `docs/decisions/0029-*`.
 */
export interface FavouriteDto {
    game: GameDto;
    addedAt: string;
}
