import { useState } from 'react';
import { releaseAsGame } from '@/hooks/useAddToBacklog';
import { useAuth } from '@/hooks/useAuth';
import { useFavourites } from '@/hooks/useFavourites';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import type { PlatformDto } from '@/types/game';
import type { ListId } from '@/types/list';

/** What the home page's release panels know of a game, which both Coming soon and Just out have. */
export interface ReleaseGame {
    gameId: number;
    title: string;
    coverImageUrl: string | null;
    platforms: PlatformDto[];
}

export interface ReleaseGameState {
    /** Whether somebody is signed in, which is when the wishlist toggle is offered at all. */
    signedIn: boolean;
    favourite: boolean;
    /** The reader's own name for the list the game is in, or null for none. */
    listName: string | null;
    wishlisted: boolean;
    /** While a change is out, and while the wishlist is unknown: a press then would write over what it cannot see. */
    pending: boolean;
    /** Puts the game on the wishlist, or takes it off. Has handled its own failure: fire with `void`. */
    toggleWishlist: () => Promise<void>;
    /** Whether the last change, made by the account signed in now, did not stick. */
    failed: boolean;
}

/**
 * The reader's own side of a game on one of the home page's release panels: which of their lists it is in,
 * whether it is a favourite, and the wishlist toggle that is how a game seen there reaches their own two
 * weeks when its day comes (ADR 0073). One hook for the schedule's rows and the grid's cards, so the two
 * cannot drift.
 *
 * The failure is held as the account it happened to rather than as a flag, read off the return value
 * rather than the provider's shared error, which belongs to whichever card was pressed last — as on the
 * games grid's cards. The page outlives a sign-out: a flag would go on telling the visitor, or the next
 * account, that a wishlist they never touched could not be updated.
 */
export function useReleaseGame(game: ReleaseGame): ReleaseGameState {
    const { user } = useAuth();
    const { isFavourite } = useFavourites();
    const { getListFor, nameFor } = useLists();
    const wishlist = useWishlist();
    const [failedFor, setFailedFor] = useState<string | null>(null);

    const list: ListId | null = getListFor(game.gameId);
    const wishlisted = wishlist.isWishlisted(game.gameId);

    const toggleWishlist = async () => {
        const account = user?.id ?? null;
        setFailedFor(null);
        const saved = wishlisted ? await wishlist.remove(game.gameId) : await wishlist.add(releaseAsGame(game));
        setFailedFor(saved ? null : account);
    };

    return {
        signedIn: user !== null,
        favourite: isFavourite(game.gameId),
        listName: list === null ? null : nameFor(list),
        wishlisted,
        pending: wishlist.isPending(game.gameId),
        toggleWishlist,
        failed: failedFor !== null && failedFor === user?.id,
    };
}
