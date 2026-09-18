import { useEffect, useReducer, useState } from 'react';
import type { GameDto } from '@/types/game';
import { useAuth } from '@/hooks/useAuth';

/**
 * One game on a per-user axis — the wishlist or the favourites — and when it joined.
 *
 * The two axes' DTOs are this shape exactly, and keep their own names (`WishlistItemDto`,
 * `FavouriteDto`) so that neither reads as interchangeable with the other.
 */
export interface GameAxisItem {
    game: GameDto;
    addedAt: string;
}

/** What a provider built on this hands its context. */
export interface GameAxis {
    /** Most recently added first, which is the order the server returns. */
    items: GameAxisItem[];
    loading: boolean;
    /** Fetch failure only — there is nothing trustworthy to show. */
    error: string | null;
    /** Add or remove failure — shown next to the items, not instead of them. */
    mutationError: string | null;
    has: (gameId: number) => boolean;
    isPending: (gameId: number) => boolean;
    add: (game: GameDto) => Promise<boolean>;
    remove: (gameId: number) => Promise<boolean>;
    reload: () => void;
}

/**
 * Declare this once, at module level, and pass the same object on every render: the fetch effect
 * depends on its members, so a literal written inline would refetch on every render it caused.
 */
export interface GameAxisOptions {
    /**
     * The collection endpoint: `GET` it for the items, `PUT` and `DELETE` `{endpoint}/{gameId}`. The
     * `PUT` answers with `{ addedAt }`, the time the server kept.
     */
    endpoint: string;
    /** "Failed to load your wishlist (500)", for a response that was refused. */
    loadFailed: (status: number) => string;
    /** For a request that never arrived, which has no status to report. */
    loadUnreachable: string;
    mutationFailed: string;
}

interface GameAxisState {
    items: GameAxisItem[];
    loading: boolean;
    error: string | null;
    mutationError: string | null;
    /**
     * Whose items these are, as the user id, or null when nobody is signed in.
     *
     * It lives here rather than in a ref so that the check and the data it protects move together.
     * A mutation can still be in flight when one account signs out and another signs in; its
     * rollback closes over the row captured from the first account, and every action that would
     * write it carries the session it was captured under. A ref cannot do this job: written from
     * an effect it lags the commit, leaving a window where the new account is on screen while the
     * marker still names the old one, and written during render it can be moved by a render React
     * then throws away.
     *
     * Only local state was ever at risk: a request already carries whichever cookie was current
     * when it was sent, so nothing crosses accounts on the server.
     */
    session: string | null;
    /**
     * The game ids with a mutation in flight, which is what stops two writes to one row
     * overlapping and what disables that game's toggle while one is out.
     *
     * It lives in the reducer for the same reason `session` does, and specifically so that the
     * account change clears it. Held in its own `useState` it survived a sign-out, and the id of
     * a game the previous account had left in flight stayed locked — the new account's toggle for
     * that one game disabled until a request it has nothing to do with settles, or forever if that
     * request hangs.
     */
    pending: ReadonlySet<number>;
}

type GameAxisAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; session: string | null }
    | { type: 'FETCH_SUCCESS'; session: string | null; items: GameAxisItem[] }
    | { type: 'FETCH_ERROR'; session: string | null; error: string }
    | { type: 'PREPEND_ITEM'; session: string | null; item: GameAxisItem }
    | { type: 'CONFIRM_ITEM'; session: string | null; gameId: number; addedAt: string }
    | { type: 'RESTORE_ITEM'; session: string | null; item: GameAxisItem }
    | { type: 'DROP_ITEM'; session: string | null; gameId: number }
    | { type: 'MUTATION_ERROR'; session: string | null; error: string }
    | { type: 'CLEAR_MUTATION_ERROR'; session: string | null }
    // Session-stamped like everything else a mutation raises, so the release of a lock taken by
    // the previous account cannot reach a set that has since been cleared and refilled.
    | { type: 'START_PENDING'; session: string | null; gameId: number }
    | { type: 'END_PENDING'; session: string | null; gameId: number };

const initialState: GameAxisState = {
    items: [],
    loading: false,
    error: null,
    mutationError: null,
    session: null,
    pending: new Set(),
};

function has(items: GameAxisItem[], gameId: number): boolean {
    return items.some(item => item.game.id === gameId);
}

/**
 * The order both endpoints return: newest first, and by game id when two rows joined at the same
 * moment. The tie-break matters because the timestamps are written by the server rather than by the
 * row: a library import writes a whole axis with one of them, and without it those games would sit
 * in one order here and another after a reload.
 */
function compareItems(a: GameAxisItem, b: GameAxisItem): number {
    return Date.parse(b.addedAt) - Date.parse(a.addedAt) || a.game.id - b.game.id;
}

/**
 * The list the server sent, with every game that has a write in flight left as this client has it.
 *
 * A refetch for the same account — `AuthProvider` hands back a new user object for a theme change,
 * and the effect below depends on it — can land while an add or a remove is still out, carrying an
 * answer composed before that write. Taken as it stands it puts back a game whose removal is in
 * flight, or drops one whose add is; and in the second case the add's confirmation then finds no row
 * to place, so a write that succeeded looks to have failed until the next load. The pending set is
 * per game, so nothing else in the answer is held back.
 */
function reconciled(loaded: GameAxisItem[], state: GameAxisState): GameAxisItem[] {
    if (state.pending.size === 0) return loaded;

    const inFlight = (item: GameAxisItem) => state.pending.has(item.game.id);

    // A game being removed is already out of `items`, so it is dropped from the answer as well.
    const kept = loaded.filter(item => !inFlight(item) || has(state.items, item.game.id));

    // A game being added is not in the answer yet, and stays at the front, where the add put it.
    const adding = state.items.filter(item => inFlight(item) && !has(loaded, item.game.id));

    return [...adding, ...kept];
}

/**
 * A load failure this hook has a message for. Anything else that reaches the catch is reported as
 * the axis's own "unreachable" message: a rejected `fetch` is a `TypeError` carrying the browser's
 * wording ("Failed to fetch"), and a body that is not JSON a `SyntaxError` — neither of which says
 * anything the reader can act on.
 */
class AxisLoadError extends Error {}

/**
 * The time a successful add says the game joined, or null when the answer carries none that parses —
 * the item then stays where the add put it, which is the next best place.
 */
async function addedAtFrom(response: Response): Promise<string | null> {
    try {
        const body: unknown = await response.json();
        const addedAt = typeof body === 'object' && body !== null && 'addedAt' in body ? body.addedAt : null;
        return typeof addedAt === 'string' && !Number.isNaN(Date.parse(addedAt)) ? addedAt : null;
    } catch {
        return null;
    }
}

/** Drops an action that was raised against an account other than the one on screen. */
function ifCurrent(
    state: GameAxisState,
    session: string | null,
    next: () => GameAxisState,
): GameAxisState {
    return session === state.session ? next() : state;
}

function reducer(state: GameAxisState, action: GameAxisAction): GameAxisState {
    switch (action.type) {
        case 'RESET':
            return initialState;
        case 'FETCH_START':
            // A different account means none of the current state belongs to it. Cleared here
            // rather than waiting for the fetch to land, because a fetch that *fails* would
            // otherwise leave the previous account's items on screen under the new account's
            // error message.
            return action.session === state.session
                ? { ...state, loading: true, error: null }
                : { ...initialState, session: action.session, loading: true };
        // Session-stamped too, and not only because the request is aborted on an account change:
        // the abort runs in the effect cleanup, which is one more thing that happens after the
        // commit. A result resolving before that cleanup would otherwise land on the account that
        // has already replaced it.
        case 'FETCH_SUCCESS':
            return ifCurrent(state, action.session, () => ({
                ...state,
                items: reconciled(action.items, state),
                loading: false,
                error: null,
                mutationError: null,
            }));
        case 'FETCH_ERROR':
            return ifCurrent(state, action.session, () =>
                ({ ...state, loading: false, error: action.error }));

        // A newly added game goes to the front because it *is* the newest, and saying so beats
        // sorting on a timestamp this client invented: a browser clock running behind the server
        // would otherwise file a brand-new item below older ones until the server's own time comes
        // back with the answer.
        case 'PREPEND_ITEM':
            return ifCurrent(state, action.session, () =>
                has(state.items, action.item.game.id)
                    ? state
                    : { ...state, items: [action.item, ...state.items] });

        // That answer: the time the server kept for an item this client added. Nearly always a
        // moment after every other item's, so the item stays at the front — but a game another tab
        // had already added keeps the time it really joined, and goes back to it. Only this item
        // moves, placed among the others in the order the endpoint uses, so nothing else is
        // reordered.
        case 'CONFIRM_ITEM':
            return ifCurrent(state, action.session, () => {
                const confirmed = state.items.find(item => item.game.id === action.gameId);
                if (!confirmed) return state;

                const others = state.items.filter(item => item.game.id !== action.gameId);
                const placed = { ...confirmed, addedAt: action.addedAt };
                const at = others.findIndex(item => compareItems(placed, item) < 0);

                return {
                    ...state,
                    items: at === -1
                        ? [...others, placed]
                        : [...others.slice(0, at), placed, ...others.slice(at)],
                };
            });

        // A restore is the opposite case: the row has a server timestamp and a place it came
        // from, so it is sorted back into it rather than pushed to the front.
        case 'RESTORE_ITEM':
            return ifCurrent(state, action.session, () =>
                has(state.items, action.item.game.id)
                    ? state
                    : { ...state, items: [...state.items, action.item].sort(compareItems) });

        // Both of the above and this one work off whatever the current state is, rather than
        // restoring a snapshot taken before the request. Mutations for different games run
        // concurrently by design, so replacing the whole list on rollback would undo whichever
        // of them happened to succeed in the meantime.
        case 'DROP_ITEM':
            return ifCurrent(state, action.session, () => ({
                ...state,
                items: state.items.filter(item => item.game.id !== action.gameId),
            }));

        case 'MUTATION_ERROR':
            return ifCurrent(state, action.session, () => ({ ...state, mutationError: action.error }));
        case 'CLEAR_MUTATION_ERROR':
            return ifCurrent(state, action.session, () => ({ ...state, mutationError: null }));
        case 'START_PENDING':
            return ifCurrent(state, action.session, () =>
                ({ ...state, pending: new Set(state.pending).add(action.gameId) }));
        case 'END_PENDING':
            return ifCurrent(state, action.session, () => {
                const pending = new Set(state.pending);
                pending.delete(action.gameId);
                return { ...state, pending };
            });
        default:
            return state;
    }
}

/**
 * The state behind every per-game axis provider: the wishlist, and the favourites.
 *
 * Moved out of `WishlistProvider` when the favourites needed the same thing, rather than copied.
 * ADR 0022 records the two list providers each missing a guard the other had, because review reads
 * the diff and a fix to one file never shows the other. Two axes on one implementation cannot drift
 * that way. Each provider keeps its own context and its own pending set — a wishlist toggle in
 * flight must not disable the favourite toggle on the same game — and only the code is shared.
 *
 * A reducer rather than several `useState` calls because the fetch effect has to set state
 * synchronously, and `react-hooks/set-state-in-effect` forbids that for a setter while allowing a
 * `dispatch`. `ListsProvider` is shaped the same way for the same reason.
 */
export function useGameAxis({ endpoint, loadFailed, loadUnreachable, mutationFailed }: GameAxisOptions): GameAxis {
    const { user, loading: authLoading } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);
    const [reloadToken, setReloadToken] = useState(0);

    /**
     * The account every mutation below stamps its actions with — see `GameAxisState.session` for
     * what that protects against. Read from this render, never from a ref at completion time.
     */
    const session = user?.id ?? null;

    // The account transition is applied *during render*, not in the effect below. An effect runs
    // after the commit, which leaves a frame where the new account is on screen while the state —
    // the items and the session that guards them — still belongs to the previous one. Adjusting
    // state during render is React's documented answer to a changed prop; the condition makes it
    // idempotent, so nothing loops.
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

        fetch(endpoint, { credentials: 'include', signal: controller.signal })
            .then(res => {
                if (!res.ok) throw new AxisLoadError(loadFailed(res.status));
                return res.json() as Promise<GameAxisItem[]>;
            })
            .then(items => {
                if (!controller.signal.aborted) dispatch({ type: 'FETCH_SUCCESS', session: fetchSession, items });
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                // Surfaced rather than swallowed: an empty axis and one that failed to load look
                // identical on screen, and the second must not read as the first.
                dispatch({
                    type: 'FETCH_ERROR',
                    session: fetchSession,
                    error: err instanceof AxisLoadError ? err.message : loadUnreachable,
                });
            });

        return () => controller.abort();
        // The options are module-level constants in each provider, so listing them costs nothing
        // and a provider passing a fresh function per render would refetch loudly, not silently.
    }, [user, authLoading, reloadToken, endpoint, loadFailed, loadUnreachable]);

    const reload = () => setReloadToken(token => token + 1);

    /**
     * Membership is unknown both while the first fetch runs and after one that failed, and in
     * neither case may anything be toggled: during the fetch a successful write would be
     * overwritten by the older response, and after a failure every game reads as "not on it" when
     * the truth is that nothing is known.
     */
    const isPending = (gameId: number): boolean =>
        state.loading || state.error !== null || state.pending.has(gameId);

    const startPending = (gameId: number) => dispatch({ type: 'START_PENDING', session, gameId });
    const endPending = (gameId: number) => dispatch({ type: 'END_PENDING', session, gameId });

    const add = async (game: GameDto): Promise<boolean> => {
        if (isPending(game.id)) return false;
        // Already there, so the caller already has what it asked for.
        if (has(state.items, game.id)) return true;

        startPending(game.id);
        dispatch({ type: 'PREPEND_ITEM', session, item: { game, addedAt: new Date().toISOString() } });

        try {
            const res = await fetch(`${endpoint}/${game.id}`, {
                method: 'PUT',
                credentials: 'include',
            });

            if (res.ok) {
                // Read while the game's lock is still held, so no removal of it can land in between.
                const addedAt = await addedAtFrom(res);
                if (addedAt !== null) dispatch({ type: 'CONFIRM_ITEM', session, gameId: game.id, addedAt });
                dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
                return true;
            }
            dispatch({ type: 'DROP_ITEM', session, gameId: game.id });
            dispatch({ type: 'MUTATION_ERROR', session, error: mutationFailed });
            return false;
        } catch {
            dispatch({ type: 'DROP_ITEM', session, gameId: game.id });
            dispatch({ type: 'MUTATION_ERROR', session, error: mutationFailed });
            return false;
        } finally {
            endPending(game.id);
        }
    };

    const remove = async (gameId: number): Promise<boolean> => {
        if (isPending(gameId)) return false;

        startPending(gameId);

        // Only the one row is remembered, so putting it back cannot disturb anything else. Its
        // AddedAt is what returns it to its original position rather than the top of the list.
        const removed = state.items.find(item => item.game.id === gameId);
        dispatch({ type: 'DROP_ITEM', session, gameId });

        try {
            const res = await fetch(`${endpoint}/${gameId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            // 404 means it was not on the axis, which is the state the caller asked for.
            if (res.ok || res.status === 404) {
                dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
                return true;
            }
            if (removed) dispatch({ type: 'RESTORE_ITEM', session, item: removed });
            dispatch({ type: 'MUTATION_ERROR', session, error: mutationFailed });
            return false;
        } catch {
            if (removed) dispatch({ type: 'RESTORE_ITEM', session, item: removed });
            dispatch({ type: 'MUTATION_ERROR', session, error: mutationFailed });
            return false;
        } finally {
            endPending(gameId);
        }
    };

    return {
        items: state.items,
        loading: state.loading,
        error: state.error,
        mutationError: state.mutationError,
        has: gameId => has(state.items, gameId),
        isPending,
        add,
        remove,
        reload,
    };
}
