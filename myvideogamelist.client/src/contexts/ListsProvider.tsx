import { useEffect, useReducer, useState, type ReactNode } from 'react';
import type { GameDto } from '@/types/game';
import { type ListId, type ListEntryDto, type ViewMode, LIST_IDS, emptyLists } from '@/types/list';
import { type SortState, DEFAULT_SORT } from '@/lib/listSort';
import { useAuth } from '@/hooks/useAuth';
import { ListsContext } from './ListsContext';

interface ApiListsResponse {
    lists: Record<ListId, ListEntryDto[]>;
}

interface ApiPreferencesResponse {
    view: ViewMode;
    /** Only the lists the user has actually changed; everything else uses `DEFAULT_SORT`. */
    sorts: Partial<Record<ListId, { sortKey: SortState['key']; descending: boolean }>>;
}

interface ListsState {
    lists: Record<ListId, ListEntryDto[]>;
    view: ViewMode;
    sorts: Partial<Record<ListId, SortState>>;
    loading: boolean;
    /** Set only on the initial fetch failure — triggers the full-page error state. */
    error: string | null;
    /**
     * Set on per-card mutation failures — shown as a banner beside the lists, which are still
     * good because the change has been rolled back. Cleared by the next mutation that succeeds:
     * there is no dismiss control, so a banner that only cleared on a reload would outlive the
     * problem it describes.
     */
    mutationError: string | null;
    /**
     * Whose lists these are, as the user id, or null when nobody is signed in.
     *
     * It lives here rather than in a ref so that the check and the data it protects move together.
     * A mutation can still be in flight when one account signs out and another signs in; its
     * rollback closes over entries captured from the first account, and every action that would
     * write them carries the session it was captured under. The reducer drops any that no longer
     * matches, so the guard is one place instead of a check at each call site — and, unlike a ref
     * written from an effect, it can never disagree with the state it is guarding.
     *
     * Only local state was ever at risk: a request already carries whichever cookie was current
     * when it was sent, so nothing crosses accounts on the server.
     */
    session: string | null;
}

type ListsAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; session: string | null }
    | { type: 'FETCH_SUCCESS'; session: string | null; lists: Record<ListId, ListEntryDto[]> }
    | { type: 'FETCH_ERROR'; session: string | null; error: string }
    | { type: 'PREFERENCES_LOADED'; session: string | null; view: ViewMode; sorts: Partial<Record<ListId, SortState>> }
    /*
     * The three a mutation raises, and the reason they name one game rather than carrying a set of
     * lists. Every one of them is computed inside the reducer from whatever state is current when
     * it arrives, and touches only the game it names — so a mutation for another game completing
     * in the meantime survives both the optimistic write and the rollback.
     *
     * `index` on PLACE_ENTRY is what makes a rollback exact: an add appends, because a game moved
     * to a list belongs at its end, but putting one back has a position to return it to.
     */
    | { type: 'PLACE_ENTRY'; session: string | null; listId: ListId; entry: ListEntryDto; index?: number }
    | { type: 'DROP_ENTRY'; session: string | null; gameId: number }
    | { type: 'SET_ENTRY_SCORE'; session: string | null; gameId: number; score: number | null }
    | { type: 'SET_VIEW'; view: ViewMode }
    | { type: 'SET_SORT'; listId: ListId; sort: SortState }
    | { type: 'MUTATION_ERROR'; session: string | null; error: string }
    | { type: 'CLEAR_MUTATION_ERROR'; session: string | null };

const initialState: ListsState = {
    lists: emptyLists(),
    view: 'tiles',
    sorts: {},
    loading: false,
    error: null,
    mutationError: null,
    session: null,
};

/** Drops an action that was raised against an account other than the one on screen. */
function ifCurrent(
    state: ListsState,
    session: string | null,
    next: () => ListsState,
): ListsState {
    return session === state.session ? next() : state;
}

function reducer(state: ListsState, action: ListsAction): ListsState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'FETCH_START':
            // A different account means none of the current state belongs to it — not the lists,
            // and not the per-user preferences either. Cleared here rather than waiting for the
            // fetch to land, because a fetch that *fails* would otherwise leave the previous
            // account's lists on screen under the new account's error message.
            return action.session === state.session
                ? { ...state, loading: true, error: null }
                : { ...initialState, session: action.session, loading: true };
        // The fetch results are session-stamped too, and not only because the request is aborted
        // on an account change: the abort runs in the effect cleanup, which is one more thing
        // that happens after the commit. A result resolving before that cleanup would otherwise
        // land on the account that has already replaced it.
        case 'FETCH_SUCCESS':
            return ifCurrent(state, action.session, () => ({
                ...state,
                loading: false,
                error: null,
                mutationError: null,
                // Spread over a complete empty set, so a status the server has not sent yet
                // still resolves to [] rather than undefined.
                lists: { ...emptyLists(), ...action.lists },
            }));
        case 'FETCH_ERROR':
            return ifCurrent(state, action.session, () =>
                ({ ...state, loading: false, error: action.error }));
        case 'PREFERENCES_LOADED':
            return ifCurrent(state, action.session, () =>
                ({ ...state, view: action.view, sorts: action.sorts }));
        // The three that a mutation raises, and therefore the three that can arrive late. Each
        // carries the session it was captured under; ifCurrent drops it when that has moved on.
        case 'PLACE_ENTRY':
            return ifCurrent(state, action.session, () => {
                const lists = without(state.lists, action.entry.game.id);
                const target = lists[action.listId];
                lists[action.listId] = action.index === undefined
                    ? [...target, action.entry]
                    : [...target.slice(0, action.index), action.entry, ...target.slice(action.index)];
                return { ...state, lists };
            });
        case 'DROP_ENTRY':
            return ifCurrent(state, action.session, () =>
                ({ ...state, lists: without(state.lists, action.gameId) }));
        case 'SET_ENTRY_SCORE':
            return ifCurrent(state, action.session, () => {
                const lists = { ...state.lists };
                for (const id of LIST_IDS) {
                    if (!lists[id].some(e => e.game.id === action.gameId)) continue;
                    lists[id] = lists[id].map(e =>
                        e.game.id === action.gameId ? { ...e, score: action.score } : e);
                }
                return { ...state, lists };
            });
        case 'SET_VIEW':
            return { ...state, view: action.view };
        case 'SET_SORT':
            return { ...state, sorts: { ...state.sorts, [action.listId]: action.sort } };
        case 'MUTATION_ERROR':
            return ifCurrent(state, action.session, () => ({ ...state, mutationError: action.error }));
        case 'CLEAR_MUTATION_ERROR':
            return ifCurrent(state, action.session, () => ({ ...state, mutationError: null }));
        default:
            return state;
    }
}

/** Every list with one game taken out of whichever one held it, and nothing else changed. */
function without(
    lists: Record<ListId, ListEntryDto[]>,
    gameId: number,
): Record<ListId, ListEntryDto[]> {
    const next = { ...lists };
    for (const id of LIST_IDS) {
        if (next[id].some(entry => entry.game.id === gameId)) {
            next[id] = next[id].filter(entry => entry.game.id !== gameId);
        }
    }
    return next;
}

/**
 * Where a game's entry sits: which list, the row itself, and its position in that list.
 *
 * A mutation captures this for the one game it is about, which is the whole of what it needs to
 * undo itself — and, unlike the set of lists it used to keep, it says nothing about any other
 * game, so a rollback built from it cannot disturb one.
 */
interface EntryPosition {
    listId: ListId;
    entry: ListEntryDto;
    index: number;
}

function locate(lists: Record<ListId, ListEntryDto[]>, gameId: number): EntryPosition | null {
    for (const listId of LIST_IDS) {
        const index = lists[listId].findIndex(entry => entry.game.id === gameId);
        if (index !== -1) return { listId, entry: lists[listId][index], index };
    }
    return null;
}

export function ListsProvider({ children }: { children: ReactNode }) {
    const { user, loading: authLoading } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);
    // Track gameIds with in-flight mutations to prevent concurrent-update corruption
    const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

    /**
     * The account every mutation below stamps its actions with — see `ListsState.session` for what
     * that protects against.
     *
     * Read from this render rather than from a ref at completion time. A ref has to be written
     * somewhere and both options are wrong: from an effect it lags the commit, leaving a window
     * where the new account is on screen while the marker still names the old one, and during
     * render it can be moved by a render React then throws away.
     */
    const session = user?.id ?? null;

    // The account transition is applied *during render*, not in the effect below.
    //
    // An effect runs after the commit, which leaves a frame where the new account is on screen
    // while the state — the lists themselves and the session that guards them — still belongs to
    // the previous one. That frame renders one user's games under another, and judges anything
    // completing inside it against the account that has already been replaced.
    //
    // Adjusting state during render is React's documented answer to a changed prop, and it is
    // what the rest of this codebase uses for the same reason. The condition makes it idempotent:
    // React re-renders immediately, `state.session` then matches, and nothing loops. The effect
    // still dispatches `FETCH_START` for the fetch itself, which is a no-op on the same session.
    //
    // **This is reasoned, not covered by a test, and that is not for want of trying.** Under
    // jsdom every render, commit and passive effect inside an `act` block is flushed together on
    // the way out, so the frame this exists to fix does not occur: a `rerender` inside `act` does
    // not even commit until the block exits. Removing these three lines leaves the whole suite
    // green. The tests below cover what happens *after* the transition, on either side of it;
    // the timing of the transition itself needs a real browser to observe.
    if (!authLoading && state.session !== session) {
        dispatch(session === null ? { type: 'RESET' } : { type: 'FETCH_START', session });
    }

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            dispatch({ type: 'RESET' });
            return;
        }

        const controller = new AbortController();
        const fetchSession = user.id;
        dispatch({ type: 'FETCH_START', session: fetchSession });

        fetch('/api/lists', { credentials: 'include', signal: controller.signal })
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load lists (${res.status})`);
                return res.json() as Promise<ApiListsResponse>;
            })
            .then(data => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', session: fetchSession, lists: data.lists });
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                dispatch({
                    type: 'FETCH_ERROR',
                    session: fetchSession,
                    error: err instanceof Error ? err.message : 'Failed to load lists.',
                });
            });

        // Fetched alongside rather than before: preferences only affect presentation, so failing
        // to load them falls back to the defaults rather than blocking the lists themselves.
        fetch('/api/user/list-preferences', { credentials: 'include', signal: controller.signal })
            .then(res => (res.ok ? (res.json() as Promise<ApiPreferencesResponse>) : null))
            .then(data => {
                if (!data || controller.signal.aborted) return;
                const sorts: Partial<Record<ListId, SortState>> = {};
                for (const [id, sort] of Object.entries(data.sorts) as [ListId, { sortKey: SortState['key']; descending: boolean }][]) {
                    sorts[id] = { key: sort.sortKey, descending: sort.descending };
                }
                dispatch({ type: 'PREFERENCES_LOADED', session: fetchSession, view: data.view, sorts });
            })
            .catch(() => {
                // Swallowed by design — the defaults are a perfectly good fallback and a failed
                // preference load is not worth an error state over the user's actual lists.
            });

        return () => controller.abort();
    }, [user, authLoading]);

    /** Sends the whole preference set, matching the endpoint's replace-wholesale contract. */
    const persistPreferences = (view: ViewMode, sorts: Partial<Record<ListId, SortState>>) => {
        void fetch('/api/user/list-preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                view,
                sorts: Object.entries(sorts).map(([status, sort]) => ({
                    status,
                    sortKey: sort.key,
                    descending: sort.descending,
                })),
            }),
        }).catch(() => {
            // A preference that fails to save is not worth interrupting anyone over. The UI keeps
            // the new setting and the next page load reconciles with whatever the server has.
        });
    };

    const setView = (view: ViewMode) => {
        dispatch({ type: 'SET_VIEW', view });
        persistPreferences(view, state.sorts);
    };

    const setSort = (listId: ListId, sort: SortState) => {
        dispatch({ type: 'SET_SORT', listId, sort });
        persistPreferences(state.view, { ...state.sorts, [listId]: sort });
    };

    const sortFor = (listId: ListId): SortState => state.sorts[listId] ?? DEFAULT_SORT;

    const startPending = (gameId: number) => setPendingIds(prev => new Set(prev).add(gameId));
    const endPending = (gameId: number) =>
        setPendingIds(prev => { const next = new Set(prev); next.delete(gameId); return next; });

    /**
     * Undoes one game's optimistic change and says why, for whichever way the request failed.
     *
     * The two ways are not interchangeable and only one of them used to be handled: a request
     * that arrives and is refused returns `!res.ok`, but a request that never arrives — the API
     * down, the connection dropped — makes `fetch` *reject*. Without a `catch`, that left the
     * optimistic change standing as though it had been saved and escaped as an unhandled
     * rejection, since every caller fires these with `void`.
     */
    const rollBack = (undo: () => void, error: string) => {
        undo();
        dispatch({ type: 'MUTATION_ERROR', session, error });
    };

    /** Puts one game back exactly where it was, or off the lists if it was on none. */
    const restore = (origin: EntryPosition | null, gameId: number) => () => {
        if (origin) {
            dispatch({
                type: 'PLACE_ENTRY',
                session,
                listId: origin.listId,
                entry: origin.entry,
                index: origin.index,
            });
        } else {
            dispatch({ type: 'DROP_ENTRY', session, gameId });
        }
    };

    const addToList = async (listId: ListId, game: GameDto): Promise<void> => {
        if (pendingIds.has(game.id)) return;
        startPending(game.id);

        // Only this game's own row is remembered, never the whole set of lists — see
        // docs/decisions/0022-*, decision 6. Its correctness rests on the pending set: no other
        // mutation can be moving this game while this one holds its id, so what is captured here
        // stays true for as long as it takes to undo.
        const origin = locate(state.lists, game.id);

        // A move carries the existing entry across so the score does not blink out and back.
        const moved: ListEntryDto = origin
            ? { ...origin.entry, statusChangedAt: new Date().toISOString() }
            : { game, score: null, addedAt: new Date().toISOString(), statusChangedAt: new Date().toISOString() };

        // Appended rather than placed: a game just moved to a list is the most recent thing in it.
        dispatch({ type: 'PLACE_ENTRY', session, listId, entry: moved });

        const undo = restore(origin, game.id);

        try {
            const res = await fetch(`/api/lists/${game.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status: listId }),
            });

            if (res.ok) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else rollBack(undo, 'Failed to update list. Please try again.');
        } catch {
            rollBack(undo, 'Failed to update list. Please try again.');
        } finally {
            endPending(game.id);
        }
    };

    const removeFromList = async (listId: ListId, gameId: number): Promise<void> => {
        if (pendingIds.has(gameId)) return;
        startPending(gameId);

        const index = state.lists[listId].findIndex(entry => entry.game.id === gameId);
        const removed = index === -1 ? null : { listId, entry: state.lists[listId][index], index };
        dispatch({ type: 'DROP_ENTRY', session, gameId });

        const undo = restore(removed, gameId);

        try {
            const res = await fetch(`/api/lists/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            if (res.ok) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else rollBack(undo, 'Failed to remove from list. Please try again.');
        } catch {
            rollBack(undo, 'Failed to remove from list. Please try again.');
        } finally {
            endPending(gameId);
        }
    };

    const setScore = async (gameId: number, score: number | null): Promise<boolean> => {
        // Scoring takes the same per-game lock as a status change, because it writes the same
        // entry row. Without it two scores set in quick succession could both be in flight, and
        // the first one failing would roll the second one back to a value neither had asked for.
        if (pendingIds.has(gameId)) return false;
        startPending(gameId);

        // The entry may be in no list at all, in which case there is nothing on screen to update
        // optimistically and the server call is the whole operation.
        const previous = locate(state.lists, gameId)?.entry.score ?? null;
        dispatch({ type: 'SET_ENTRY_SCORE', session, gameId, score });

        const undo = () => dispatch({ type: 'SET_ENTRY_SCORE', session, gameId, score: previous });

        try {
            const res = await fetch(`/api/entries/${gameId}/score`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ score }),
            });

            if (!res.ok) {
                rollBack(undo, 'Failed to save your score. Please try again.');
                return false;
            }
            dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            return true;
        } catch {
            rollBack(undo, 'Failed to save your score. Please try again.');
            return false;
        } finally {
            endPending(gameId);
        }
    };

    const deleteEntry = async (gameId: number): Promise<void> => {
        if (pendingIds.has(gameId)) return;
        startPending(gameId);

        const origin = locate(state.lists, gameId);
        dispatch({ type: 'DROP_ENTRY', session, gameId });

        const undo = restore(origin, gameId);

        try {
            const res = await fetch(`/api/entries/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            // 404 means there was nothing recorded, which is the state the caller wanted anyway.
            if (res.ok || res.status === 404) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else rollBack(undo, 'Failed to remove your data. Please try again.');
        } catch {
            rollBack(undo, 'Failed to remove your data. Please try again.');
        } finally {
            endPending(gameId);
        }
    };

    const isInList = (listId: ListId, gameId: number): boolean =>
        state.lists[listId].some(entry => entry.game.id === gameId);

    const getListFor = (gameId: number): ListId | null =>
        LIST_IDS.find(id => state.lists[id].some(entry => entry.game.id === gameId)) ?? null;

    const scoreFor = (gameId: number): number | null =>
        locate(state.lists, gameId)?.entry.score ?? null;

    const isPending = (gameId: number): boolean => pendingIds.has(gameId);

    return (
        <ListsContext.Provider value={{
            lists: state.lists,
            loading: state.loading,
            error: state.error,
            mutationError: state.mutationError,
            isPending,
            addToList,
            removeFromList,
            isInList,
            getListFor,
            scoreFor,
            setScore,
            deleteEntry,
            view: state.view,
            setView,
            sortFor,
            setSort,
        }}>
            {children}
        </ListsContext.Provider>
    );
}
