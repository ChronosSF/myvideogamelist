import { useEffect, useReducer } from 'react';
import type { CommunityTimes } from '@/types/playthrough';

/**
 * What the hook holds, with the game it belongs to beside it.
 *
 * The game is a field of the state rather than a ref, and every completion names the game it was
 * fetched for, so the reducer can drop one that arrives after that game has been replaced. See
 * {@link useCommunityTimes} for why the `AbortController` is not enough on its own.
 */
export interface CommunityTimesState {
    gameId: number;
    /** Null while loading, and when the request failed. */
    times: CommunityTimes | null;
}

export type CommunityTimesAction =
    | { type: 'RESET'; gameId: number }
    | { type: 'SETTLED'; gameId: number; times: CommunityTimes | null };

function initial(gameId: number): CommunityTimesState {
    return { gameId, times: null };
}

/**
 * Exported so the stamp can be pinned directly: the frame it guards is one no component test can
 * reach under jsdom, where `act` flushes render, commit and passive effects together and so always
 * aborts the request before a stale answer can land.
 */
export function communityTimesReducer(
    state: CommunityTimesState,
    action: CommunityTimesAction,
): CommunityTimesState {
    switch (action.type) {
        case 'RESET':
            return initial(action.gameId);
        case 'SETTLED':
            // Stamped, and not only because the request is aborted when the game changes: the abort
            // runs in the effect cleanup, after the commit. An answer resolving in between would
            // otherwise land under the title of the game that has already replaced the one it was
            // fetched for, and stay there until that game's own request settles.
            return action.gameId === state.gameId ? { ...state, times: action.times } : state;
    }
}

/**
 * How long MVGL members report a game taking, fetched on the client after hydration.
 *
 * Deliberately not in the route loader. The game page is edge-cached for an hour
 * (`docs/decisions/0013-*`), and the person most likely to look at this row is the one who has
 * just logged a playthrough of their own — serving them an hour-old figure of their own data
 * would read as the write having failed. Fetching it here also keeps a public page's
 * time-to-first-byte off a query that crawlers do not need, exactly as `GameNewsPanel` does for
 * Steam.
 *
 * Returns null on failure and says nothing about it. A community row that did not load is not
 * worth an error banner on a page that rendered perfectly well; the row simply is not there.
 *
 * @param gameId
 * The game on screen, and the guard. The game page stays mounted when a link goes straight from one
 * game to another, as "Similar games" does, so this takes the shape ADR 0022 settled on for
 * account-scoped state: the game lives in reducer state beside the figures fetched for it, the
 * change is applied during render, and every completion is stamped with the game it was started
 * for and dropped on a mismatch. The `AbortController` alone is not that guard — the abort runs in
 * the effect cleanup, after the commit, so an answer for the previous game can still resolve
 * before it.
 */
export function useCommunityTimes(gameId: number): CommunityTimes | null {
    const [state, dispatch] = useReducer(communityTimesReducer, gameId, initial);

    // Clear the previous game's figures when navigating straight from one game page to another.
    // Applied during render rather than in the effect, which would show the last game's medians
    // under the new title for one commit. The condition makes it idempotent: React re-renders
    // immediately, the game then matches, and nothing loops.
    if (state.gameId !== gameId) {
        dispatch({ type: 'RESET', gameId });
    }

    useEffect(() => {
        const controller = new AbortController();

        // No credentials: this is an aggregate over everybody and names nobody, so it is served
        // to signed-out visitors too. Said explicitly, because `fetch` defaults to `same-origin`,
        // which would send the sign-in cookie to our own `/api` all the same.
        fetch(`/api/games/${gameId}/community-times`, { signal: controller.signal, credentials: 'omit' })
            .then(response => (response.ok ? (response.json() as Promise<CommunityTimes>) : null))
            // Swallowed by design, and `catch` rather than only `!response.ok` because an
            // unreachable API makes `fetch` reject rather than return a bad response. An abort
            // lands here too, and is dropped below.
            .catch(() => null)
            .then(times => {
                if (!controller.signal.aborted) dispatch({ type: 'SETTLED', gameId, times });
            });

        return () => controller.abort();
    }, [gameId]);

    return state.times;
}
