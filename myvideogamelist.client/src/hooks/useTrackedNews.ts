import { useCallback, useEffect, useReducer, useState } from 'react';
import type { NewsItemDto } from '@/types/news';

export interface UseTrackedNewsResult {
    /** Null until the first answer, and after a failure. An empty list is an answer. */
    news: NewsItemDto[] | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

/**
 * What the hook holds, with the account it belongs to beside it — the shape `useUserStats` uses, and
 * for its reason: every action a request raises names the account it was started for, and the
 * reducer drops one that arrives after that account has been replaced.
 */
export interface TrackedNewsState {
    account: string | null;
    news: NewsItemDto[] | null;
    loading: boolean;
    error: string | null;
}

export type TrackedNewsAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; account: string }
    | { type: 'FETCH_SUCCESS'; account: string; news: NewsItemDto[] }
    | { type: 'FETCH_ERROR'; account: string; error: string };

/** Nothing on screen, and a request in flight only if somebody is signed in. */
function initial(account: string | null): TrackedNewsState {
    return { account, news: null, loading: account !== null, error: null };
}

/** Drops an action that was raised against an account other than the one on screen. */
function ifCurrent(
    state: TrackedNewsState,
    account: string,
    next: () => TrackedNewsState,
): TrackedNewsState {
    return account === state.account ? next() : state;
}

/**
 * Exported so the stamps can be pinned directly — see `userStatsReducer` for why a component test
 * cannot reach the frame they guard.
 */
export function trackedNewsReducer(state: TrackedNewsState, action: TrackedNewsAction): TrackedNewsState {
    switch (action.type) {
        case 'RESET':
            return initial(null);
        case 'FETCH_START':
            // Cleared on the transition rather than when the new fetch lands, so a slow or failing
            // load cannot leave one account's news under the next account's name. The same account
            // asking again is a retry, and keeps what it has.
            return action.account === state.account
                ? { ...state, loading: true, error: null }
                : initial(action.account);
        case 'FETCH_SUCCESS':
            return ifCurrent(state, action.account, () =>
                ({ ...state, loading: false, error: null, news: action.news }));
        case 'FETCH_ERROR':
            return ifCurrent(state, action.account, () =>
                ({ ...state, loading: false, error: action.error }));
    }
}

/**
 * Steam news for the games the signed-in user tracks, for the `/news` page (ROADMAP N6).
 *
 * Fetched on the client rather than in a loader: the page is one person's, never indexed, and
 * `private, no-store`, so a server render would earn nothing and be refetched on every navigation.
 *
 * @param accountId
 * Whose news this is, or null when nobody is signed in. **Required, and it is the account-change
 * guard**, with all three parts of the shape ADR 0022 settled on: the account in reducer state beside
 * the news, the transition applied during render, and every completion stamped and dropped on a
 * mismatch. The page stays mounted across a sign-out and a sign-in, and which games the news is
 * about says a good deal about whose it is.
 */
export function useTrackedNews(accountId: string | null): UseTrackedNewsResult {
    const [state, dispatch] = useReducer(trackedNewsReducer, accountId, initial);
    const [reloadToken, setReloadToken] = useState(0);

    // Idempotent: React re-renders immediately, the account then matches, and nothing loops.
    if (state.account !== accountId) {
        dispatch(accountId === null ? { type: 'RESET' } : { type: 'FETCH_START', account: accountId });
    }

    useEffect(() => {
        if (accountId === null) return;

        const controller = new AbortController();
        const account = accountId;
        dispatch({ type: 'FETCH_START', account });

        fetch('/api/user/news', { credentials: 'include', signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error(`Failed to load news for your games (${response.status})`);
                return response.json() as Promise<NewsItemDto[]>;
            })
            .then(news => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', account, news });
            })
            .catch(err => {
                // A rejection is the unreachable-API case, which `!response.ok` never reports.
                if (controller.signal.aborted) return;
                dispatch({
                    type: 'FETCH_ERROR',
                    account,
                    error: err instanceof Error ? err.message : 'Failed to load news for your games.',
                });
            });

        return () => controller.abort();
    }, [reloadToken, accountId]);

    const reload = useCallback(() => setReloadToken(token => token + 1), []);

    return { news: state.news, loading: state.loading, error: state.error, reload };
}
