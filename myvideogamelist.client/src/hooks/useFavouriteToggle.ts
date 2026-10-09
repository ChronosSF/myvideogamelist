import { useState } from 'react';
import { releaseAsGame } from '@/hooks/useAddToBacklog';
import { useFavourites } from '@/hooks/useFavourites';
import type { ConnectedRelease } from '@/types/releases';

export interface FavouriteToggle {
    /** Whether to offer it: the favourites have loaded, so what the toggle shows is true. */
    canToggle: boolean;
    favourite: boolean;
    pending: boolean;
    /** This card's last change did not stick. */
    failed: boolean;
    toggle: () => void;
}

/**
 * Making a release on the calendar a favourite, or no longer one: the game page's toggle, on a card.
 *
 * Unlike Add to Backlog it is offered for every game, either way. A favourite is an axis of its own
 * (ADR 0029), so making one moves nothing — a finished game stays finished — and undoing it is as safe
 * as doing it. It waits for the favourites to load, as the Backlog button waits for the lists: until
 * then every game would read as not a favourite.
 *
 * The provider does the rest — the optimistic change, the per-game lock, the rollback — and answers
 * whether the change stuck, which is how this card knows that its own did not.
 */
export function useFavouriteToggle(release: ConnectedRelease): FavouriteToggle {
    const { loading, error, isFavourite, isPending, add, remove } = useFavourites();
    const [failed, setFailed] = useState(false);
    const favourite = isFavourite(release.gameId);

    return {
        canToggle: !loading && error === null,
        favourite,
        pending: isPending(release.gameId),
        failed,
        toggle: () => {
            setFailed(false);
            const change = favourite ? remove(release.gameId) : add(releaseAsGame(release));
            void change.then(stuck => setFailed(!stuck));
        },
    };
}
