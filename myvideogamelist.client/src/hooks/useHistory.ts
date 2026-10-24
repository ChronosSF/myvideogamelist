import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { HistoryItem, HistoryPage } from '@/types/history';

/**
 * Why "show more" failed, and what is worth doing about it.
 *
 * Two different failures. Most are worth another press. A 400 is the server refusing the cursor —
 * issued under a key ring this deployment no longer holds, after a restart that lost the keys — and
 * that one fails every time it is retried, so the reader is offered the first page again instead.
 */
export interface MoreError {
    message: string;
    /** The cursor was refused: only starting again from the first page can help. */
    restart: boolean;
}

export interface UseHistoryResult {
    /** Every page loaded so far, in order. */
    items: HistoryItem[];
    /** Games an import put in a list, whose placements have no item. Zero until a page lands. */
    importedStatuses: number;
    /** Scores with no moment, and so no item. Zero until a page lands. */
    undatedScores: number;
    /** The first page is on its way. */
    loading: boolean;
    /** The first page failed, so there is nothing trustworthy to show. */
    error: string | null;
    hasMore: boolean;
    loadingMore: boolean;
    /** The last "show more" failed. Apart from `error`, because the items above it are still good. */
    moreError: MoreError | null;
    loadMore: () => void;
    /** Starts again from the first page. */
    reload: () => void;
}

/**
 * What the hook holds, with the account it belongs to beside it — the shape ADR 0022 settled on,
 * for the reason {@link useHistory} gives.
 */
export interface HistoryState {
    account: string | null;
    items: HistoryItem[];
    /** The cursor for the page after the last one loaded, or null when there is none. */
    next: string | null;
    importedStatuses: number;
    undatedScores: number;
    loading: boolean;
    error: string | null;
    loadingMore: boolean;
    moreError: MoreError | null;
}

export type HistoryAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; account: string }
    | { type: 'FETCH_SUCCESS'; account: string; page: HistoryPage }
    | { type: 'FETCH_ERROR'; account: string; error: string }
    | { type: 'MORE_START'; account: string }
    | { type: 'MORE_SUCCESS'; account: string; after: string; page: HistoryPage }
    | { type: 'MORE_ERROR'; account: string; after: string; error: MoreError };

/** Nothing on screen, and a request in flight only if somebody is signed in. */
function initial(account: string | null): HistoryState {
    return {
        account,
        items: [],
        next: null,
        importedStatuses: 0,
        undatedScores: 0,
        loading: account !== null,
        error: null,
        loadingMore: false,
        moreError: null,
    };
}

/**
 * Exported so the stamps can be pinned directly: the frames they guard are ones no component test
 * can reach under jsdom, where `act` flushes render, commit and passive effects together and so
 * always aborts a request before a stale answer can land.
 */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
    if (action.type === 'RESET') return initial(null);

    if (action.type === 'FETCH_START') {
        // Everything goes, now, on the request rather than when its answer lands. For a different
        // account that is the guard: what is on screen belongs to nobody signed in any more, and a
        // failure would otherwise leave it under the new account's error. For the same account it
        // is what a reload means here — "Try again" and "Start again" both ask for the first page
        // afresh — so nothing from before survives to be shown under the reload's own failure, and
        // a "show more" the reload's effect has just aborted is not left loading for good.
        return initial(action.account);
    }

    // Stamped, and not only because the requests are aborted when the account changes: the abort
    // runs in the effect cleanup, after the commit. A response landing in between would otherwise
    // be written under the account that has already replaced the one it was fetched for.
    if (action.account !== state.account) return state;

    switch (action.type) {
        case 'FETCH_SUCCESS':
            return {
                ...state,
                loading: false,
                error: null,
                items: action.page.items,
                next: action.page.next,
                importedStatuses: action.page.importedStatuses,
                undatedScores: action.page.undatedScores,
            };
        case 'FETCH_ERROR':
            return { ...state, loading: false, error: action.error };
        case 'MORE_START':
            return { ...state, loadingMore: true, moreError: null };
        // Stamped with the cursor they continue from as well. A page asked for before a reload
        // continues a list the reload has since replaced, and appending it would put items after
        // the wrong one; a second press's page would repeat the first's. Either way the list no
        // longer ends where the request began, so the answer belongs to nothing on screen.
        case 'MORE_SUCCESS':
            return action.after !== state.next ? state : {
                ...state,
                loadingMore: false,
                items: [...state.items, ...action.page.items],
                next: action.page.next,
                importedStatuses: action.page.importedStatuses,
                undatedScores: action.page.undatedScores,
            };
        case 'MORE_ERROR':
            return action.after !== state.next ? state : { ...state, loadingMore: false, moreError: action.error };
    }
}

type PageResult =
    | { ok: true; page: HistoryPage }
    | { ok: false; status: number | null; message: string };

/** One page, or why not — a bad status and an unreachable API alike. */
async function fetchPage(after: string | null, signal: AbortSignal): Promise<PageResult> {
    const url = after === null
        ? '/api/user/history'
        : `/api/user/history?after=${encodeURIComponent(after)}`;

    try {
        const response = await fetch(url, { credentials: 'include', signal });
        if (response.ok) return { ok: true, page: (await response.json()) as HistoryPage };
        return { ok: false, status: response.status, message: await refusal(response) };
    } catch (err) {
        // `catch` as well as `ok`: an unreachable API makes `fetch` reject rather than return a bad
        // response. An abort lands here too, and the callers check for it first.
        return { ok: false, status: null, message: err instanceof Error ? err.message : 'Failed to load your history.' };
    }
}

/**
 * The sentence the API put beside the cursor when it refused one, or a plain one. Its
 * `ValidationProblemDetails` keys the message by the parameter, which is where it is written for a
 * person to read.
 */
async function refusal(response: Response): Promise<string> {
    const fallback = `Failed to load your history (${response.status})`;
    try {
        const body = (await response.json()) as { errors?: Record<string, string[]>; detail?: string };
        return body.errors?.after?.[0] ?? body.detail ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * The signed-in user's history, a page at a time: their status changes, scores and playthrough
 * dates as one list, newest first (`docs/decisions/0062-*`).
 *
 * Fetched here rather than in the route loader, for the reason `useUserStats` gives: the profile is
 * private and never indexed, so a server render earns nothing.
 *
 * Further pages follow the cursor each page ends with, never a page number — a move made in another
 * tab adds an item at the top, and an offset would then repeat one. A reload starts again from the
 * first page.
 *
 * @param accountId
 * Whose history this is, or null when nobody is signed in. **Required, and it is the account-change
 * guard**, in the whole of the shape ADR 0022 settled on: the account lives in reducer state beside
 * the items, the transition is applied during render, and every completion is stamped with the
 * account it was started for and dropped on a mismatch. The `AbortController` is not the guard —
 * its abort runs in the effect cleanup, after the commit.
 */
export function useHistory(accountId: string | null): UseHistoryResult {
    const [state, dispatch] = useReducer(historyReducer, accountId, initial);
    const [reloads, setReloads] = useState(0);

    // The condition makes this idempotent: React re-renders immediately, the account then matches,
    // and nothing loops.
    if (state.account !== accountId) {
        dispatch(accountId === null ? { type: 'RESET' } : { type: 'FETCH_START', account: accountId });
    }

    // Whatever is in flight for the account on screen, so a "show more" started by a press is
    // cancelled by the same sign-out, or reload, that cancels the first page. Written in the effect
    // and read in a handler, never during render.
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        // Nobody signed in, so there is nothing to ask for but a guaranteed 401.
        if (accountId === null) return;

        const controller = new AbortController();
        controllerRef.current = controller;
        const account = accountId;
        dispatch({ type: 'FETCH_START', account });

        void fetchPage(null, controller.signal).then(result => {
            if (controller.signal.aborted) return;
            dispatch(result.ok
                ? { type: 'FETCH_SUCCESS', account, page: result.page }
                : { type: 'FETCH_ERROR', account, error: result.message });
        });

        return () => controller.abort();
        // `reloads` only ever changes to ask for the first page again.
    }, [accountId, reloads]);

    const loadMore = useCallback(() => {
        const controller = controllerRef.current;
        const account = state.account;
        const after = state.next;
        if (controller === null || account === null || after === null || state.loadingMore) return;

        dispatch({ type: 'MORE_START', account });

        void fetchPage(after, controller.signal).then(result => {
            if (controller.signal.aborted) return;
            dispatch(result.ok
                ? { type: 'MORE_SUCCESS', account, after, page: result.page }
                : {
                    type: 'MORE_ERROR',
                    account,
                    after,
                    error: result.status === 400
                        ? { message: result.message, restart: true }
                        : { message: 'More of your history could not be loaded. Please try again.', restart: false },
                });
        });
    }, [state.account, state.next, state.loadingMore]);

    const reload = useCallback(() => setReloads(count => count + 1), []);

    return {
        items: state.items,
        importedStatuses: state.importedStatuses,
        undatedScores: state.undatedScores,
        loading: state.loading,
        error: state.error,
        hasMore: state.next !== null,
        loadingMore: state.loadingMore,
        moreError: state.moreError,
        loadMore,
        reload,
    };
}
