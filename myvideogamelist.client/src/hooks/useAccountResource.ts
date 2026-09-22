import { useCallback, useEffect, useReducer, useState } from 'react';

export interface AccountResourceState<T> {
    /**
     * The account and subject this data belongs to, as one string. Compared inside the reducer, so
     * it cannot drift from the data it guards.
     */
    identity: string | null;
    data: T | null;
    loading: boolean;
    error: string | null;
}

export type AccountResourceAction<T> =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; identity: string }
    | { type: 'FETCH_SUCCESS'; identity: string; data: T }
    | { type: 'FETCH_ERROR'; identity: string; error: string }
    | { type: 'PATCH'; identity: string; apply: (data: T) => T };

function initial<T>(identity: string | null): AccountResourceState<T> {
    return { identity, data: null, loading: identity !== null, error: null };
}

/**
 * Exported so the stamp can be pinned directly. The frame it guards is one no component test can
 * reach under jsdom, where `act` flushes render, commit and passive effects together and so always
 * aborts the request before a stale answer can land.
 */
export function accountResourceReducer<T>(
    state: AccountResourceState<T>,
    action: AccountResourceAction<T>,
): AccountResourceState<T> {
    switch (action.type) {
        case 'RESET':
            return initial<T>(null);
        case 'FETCH_START':
            // A different identity means what is on screen belongs to nobody who is looking at it
            // any more. Cleared on the transition rather than when the new fetch lands: a fetch
            // that *fails* would otherwise leave the previous data up underneath the new error.
            // The same identity asking again is a reload, and keeps what it has.
            return action.identity === state.identity
                ? { ...state, loading: true, error: null }
                : initial<T>(action.identity);
        case 'FETCH_SUCCESS':
            return action.identity === state.identity
                ? { ...state, loading: false, error: null, data: action.data }
                : state;
        case 'FETCH_ERROR':
            return action.identity === state.identity
                ? { ...state, loading: false, error: action.error }
                : state;
        case 'PATCH':
            return action.identity === state.identity && state.data !== null
                ? { ...state, data: action.apply(state.data) }
                : state;
    }
}

export interface UseAccountResourceResult<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
    /** Applies a local change, dropped if the account or subject has moved on since. */
    patch: (apply: (data: T) => T) => void;
}

/**
 * Data that belongs to one signed-in account and one subject, fetched and guarded in one place.
 *
 * This is the shape ADR 0022 settled on for the list providers, written once rather than copied.
 * That is deliberate: 0022 records the same guard being added to one provider and missed on the
 * other, twice, because review only ever reads the diff — so the lesson is not "remember the
 * pattern" but "share the code". Anything account-scoped added later should use this rather than
 * grow a fourth copy.
 *
 * All three parts of the guard are here:
 *
 * - The identity lives in the reducer state beside the data it protects, never in a ref. A ref
 *   written from an effect lags the commit; one written during render can be moved by a render
 *   React then throws away.
 * - Every completion is stamped and dropped on a mismatch. The `AbortController` is not enough on
 *   its own: the abort runs in the effect cleanup, after the commit, so a response landing in
 *   between would be written under the new identity's name.
 * - The transition is applied during render, which is the only way there is no committed frame in
 *   which one account's data sits under another's name.
 *
 * @param accountId Whose data this is, or null when nobody is signed in. Null fetches nothing.
 * @param scope What within the account is being read — a job id, say. A change resets exactly as
 * an account change does, so a second subject never renders under the first one's data.
 * @param load Must be wrapped in `useCallback`, since it is what the fetch effect depends on.
 */
export function useAccountResource<T>(
    accountId: string | null,
    scope: string,
    load: (signal: AbortSignal) => Promise<T>,
): UseAccountResourceResult<T> {
    const identity = accountId === null ? null : `${accountId}|${scope}`;

    const [state, dispatch] = useReducer(
        accountResourceReducer<T>,
        identity,
        initial<T>,
    );
    const [reloadToken, setReloadToken] = useState(0);

    // Idempotent by the condition: React re-renders immediately, the identity then matches, and
    // nothing loops.
    if (state.identity !== identity) {
        dispatch(identity === null ? { type: 'RESET' } : { type: 'FETCH_START', identity });
    }

    useEffect(() => {
        // Nobody is signed in, so there is nothing to ask for — and asking would spend a request
        // on a guaranteed 401 every time this mounts on a signed-out page.
        if (identity === null) return;

        const controller = new AbortController();
        dispatch({ type: 'FETCH_START', identity });

        load(controller.signal)
            .then(data => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', identity, data });
            })
            .catch((err: unknown) => {
                // A rejection is the unreachable-API case, which `!response.ok` never reports.
                if (controller.signal.aborted) return;
                dispatch({
                    type: 'FETCH_ERROR',
                    identity,
                    error: err instanceof Error ? err.message : 'Something went wrong.',
                });
            });

        return () => controller.abort();
    }, [identity, load, reloadToken]);

    const reload = useCallback(() => setReloadToken(token => token + 1), []);

    const patch = useCallback(
        (apply: (data: T) => T) => {
            if (identity !== null) dispatch({ type: 'PATCH', identity, apply });
        },
        [identity],
    );

    return { data: state.data, loading: state.loading, error: state.error, reload, patch };
}
