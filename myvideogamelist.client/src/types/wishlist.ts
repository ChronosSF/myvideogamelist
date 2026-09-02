import type { GameDto } from '@/types/game';

/**
 * One wishlisted game and when it was wishlisted.
 *
 * Deliberately not a `ListEntryDto`. The wishlist is a separate axis rather than a sixth status:
 * a game can sit on it *and* in any status list at once, and it carries no score and no status of
 * its own. Sharing the list DTO would mean two permanently null fields and would invite code that
 * treats the two as interchangeable.
 */
export interface WishlistItemDto {
    game: GameDto;
    addedAt: string;
}
