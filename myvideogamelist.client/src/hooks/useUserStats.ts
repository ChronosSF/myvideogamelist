import { useCallback, useEffect, useReducer, useState } from 'react';
import type { UserStats } from '@/types/stats';

export interface UseUserStatsResult {
    stats: UserStats | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

/**
 * What the hook holds, with the account it belongs to beside it.
 *
 * The account is a field of the state rather than a ref, and every action a request raises names
 * the account it was started for, so the reducer can drop one that arrives after that account has
 * been replaced. See {@link useUserStats} for why the `AbortController` is not enough on its own.
 */
export interface UserStatsState {
    account: string | null;
    stats: UserStats | null;
    loading: boolean;
    error: string | null;
}

export type UserStatsAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; account: string }
    | { type: 'FETCH_SUCCESS'; account: string; stats: UserStats }
    | { type: 'FETCH_ERROR'; account: string; error: string };

/** Nothing on screen, and a request in flight only if somebody is signed in. */
function initial(account: string | null): UserStatsState {
    return { account, stats: null, loading: account !== null, error: null };
}

/** Drops an action that was raised against an account other than the one on screen. */
function ifCurrent(
    state: UserStatsState,
    account: string,
    next: () => UserStatsState,
): UserStatsState {
    return account === state.account ? next() : state;
}

/**
 * Exported so the stamp can be pinned directly: the frame it guards is one no component test can
 * reach under jsdom, where `act` flushes render, commit and passive effects together on the way
 * out and so always aborts the request before a stale answer can land.
 */
export function userStatsReducer(state: UserStatsState, action: UserStatsAction): UserStatsState {
    switch (action.type) {
        case 'RESET':
            return initial(null);
        case 'FETCH_START':
            // A different account means the figures on screen belong to nobody who is signed in
            // any more. Cleared here, on the transition, rather than when the new fetch lands: a
            // fetch that *fails* would otherwise leave the previous account's numbers up underneath
            // the new account's error message. The same account asking again is a reload, and
            // keeps what it has.
            return action.account === state.account
                ? { ...state, loading: true, error: null }
                : initial(action.account);
        // Stamped, and not only because the request is aborted on an account change: the abort
        // runs in the effect cleanup, which is one more thing that happens after the commit. A
        // response resolving in between would otherwise land on the account that has already
        // replaced the one it was fetched for.
        case 'FETCH_SUCCESS':
            return ifCurrent(state, action.account, () =>
                ({ ...state, loading: false, error: null, stats: action.stats }));
        case 'FETCH_ERROR':
            return ifCurrent(state, action.account, () =>
                ({ ...state, loading: false, error: action.error }));
    }
}

/**
 * The signed-in user's own profile statistics.
 *
 * Fetched here rather than in a route loader because the profile is private and never indexed, so
 * a server render earns nothing — and the route's `private, no-store` policy means a loader
 * response would be refetched on every navigation regardless.
 *
 * @param accountId
 * Whose figures these are, or null when nobody is signed in. **Required, and it is the
 * account-change guard.** This used to have none, on the argument that it was only ever mounted
 * inside the signed-in half of the profile route and so was unmounted by a sign-out — with a note
 * saying it would need one the day it was lifted anywhere that outlives a sign-out. The home page
 * is that day.
 *
 * The guard is the shape ADR 0022 settled on for the two list providers, and it takes all three
 * parts of it:
 *
 * - The account lives in the reducer state beside the figures it protects, never in a ref. A ref
 *   written from an effect lags the commit, and one written during render can be moved by a render
 *   React then throws away.
 * - Every completion is stamped with the account it was fetched for and dropped on a mismatch. The
 *   `AbortController` alone does not cover this: the abort runs in the effect cleanup, after the
 *   commit, so a response landing in between would be written under the new account's name.
 * - The transition is applied during render — React's documented pattern for resetting state when
 *   a prop changes, and the only one with no committed frame in which the previous account's
 *   figures sit under the new account's name.
 */
export function useUserStats(accountId: string | null): UseUserStatsResult {
    const [state, dispatch] = useReducer(userStatsReducer, accountId, initial);
    const [reloadToken, setReloadToken] = useState(0);

    // The condition makes this idempotent: React re-renders immediately, the account then matches,
    // and nothing loops.
    if (state.account !== accountId) {
        dispatch(accountId === null ? { type: 'RESET' } : { type: 'FETCH_START', account: accountId });
    }

    useEffect(() => {
        // Nobody signed in, so there is nothing to ask for. Without this the hook would spend a
        // request on a guaranteed 401 every time it mounts on a signed-out page.
        if (accountId === null) return;

        const controller = new AbortController();
        const account = accountId;
        // On the account already on screen this only raises `loading`, which is what a reload
        // needs; on a new one it is the same reset the render above has already applied.
        dispatch({ type: 'FETCH_START', account });

        fetch('/api/user/stats', { credentials: 'include', signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error(`Failed to load your stats (${response.status})`);
                return response.json() as Promise<UserStats>;
            })
            .then(data => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', account, stats: data });
            })
            .catch(err => {
                // A rejection is the unreachable-API case, which `!response.ok` never reports.
                if (controller.signal.aborted) return;
                dispatch({
                    type: 'FETCH_ERROR',
                    account,
                    error: err instanceof Error ? err.message : 'Failed to load your stats.',
                });
            });

        return () => controller.abort();
        // `accountId` is a dependency as well as the reset above: the reset clears what is on
        // screen, and this is what fetches the new account's figures. Neither alone is enough —
        // clearing without refetching leaves an empty page, and refetching without clearing leaves
        // the old numbers up until the new ones arrive.
    }, [reloadToken, accountId]);

    const reload = useCallback(() => setReloadToken(token => token + 1), []);

    return { stats: state.stats, loading: state.loading, error: state.error, reload };
}
