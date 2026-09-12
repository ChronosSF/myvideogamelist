import { useCallback, useEffect, useReducer } from 'react';

export interface UseHiddenPlatformsResult {
    hiddenIds: Set<number>;
    loading: boolean;
    saving: boolean;
    /**
     * The preference could not be read, so the empty set beside this is not the user's answer. A
     * caller must not offer to save from it: an empty set is indistinguishable from "nothing
     * hidden", and saving it writes that over whatever they had chosen.
     */
    loadError: string | null;
    /** A save failed. The set beside this is still what the user chose, and is theirs to retry. */
    saveError: string | null;
    setHiddenIds: (value: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
    save: () => Promise<void>;
}

type HiddenIdsUpdate = Set<number> | ((prev: Set<number>) => Set<number>);

/**
 * What the hook holds, with the account it belongs to beside it — the shape `useUserStats` and the
 * two list providers use, and for the same reason: every action below names the account it was
 * raised for, and the reducer drops one that arrives after that account has been replaced.
 */
export interface HiddenPlatformsState {
    account: string | null;
    hiddenIds: Set<number>;
    loading: boolean;
    saving: boolean;
    /**
     * Kept apart, which is the rule every provider here follows: a failed read means there is
     * nothing trustworthy to show, while a failed save leaves the set on screen exactly as the user
     * chose it. One field for both cannot tell a caller which of those it is looking at — and the
     * one that matters is the read, because the empty set it leaves behind reads as a preference.
     */
    loadError: string | null;
    saveError: string | null;
}

export type HiddenPlatformsAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; account: string }
    | { type: 'FETCH_SUCCESS'; account: string; ids: Set<number> }
    | { type: 'FETCH_ERROR'; account: string; error: string }
    | { type: 'EDIT'; account: string; update: HiddenIdsUpdate }
    | { type: 'SAVE_START'; account: string }
    | { type: 'SAVE_SUCCESS'; account: string }
    | { type: 'SAVE_ERROR'; account: string; error: string };

/** Nothing hidden, and a request in flight only if somebody is signed in. */
function initial(account: string | null): HiddenPlatformsState {
    return {
        account,
        hiddenIds: new Set(),
        loading: account !== null,
        saving: false,
        loadError: null,
        saveError: null,
    };
}

/** Drops an action that was raised against an account other than the one on screen. */
function ifCurrent(
    state: HiddenPlatformsState,
    account: string,
    next: () => HiddenPlatformsState,
): HiddenPlatformsState {
    return account === state.account ? next() : state;
}

/**
 * Exported so the stamps can be pinned directly — see `userStatsReducer` for why a component test
 * cannot reach the frame they guard.
 */
export function hiddenPlatformsReducer(
    state: HiddenPlatformsState,
    action: HiddenPlatformsAction,
): HiddenPlatformsState {
    switch (action.type) {
        case 'RESET':
            return initial(null);
        case 'FETCH_START':
            // Cleared on the transition rather than when the new fetch lands, so a load that fails
            // cannot leave the previous account's preference in force for the next one. A save in
            // flight goes with it: whatever it was saving was never this account's.
            return action.account === state.account
                ? { ...state, loading: true, loadError: null }
                : initial(action.account);
        case 'FETCH_SUCCESS':
            return ifCurrent(state, action.account, () =>
                ({ ...state, loading: false, hiddenIds: action.ids }));
        case 'FETCH_ERROR':
            return ifCurrent(state, action.account, () =>
                ({ ...state, loading: false, loadError: action.error }));
        case 'EDIT':
            return ifCurrent(state, action.account, () => ({
                ...state,
                hiddenIds: typeof action.update === 'function'
                    ? action.update(state.hiddenIds)
                    : action.update,
            }));
        // The save's completions are stamped too, and these are the ones an abort could never
        // cover: a PUT is not cancelled on sign-out, so its result really can arrive under the
        // next account.
        case 'SAVE_START':
            return ifCurrent(state, action.account, () =>
                ({ ...state, saving: true, saveError: null }));
        case 'SAVE_SUCCESS':
            return ifCurrent(state, action.account, () => ({ ...state, saving: false }));
        case 'SAVE_ERROR':
            return ifCurrent(state, action.account, () =>
                ({ ...state, saving: false, saveError: action.error }));
    }
}

/**
 * The platforms the user has chosen to hide from the upcoming-releases timeline, and the means to
 * change them.
 *
 * @param accountId
 * Whose preference this is, or null when nobody is signed in. The account rather than "is anybody
 * signed in", because this is mounted on the home page's timeline — which outlives a sign-out —
 * and a boolean cannot tell one account from the next. The guard is the one `useUserStats`
 * documents and ADR 0022 settled on for the list providers: the account is held in the reducer
 * state beside the set it protects, the transition is applied during render, and every completion
 * is stamped with the account it was started for and dropped on a mismatch.
 */
export function useHiddenPlatforms(accountId: string | null): UseHiddenPlatformsResult {
    const [state, dispatch] = useReducer(hiddenPlatformsReducer, accountId, initial);

    // Applied during render rather than in the effect, so no committed frame shows the previous
    // account's preference under the next one. The condition makes it idempotent.
    if (state.account !== accountId) {
        dispatch(accountId === null ? { type: 'RESET' } : { type: 'FETCH_START', account: accountId });
    }

    useEffect(() => {
        if (accountId === null) return;

        const controller = new AbortController();
        const account = accountId;
        dispatch({ type: 'FETCH_START', account });

        fetch('/api/user/hidden-platforms', { credentials: 'include', signal: controller.signal })
            .then(r => {
                if (!r.ok) throw new Error(`Failed to load hidden platforms (${r.status})`);
                return r.json() as Promise<number[]>;
            })
            .then(ids => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', account, ids: new Set(ids) });
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                dispatch({
                    type: 'FETCH_ERROR',
                    account,
                    error: err instanceof Error ? err.message : 'Unexpected error',
                });
            });

        return () => controller.abort();
    }, [accountId]);

    // Both stamped from this render — never from a ref at completion time — so an edit or a save
    // belonging to a previous account cannot touch the next one's set.
    const setHiddenIds = useCallback((update: HiddenIdsUpdate) => {
        if (accountId !== null) dispatch({ type: 'EDIT', account: accountId, update });
    }, [accountId]);

    const { hiddenIds } = state;

    const save = useCallback(async () => {
        if (accountId === null) return;
        const account = accountId;
        dispatch({ type: 'SAVE_START', account });
        try {
            const res = await fetch('/api/user/hidden-platforms', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platformIds: [...hiddenIds] }),
            });
            if (!res.ok) throw new Error(`Failed to save (${res.status})`);
            dispatch({ type: 'SAVE_SUCCESS', account });
        } catch (err) {
            dispatch({
                type: 'SAVE_ERROR',
                account,
                error: err instanceof Error ? err.message : 'Unexpected error',
            });
            throw err;
        }
    }, [accountId, hiddenIds]);

    return {
        hiddenIds,
        loading: state.loading,
        saving: state.saving,
        loadError: state.loadError,
        saveError: state.saveError,
        setHiddenIds,
        save,
    };
}
