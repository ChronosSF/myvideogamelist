import { useCallback, useEffect, useReducer, useRef } from 'react';
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
    /** The last page loaded, and the size the server pages by. Both zero until the first answers. */
    page: number;
    pageSize: number;
    loadingMore: boolean;
    moreFailed: boolean;
}

export type GameCommunityAction =
    | { type: 'RESET'; gameId: number }
    | { type: 'SETTLED'; gameId: number; scores: CommunityScores | null; reviews: GameReviews | null }
    | { type: 'MORE_START'; gameId: number }
    | { type: 'MORE_SUCCESS'; gameId: number; reviews: GameReviews }
    | { type: 'MORE_ERROR'; gameId: number };

function initial(gameId: number): GameCommunityState {
    return {
        gameId,
        settled: false,
        scores: null,
        reviews: [],
        total: null,
        page: 0,
        pageSize: 0,
        loadingMore: false,
        moreFailed: false,
    };
}

/**
 * Exported so the stamp can be pinned directly: the frame it guards is one no component test can
 * reach under jsdom, where `act` flushes render, commit and passive effects together and so always
 * aborts the request before a stale answer can land.
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
        case 'SETTLED':
            return {
                ...state,
                settled: true,
                scores: action.scores,
                reviews: action.reviews?.reviews ?? [],
                total: action.reviews?.total ?? null,
                page: action.reviews?.page ?? 0,
                pageSize: action.reviews?.pageSize ?? 0,
            };
        case 'MORE_START':
            return { ...state, loadingMore: true, moreFailed: false };
        case 'MORE_SUCCESS': {
            // Pages are offsets into a list that can move while somebody reads it: a review
            // rewritten meanwhile jumps to the top and pushes the rest down a place, so the next
            // page can open with the review that closed this one. One review per member per game
            // makes the author's name a key for the list, so a repeat is dropped rather than shown
            // twice.
            const shown = new Set(state.reviews.map(review => review.userName));
            return {
                ...state,
                loadingMore: false,
                reviews: [
                    ...state.reviews,
                    ...action.reviews.reviews.filter(review => !shown.has(review.userName)),
                ],
                total: action.reviews.total,
                page: action.reviews.page,
                pageSize: action.reviews.pageSize,
            };
        }
        case 'MORE_ERROR':
            return { ...state, loadingMore: false, moreFailed: true };
    }
}

/** A JSON body, or null for anything else — a bad status and an unreachable API alike. */
async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
    try {
        const response = await fetch(url, { signal });
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
 *   hour-old page would read as their write having failed.
 * - The text is already indexable where it belongs — on its author's profile, which renders it on
 *   the server — so rendering it here as well would add a duplicate, not a page.
 *
 * Both requests are made together and land together, so the section appears once rather than
 * growing twice. Either can fail alone; a failure is reported by a null and never by an error
 * banner, for the reason `useCommunityTimes` gives.
 *
 * @param gameId
 * The game on screen, and the guard. The game page stays mounted when a link goes from one game to
 * another, so this takes the shape ADR 0022 settled on for account-scoped state: the game lives in
 * reducer state beside what was fetched for it, the change is applied during render, and every
 * completion is stamped with the game it was started for and dropped on a mismatch.
 */
export function useGameCommunity(gameId: number): UseGameCommunityResult {
    const [state, dispatch] = useReducer(gameCommunityReducer, gameId, initial);

    // The condition makes this idempotent: React re-renders immediately, the game then matches, and
    // nothing loops.
    if (state.gameId !== gameId) {
        dispatch({ type: 'RESET', gameId });
    }

    // Whatever is in flight for the game on screen, so a "show more" started by a click is
    // cancelled by the same navigation that cancels the first load. Written in the effect and read
    // in a handler, never during render.
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        controllerRef.current = controller;

        // No credentials: both halves are the same for every reader, signed in or not.
        void Promise.all([
            getJson<CommunityScores>(`/api/games/${gameId}/community-scores`, controller.signal),
            getJson<GameReviews>(`/api/games/${gameId}/reviews`, controller.signal),
        ]).then(([scores, reviews]) => {
            if (!controller.signal.aborted) dispatch({ type: 'SETTLED', gameId, scores, reviews });
        });

        return () => controller.abort();
    }, [gameId]);

    // By pages rather than by reviews shown, because a repeat dropped above would otherwise leave
    // the count short of the total for good and keep offering a page that adds nothing.
    const hasMore = state.total !== null && state.page * state.pageSize < state.total;

    const loadMore = useCallback(() => {
        const controller = controllerRef.current;
        if (controller === null || state.loadingMore || !hasMore) return;

        dispatch({ type: 'MORE_START', gameId });

        void getJson<GameReviews>(`/api/games/${gameId}/reviews?page=${state.page + 1}`, controller.signal)
            .then(reviews => {
                if (controller.signal.aborted) return;
                dispatch(reviews === null
                    ? { type: 'MORE_ERROR', gameId }
                    : { type: 'MORE_SUCCESS', gameId, reviews });
            });
    }, [gameId, hasMore, state.loadingMore, state.page]);

    return {
        settled: state.settled,
        scores: state.scores,
        reviews: state.reviews,
        total: state.total,
        hasMore,
        loadingMore: state.loadingMore,
        moreFailed: state.moreFailed,
        loadMore,
    };
}
