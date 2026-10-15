import { createContext } from 'react';
import type { GameDto } from '@/types/game';
import type { FavouriteDto } from '@/types/favourite';

export interface FavouritesContextValue {
    /**
     * In the showcase's order, which is the order the server returns: those the user placed by hand
     * first, then the rest most recent first. See `docs/decisions/0064-*`.
     */
    items: FavouriteDto[];
    loading: boolean;
    /**
     * Set only when the fetch fails, because that is the case where there is nothing trustworthy
     * to show. Kept apart from `mutationError` so a failed toggle cannot hide favourites that
     * loaded perfectly well.
     */
    error: string | null;
    /**
     * Set when an add, a remove or a move fails, or a move is refused. Shown alongside the items, and
     * cleared by the next success.
     */
    mutationError: string | null;

    isFavourite: (gameId: number) => boolean;
    /**
     * True while this game has a favourite mutation in flight, and whenever membership is unknown —
     * during the first load, and after a load that failed. See `isPending` on the wishlist context,
     * whose reasoning this shares along with its implementation.
     *
     * Independent of the wishlist and the lists: a mutation on either does not disable this.
     */
    isPending: (gameId: number) => boolean;

    /**
     * Idempotent: making a favourite of a game that already is one changes nothing, including its
     * position. Returns whether the favourites now hold what the caller asked for.
     */
    add: (game: GameDto) => Promise<boolean>;
    /** Stops the game being a favourite and touches nothing else. */
    remove: (gameId: number) => Promise<boolean>;
    /**
     * Moves a favourite in the showcase's hand order to sit right after `afterGameId`, or first when
     * that is null — optimistically, under the per-game lock of every favourite it writes, and undone
     * if the save fails. False when it failed, or was refused because a favourite it would write is
     * still saving. The backlog's move, on this axis: see `moveInOrder` on the lists context.
     */
    moveInOrder: (gameId: number, afterGameId: number | null) => Promise<boolean>;

    /** Retries the fetch. The way out of a load failure without reloading the page. */
    reload: () => void;
}

export const FavouritesContext = createContext<FavouritesContextValue | null>(null);
