import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CommunityScores, GameReview, GameReviews } from '@/types/community';

export interface UseGameCommunityResult {
    /** Whether both first requests have answered, either way. Nothing renders before this. */
    settled: boolean;
    /** Null while loading, and when the request failed. */
    scores: CommunityScores | null;
    /** Every page loaded so far, in order. */
    reviews: GameReview[];
    /** Null while loading, and when the first page failed — which is not the same as there being none. */
    total: number | null;
    hasMore: boolean;
    loadingMore: boolean;
    /** The last "show more" failed. Cleared by the next attempt. */
    moreFailed: boolean;
    loadMore: () => void;
    /**
     * Asks for both halves again. For after the reader has changed something they show — their score,
     * their review, or everything they had recorded about the game — so the page reflects the write
     * rather than reading as though it had failed.
     */
    reload: () => void;
}

/**
 * What the hook holds, with the game it belongs to beside it.
 *
 * The game is a field of the state rather than a ref, and every action a request raises names the
 * game it was started for, so the reducer can drop one that arrives after that game has been
 * replaced. See {@link useGameCommunity} for why the `AbortController` is not enough on its own.
 */
export interface GameCommunityState {
    gameId: number;
    settled: boolean;
    scores: CommunityScores | null;
    reviews: GameReview[];
    total: number | null;
    /** The cursor for the page after the last one loaded, or null when there is none. */
    next: string | null;
    loadingMore: boolean;
    moreFailed: boolean;
}

export type GameCommunityAction =
    | { type: 'RESET'; gameId: number }
    | { type: 'SETTLED'; gameId: number; scores: CommunityScores | null; reviews: GameReviews | null }
    | { type: 'MORE_START'; gameId: number }
    | { type: 'MORE_SUCCESS'; gameId: number; after: string; reviews: GameReviews }
    | { type: 'MORE_ERROR'; gameId: number; after: string };

function initial(gameId: number): GameCommunityState {
    return {
        gameId,
        settled: false,
        scores: null,
        reviews: [],
        total: null,
        next: null,
        loadingMore: false,
        moreFailed: false,
    };
}

/**
 * Exported so the stamps can be pinned directly: the frames they guard are ones no component test
 * can reach under jsdom, where `act` flushes render, commit and passive effects together and so
 * always aborts a request before a stale answer can land.
 */
export function gameCommunityReducer(
    state: GameCommunityState,
    action: GameCommunityAction,
): GameCommunityState {
    if (action.type === 'RESET') return initial(action.gameId);

    // Stamped, and not only because the requests are aborted when the game changes: the abort runs
    // in the effect cleanup, after the commit. A response resolving in between would otherwise
    // land under the title of the game that has already replaced the one it was fetched for.
    if (action.gameId !== state.gameId) return state;

    switch (action.type) {
        case 'SETTLED': {
            // A second answer for the game on screen is a reload. A half that fails then keeps what
            // the reader was already looking at: it was right a moment ago, and blanking a section
            // they have just changed something in would read as the change having wiped it.
            const reload = state.settled;
            const reviews = action.reviews === null
                ? (reload ? {} : { reviews: [], total: null, next: null })
                : { reviews: action.reviews.reviews, total: action.reviews.total, next: action.reviews.next };

            return {
                ...state,
                ...reviews,
                settled: true,
                scores: action.scores ?? (reload ? state.scores : null),
                // A reload cancels any "show more" still in flight, so nothing else would clear these.
                loadingMore: false,
                moreFailed: false,
            };
        }
        case 'MORE_START':
            return { ...state, loadingMore: true, moreFailed: false };
        // Stamped with the cursor they continue from, as well as with the game. A page asked for
        // before a reload continues a list the reload has since replaced, and appending it would put
        // reviews after the wrong one; a second click's page would repeat the first's. Either way the
        // list no longer ends where the request began, so the answer belongs to nothing on screen.
        case 'MORE_SUCCESS':
            return action.after !== state.next ? state : {
                ...state,
                loadingMore: false,
                reviews: [...state.reviews, ...action.reviews.reviews],
                total: action.reviews.total,
                next: action.reviews.next,
            };
        case 'MORE_ERROR':
            return action.after !== state.next ? state : { ...state, loadingMore: false, moreFailed: true };
    }
}

/** A JSON body, or null for anything else — a bad status and an unreachable API alike. */
async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
    try {
        // `omit`, not merely unset: `fetch` defaults to `same-origin`, which sends the sign-in cookie
        // to our own `/api`. Both endpoints answer every reader identically, so there is nothing for
        // a cookie to do — and a request that carries none cannot come to depend on one.
        const response = await fetch(url, { signal, credentials: 'omit' });
        return response.ok ? ((await response.json()) as T) : null;
    } catch {
        // `catch` as well as `ok`, because an unreachable API makes `fetch` reject rather than
        // return a bad response. An abort lands here too, and the callers check for it.
        return null;
    }
}

/**
 * What MyVideoGameList members make of a game: everybody's scores, and the reviews they have
 * published. Fetched on the client, after hydration, and never in the route loader.
 *
 * Three reasons, the first of which decides it (`docs/decisions/0028-*`):
 *
 * - **A withdrawn review has to disappear when it is withdrawn.** The game page is edge-cached for
 *   an hour and servable stale for a day (`docs/decisions/0013-*`), so review text rendered into it
 *   would outlive its author making it private, deleting it, or making their profile private, by up
 *   to a day. The endpoints behind this say `no-store` instead.
 * - The member most likely to look is the one who has just scored or reviewed the game, and an
 *   hour-old page would read as their write having failed. `reload` carries that through to the
 *   page they are already on.
 * - The text is already indexable where it belongs — on its author's profile, which renders it on
 *   the server — so rendering it here as well would add a duplicate, not a page.
 *
 * Both requests are made together and land together, so the section appears once rather than
 * growing twice. Either can fail alone; a failure is reported by a null and never by an error
 * banner, for the reason `useCommunityTimes` gives.
 *
 * Further pages follow the cursor each page ends with, never a page number: a review withdrawn or
 * rewritten while somebody reads moves every offset after it, and an offset then skips a review for
 * good. A reload starts again from the first page.
 *
 * @param gameId
 * The game on screen, and the guard. The game page stays mounted when a link goes from one game to
 * another, so this takes the shape ADR 0022 settled on for account-scoped state: the game lives in
 * reducer state beside what was fetched for it, the change is applied during render, and every
 * completion is stamped with the game it was started for and dropped on a mismatch.
 */
export function useGameCommunity(gameId: number): UseGameCommunityResult {
    const [state, dispatch] = useReducer(gameCommunityReducer, gameId, initial);
    const [reloads, setReloads] = useState(0);

    // The condition makes this idempotent: React re-renders immediately, the game then matches, and
    // nothing loops.
    if (state.gameId !== gameId) {
        dispatch({ type: 'RESET', gameId });
    }

    // Whatever is in flight for the game on screen, so a "show more" started by a click is
    // cancelled by the same navigation, or reload, that cancels the first load. Written in the
    // effect and read in a handler, never during render.
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        controllerRef.current = controller;

        void Promise.all([
            getJson<CommunityScores>(`/api/games/${gameId}/community-scores`, controller.signal),
            getJson<GameReviews>(`/api/games/${gameId}/reviews`, controller.signal),
        ]).then(([scores, reviews]) => {
            if (!controller.signal.aborted) dispatch({ type: 'SETTLED', gameId, scores, reviews });
        });

        return () => controller.abort();
        // `reloads` only ever changes to ask for this again. The section keeps what it shows until
        // the new answer lands, so a reload never flashes it empty.
    }, [gameId, reloads]);

    const loadMore = useCallback(() => {
        const controller = controllerRef.current;
        const after = state.next;
        if (controller === null || after === null || state.loadingMore) return;

        dispatch({ type: 'MORE_START', gameId });

        void getJson<GameReviews>(
            `/api/games/${gameId}/reviews?after=${encodeURIComponent(after)}`,
            controller.signal,
        ).then(reviews => {
            if (controller.signal.aborted) return;
            dispatch(reviews === null
                ? { type: 'MORE_ERROR', gameId, after }
                : { type: 'MORE_SUCCESS', gameId, after, reviews });
        });
    }, [gameId, state.next, state.loadingMore]);

    const reload = useCallback(() => setReloads(count => count + 1), []);

    return {
        settled: state.settled,
        scores: state.scores,
        reviews: state.reviews,
        total: state.total,
        hasMore: state.next !== null,
        loadingMore: state.loadingMore,
        moreFailed: state.moreFailed,
        loadMore,
        reload,
    };
}
