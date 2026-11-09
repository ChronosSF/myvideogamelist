import {
    useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
    type Dispatch, type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import type { GameDto } from '@/types/game';
import {
    type ListId, type ListEntryDto, type ListNames, type Ownership, type ViewMode,
    HAND_ORDERED_LISTS, LIST_IDS, LIST_NAMES, emptyLists,
} from '@/types/list';
import { type SortState, DEFAULT_SORT, MANUAL_SORT, sortEntries } from '@/lib/listSort';
import { moveInHandOrder } from '@/lib/handOrderMove';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch } from '@/lib/api';
import {
    ListsContext, type ListsContextValue, type ListsPending, type SaveListNamesResult, type SaveResult,
} from './ListsContext';
import { ListViewContext, type ListViewContextValue } from './ListViewContext';

interface ApiListsResponse {
    lists: Record<ListId, ListEntryDto[]>;
}

interface ApiPreferencesResponse {
    view: ViewMode;
    /** Only the lists the user has actually changed; everything else uses `DEFAULT_SORT`. */
    sorts: Partial<Record<ListId, { sortKey: SortState['key']; descending: boolean }>>;
    /** Only the lists the user has renamed; everything else uses `LIST_NAMES`. */
    names: ListNames;
}

interface ListsState {
    lists: Record<ListId, ListEntryDto[]>;
    view: ViewMode;
    sorts: Partial<Record<ListId, SortState>>;
    names: ListNames;
    /**
     * Whether `names` came back. Kept apart from `loading` because the names ride on the preferences
     * request, which fails independently of the lists and used to fail silently — harmless for a
     * sort, which has a default, but not for a form that would save the defaults over real names.
     */
    namesStatus: 'loading' | 'ready' | 'failed';
    /**
     * Whether the user has renamed a list, or changed the view or a sort, since the preferences read
     * now in flight was started.
     *
     * The answer to that read was composed before it arrived. One that lands after a write of the
     * same fields is therefore older than what is on screen, and applying it puts the previous labels
     * or the previous view back until the next page load. The read is not rare: `AuthProvider` hands
     * the provider a new user object for something as ordinary as making the profile public, and the
     * effect below depends on it. Kept per group of fields rather than as one flag, because the read
     * is the only thing that brings the names at all — dropping the whole answer over a view toggle
     * would mark the names `ready` at their defaults, which is what a rename form must never be
     * handed.
     */
    namesWrittenSinceRead: boolean;
    viewWrittenSinceRead: boolean;
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
    /**
     * The game ids with a mutation in flight, which is what stops two writes to one entry row
     * overlapping and what disables that game's controls while one is out.
     *
     * It lives in the reducer for the same reason `session` does, and specifically so that the
     * account change clears it. Held in its own `useState` it survived a sign-out, and the id of a
     * game the previous account had left in flight stayed locked — the new account's controls for
     * that one game disabled until a request it has nothing to do with settles, or forever if that
     * request hangs.
     */
    pending: ReadonlySet<number>;
}

/**
 * The fields of a game's row that a write to its entry changes in place, wherever the game sits — its
 * score and its tags. One action carries any of them, so the next such field joins this type rather than
 * adding a third copy of the same loop (ADR 0022's lesson: a guard added to one copy is missed on the
 * others).
 */
type RowFields = Partial<Pick<ListEntryDto, 'score' | 'tagIds'>>;

type ListsAction =
    | { type: 'RESET' }
    | { type: 'FETCH_START'; session: string | null }
    | { type: 'FETCH_SUCCESS'; session: string | null; lists: Record<ListId, ListEntryDto[]> }
    | { type: 'FETCH_ERROR'; session: string | null; error: string }
    | { type: 'PREFERENCES_LOADED'; session: string | null; view: ViewMode; sorts: Partial<Record<ListId, SortState>>; names: ListNames }
    | { type: 'PREFERENCES_FAILED'; session: string | null }
    // Stamped like a mutation, because it is one: a save still out when the account changes must not
    // write the previous account's names over the next one's.
    | { type: 'NAMES_SAVED'; session: string | null; names: ListNames }
    /*
     * Three of the four a mutation raises — `SET_POSITIONS` below is the fourth — and the reason they
     * name one game rather than carrying a set of lists. Every one of them is computed inside the
     * reducer from whatever state is current when it arrives, and touches only the game it names — so
     * a mutation for another game completing in the meantime survives both the optimistic write and
     * the rollback.
     *
     * None of them carries an index, and that is deliberate: a list is never rendered in the order it
     * is held in. `ListsPage` runs every list through `sortEntries`, which is a total order — every key
     * ends in a tie-break, precisely so the result cannot depend on the order the API happened to
     * return. An index captured before a request is also wrong by the time it is used, because another
     * game may have left the list from in front of it. The wishlist is the opposite case and keeps its
     * order from `addedAt`, a value rather than an index, because that page does render its array as it
     * stands; and so is a hand order, whose sparse `position` rides on the entry `PLACE_ENTRY` carries
     * (`docs/decisions/0054-*`).
     */
    | { type: 'PLACE_ENTRY'; session: string | null; listId: ListId; entry: ListEntryDto }
    | { type: 'DROP_ENTRY'; session: string | null; gameId: number }
    | { type: 'SET_ENTRY_FIELDS'; session: string | null; gameId: number; fields: RowFields }
    /*
     * A move in a hand order, and its undo. It names positions by game, as values — the sparse numbers
     * of `@/lib/handOrder`, not indexes — so it touches nothing but the games it names, and an undo
     * that puts back the values those games had is exact: every one of them was locked for the
     * duration, so nothing else can have moved it in between.
     */
    | { type: 'SET_POSITIONS'; session: string | null; listId: ListId; positions: { gameId: number; position: number | null }[] }
    | { type: 'SET_VIEW'; view: ViewMode }
    | { type: 'SET_SORT'; listId: ListId; sort: SortState }
    | { type: 'MUTATION_ERROR'; session: string | null; error: string }
    | { type: 'CLEAR_MUTATION_ERROR'; session: string | null }
    // Session-stamped like everything else a mutation raises, so the release of a lock taken by
    // the previous account cannot reach a set that has since been cleared and refilled.
    | { type: 'START_PENDING'; session: string | null; gameId: number }
    | { type: 'END_PENDING'; session: string | null; gameId: number };

const initialState: ListsState = {
    lists: emptyLists(),
    view: 'tiles',
    sorts: {},
    names: {},
    namesStatus: 'loading',
    namesWrittenSinceRead: false,
    viewWrittenSinceRead: false,
    loading: false,
    error: null,
    mutationError: null,
    session: null,
    pending: new Set(),
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
            // The preferences read starts with this effect run, so what the user had written before
            // it is the read's own business; only a write that lands while it is out outranks it.
            return action.session === state.session
                ? {
                    ...state,
                    loading: true,
                    error: null,
                    namesWrittenSinceRead: false,
                    viewWrittenSinceRead: false,
                }
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
                lists: reconciled({ ...emptyLists(), ...action.lists }, state),
            }));
        case 'FETCH_ERROR':
            return ifCurrent(state, action.session, () =>
                ({ ...state, loading: false, error: action.error }));
        case 'PREFERENCES_LOADED':
            // Whatever the user changed while this was out is newer than it, field group by field
            // group. The names are `ready` either way: the read succeeded, so they are known.
            return ifCurrent(state, action.session, () => ({
                ...state,
                view: state.viewWrittenSinceRead ? state.view : action.view,
                sorts: state.viewWrittenSinceRead ? state.sorts : action.sorts,
                names: state.namesWrittenSinceRead ? state.names : action.names,
                namesStatus: 'ready',
            }));
        case 'PREFERENCES_FAILED':
            // The lists and every label still work, on the default names; only a names form needs to
            // know that what it would be editing never arrived.
            return ifCurrent(state, action.session, () => ({ ...state, namesStatus: 'failed' }));
        case 'NAMES_SAVED':
            return ifCurrent(state, action.session, () =>
                ({ ...state, names: action.names, namesStatus: 'ready', namesWrittenSinceRead: true }));
        // The ones a mutation raises, and therefore the ones that can arrive late. Each carries
        // the session it was captured under; ifCurrent drops it when that has moved on.
        case 'PLACE_ENTRY':
            return ifCurrent(state, action.session, () => {
                const lists = without(state.lists, action.entry.game.id);
                lists[action.listId] = [...lists[action.listId], action.entry];
                return { ...state, lists };
            });
        case 'DROP_ENTRY':
            return ifCurrent(state, action.session, () =>
                ({ ...state, lists: without(state.lists, action.gameId) }));
        // One game's own fields, wherever it sits, and nothing else touched.
        case 'SET_ENTRY_FIELDS':
            return ifCurrent(state, action.session, () => {
                const lists = { ...state.lists };
                for (const id of LIST_IDS) {
                    if (!lists[id].some(e => e.game.id === action.gameId)) continue;
                    lists[id] = lists[id].map(e =>
                        e.game.id === action.gameId ? { ...e, ...action.fields } : e);
                }
                return { ...state, lists };
            });
        case 'SET_POSITIONS':
            // Only in the list the move was made in: a game that has left it since has no place in
            // its order to be given back.
            return ifCurrent(state, action.session, () => {
                const positions = new Map(action.positions.map(p => [p.gameId, p.position]));
                const list = state.lists[action.listId].map(entry => positions.has(entry.game.id)
                    ? { ...entry, position: positions.get(entry.game.id) ?? null }
                    : entry);
                return { ...state, lists: { ...state.lists, [action.listId]: list } };
            });
        case 'SET_VIEW':
            return { ...state, view: action.view, viewWrittenSinceRead: true };
        case 'SET_SORT':
            return {
                ...state,
                sorts: { ...state.sorts, [action.listId]: action.sort },
                viewWrittenSinceRead: true,
            };
        case 'MUTATION_ERROR':
            return ifCurrent(state, action.session, () => ({ ...state, mutationError: action.error }));
        // Every save that lands raises this, and there is mostly nothing to clear: the same state, so that
        // React has nothing to draw.
        case 'CLEAR_MUTATION_ERROR':
            return ifCurrent(state, action.session, () =>
                (state.mutationError === null ? state : { ...state, mutationError: null }));
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
 * The sentence the server gave for refusing a write — the first message in a `ValidationProblemDetails`'
 * `errors` — or the fallback for a body that says nothing useful, which is what a 500 or a proxy's error
 * page looks like.
 */
async function refusal(res: Response, fallback: string): Promise<string> {
    try {
        const problem = (await res.json()) as { errors?: Record<string, string[]> };
        return Object.values(problem.errors ?? {}).flat()[0] ?? fallback;
    } catch {
        return fallback;
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
 * Which list a game's entry is in, and the row itself.
 *
 * A mutation captures this for the one game it is about, which is the whole of what it needs to
 * undo itself — and, unlike the set of lists it used to keep, it says nothing about any other
 * game, so a rollback built from it cannot disturb one. Deliberately not an index: see
 * `PLACE_ENTRY`.
 */
interface EntryOrigin {
    listId: ListId;
    entry: ListEntryDto;
}

/**
 * Where every game is, by id: the first list to hold it wins, though `PLACE_ENTRY` leaves a game in one.
 * The one way a game is found, built once for each change of the lists — for the readers a card calls on
 * every render, hundreds of cards on the lists page each asking after its own game, and for the writes,
 * which find it in the render last committed (`Committed`).
 */
function locateAll(lists: Record<ListId, ListEntryDto[]>): ReadonlyMap<number, EntryOrigin> {
    const found = new Map<number, EntryOrigin>();
    for (const listId of LIST_IDS) {
        for (const entry of lists[listId]) {
            if (!found.has(entry.game.id)) found.set(entry.game.id, { listId, entry });
        }
    }
    return found;
}

/**
 * Whether which list each game is in is known: neither loading nor failed to load. A membership write
 * is refused otherwise, since it would be decided from a game that only reads as in no list.
 */
function membershipKnown(state: ListsState): boolean {
    return !state.loading && state.error === null;
}

/**
 * The actions a mutation raises about itself — its lock, its undo and its failure — every one stamped with
 * the session the mutation began under, never the one current when it lands (`ListsState.session`).
 */
function stamped(dispatch: Dispatch<ListsAction>, session: string | null) {
    return {
        startPending: (gameId: number) => dispatch({ type: 'START_PENDING', session, gameId }),
        endPending: (gameId: number) => dispatch({ type: 'END_PENDING', session, gameId }),

        /** Undoes one game's optimistic change and says why, for whichever way the request failed (`answer`). */
        rollBack: (undo: () => void, error: string) => {
            undo();
            dispatch({ type: 'MUTATION_ERROR', session, error });
        },

        /** Puts one game back in the list it came from, or off the lists if it was in none. */
        restore: (origin: EntryOrigin | null, gameId: number) => () => {
            if (origin) {
                dispatch({ type: 'PLACE_ENTRY', session, listId: origin.listId, entry: origin.entry });
            } else {
                dispatch({ type: 'DROP_ENTRY', session, gameId });
            }
        },
    };
}

/** Sends the whole preference set, matching the endpoint's replace-wholesale contract. */
function persistPreferences(view: ViewMode, sorts: Partial<Record<ListId, SortState>>) {
    void apiFetch('/api/user/list-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
}

/**
 * A write's request, answered: the response, or null for a request that never arrived.
 *
 * The two ways a request fails are not interchangeable, and only one of them used to be handled: a request
 * that arrives and is refused returns `!res.ok`, but a request that never arrives — the API down, the
 * connection dropped — makes `fetch` *reject*. Without a `catch`, that left the optimistic change standing
 * as though it had been saved, and escaped as an unhandled rejection, since every caller fires these with
 * `void`.
 */
async function answer(send: () => Promise<Response>): Promise<Response | null> {
    try {
        return await send();
    } catch {
        return null;
    }
}

/**
 * Commits what a write raises once its request has answered — its all-clear or its undo, and its lock
 * released — in one render, before the write resolves, and answers what `complete` answers.
 *
 * A write reads the render last committed (`Committed`). Raised as they were, outside any event, the
 * answer's actions waited for a render React schedules for later, and a write its caller made as soon as
 * this one resolved — another save of the same game, once the first had landed — found the first's lock
 * still held and was refused, or found its row as the first had left it before the answer.
 * `docs/decisions/0086-*`.
 */
function settle<T>(complete: () => T): T {
    return flushSync(complete);
}

/**
 * Which games have a write out, as the store `useListPending` subscribes to: the set the provider last
 * committed, published as that commit is laid out, so that a lock taken or released draws again only the
 * components that show that game's (`ListsPending`).
 */
function createPendingStore(): ListsPending & { publish: (next: ReadonlySet<number>) => void } {
    let current: ReadonlySet<number> = new Set();
    const listeners = new Set<() => void>();
    return {
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        current: () => current,
        publish: next => {
            if (next === current) return;
            current = next;
            for (const listener of listeners) listener();
        },
    };
}

/**
 * The render React last committed, as far as an action reads it: the provider's state, the account, and
 * where each game was in it.
 */
interface Committed {
    state: ListsState;
    session: string | null;
    located: ReadonlyMap<number, EntryOrigin>;
}

/**
 * The lists the server sent, with every game that has a write in flight left as this client has it.
 *
 * A second fetch for the same account — a `reload`, or the one `AuthProvider` causes by handing the
 * provider a new user object — can land while a move, a removal or a score is still out, carrying
 * an answer composed before that write. Taken as it stands it puts the game back where it was, and
 * the write's success then changes nothing on screen, so a move that worked looks undone until the
 * next page load. `useGameAxis` does the same for the wishlist and the favourites. The pending set
 * is per game, so nothing else in the answer is held back.
 */
function reconciled(
    loaded: Record<ListId, ListEntryDto[]>,
    state: ListsState,
): Record<ListId, ListEntryDto[]> {
    if (state.pending.size === 0) return loaded;
    const located = locateAll(state.lists);
    let lists = loaded;
    for (const gameId of state.pending) {
        const held = located.get(gameId);
        lists = without(lists, gameId);
        if (held) lists[held.listId] = [...lists[held.listId], held.entry];
    }
    return lists;
}

export function ListsProvider({ children }: { children: ReactNode }) {
    const { user, loading: authLoading } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);
    const [reloadToken, setReloadToken] = useState(0);

    /**
     * The account every mutation below stamps its actions with — see `ListsState.session` for what
     * that protects against.
     *
     * A mutation reads it once, as it starts, from the render React last committed (`committed`, below),
     * and stamps everything it raises with that, its completion and its undo included. Never at
     * completion time: by then it may name the account that replaced the one the mutation was for, and
     * the reducer's guard would let the undo through.
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
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load list preferences (${res.status})`);
                return res.json() as Promise<ApiPreferencesResponse>;
            })
            .then(data => {
                if (controller.signal.aborted) return;
                const sorts: Partial<Record<ListId, SortState>> = {};
                for (const [id, sort] of Object.entries(data.sorts) as [ListId, { sortKey: SortState['key']; descending: boolean }][]) {
                    sorts[id] = { key: sort.sortKey, descending: sort.descending };
                }
                dispatch({ type: 'PREFERENCES_LOADED', session: fetchSession, view: data.view, sorts, names: data.names ?? {} });
            })
            .catch(() => {
                // No error state over the user's actual lists — the defaults are a perfectly good
                // fallback for a sort and a label. Recorded all the same, for the one consumer that
                // must not treat the defaults as the truth: the form that renames the lists.
                if (!controller.signal.aborted) dispatch({ type: 'PREFERENCES_FAILED', session: fetchSession });
            });

        return () => controller.abort();
    }, [user, authLoading, reloadToken]);

    /**
     * The state and the account of the render React last committed, which is what every action below
     * reads when it is called. That is what lets each action be the same function for as long as the
     * provider is mounted, so that a memoised row or card handed one is not drawn again because some
     * other game changed (`docs/decisions/0086-*`).
     *
     * Written as the commit is made, never during render: React can throw away a render it never
     * commits, and a marker moved by one would name an account that never arrived (ADR 0022 §8). In an
     * insertion effect, because those run while the commit is applied, before any layout or passive
     * effect of it, every component's. So no effect can call an action in between and read the render
     * before. The one exception is the insertion effects of the components below this one, which React
     * runs first; none may call a write.
     *
     * It is not a ref standing in for the state. The account is still in the reducer, every action a
     * mutation raises still carries the session the mutation began under, and the reducer still drops one
     * that no longer matches. What an action used to find in the closure of the render that drew its
     * button, it now reads when the button is pressed, from that same render.
     */
    const located = useMemo(() => locateAll(state.lists), [state.lists]);
    const committed = useRef<Committed>({ state, session, located });
    useInsertionEffect(() => {
        committed.current = { state, session, located };
    }, [state, session, located]);

    // The locks, published for whoever shows one as this commit is laid out, which is the first moment a
    // store may tell a component to draw again. The same store for as long as the provider is mounted.
    const [pending] = useState(createPendingStore);
    useLayoutEffect(() => {
        pending.publish(state.pending);
    }, [pending, state.pending]);

    // The same account asking again: `FETCH_START` keeps the lists on screen, and the answer goes
    // through `reconciled` so a write still on its way is not undone by it.
    const reload = useCallback(() => setReloadToken(token => token + 1), []);

    const setView = useCallback((view: ViewMode) => {
        const { state } = committed.current;
        dispatch({ type: 'SET_VIEW', view });
        persistPreferences(view, state.sorts);
    }, []);

    const setSort = useCallback((listId: ListId, sort: SortState) => {
        const { state } = committed.current;
        dispatch({ type: 'SET_SORT', listId, sort });
        persistPreferences(state.view, { ...state.sorts, [listId]: sort });
    }, []);

    // A hand order stored for a list that does not offer one — written by hand against the API, or
    // left behind if a list stops offering it — reads as the default rather than as a sort the
    // toolbar has no option for.
    const sortFor = useCallback((listId: ListId): SortState => {
        const sort = state.sorts[listId] ?? DEFAULT_SORT;
        return sort.key === MANUAL_SORT.key && !HAND_ORDERED_LISTS.includes(listId) ? DEFAULT_SORT : sort;
    }, [state.sorts]);

    const nameFor = useCallback(
        (listId: ListId): string => state.names[listId] ?? LIST_NAMES[listId],
        [state.names],
    );

    /**
     * Saves every name at once, and adopts the names the server says it stored — normalised there,
     * so a name typed with a double space is shown as it will be read back.
     *
     * Not optimistic. A rename is typed into a form and saved with a button, and a refusal has to
     * leave the form as the user typed it with a message beside the field, which a name already
     * applied across the site would contradict.
     */
    const saveListNames = useCallback(async (names: ListNames): Promise<SaveListNamesResult> => {
        const { session } = committed.current;
        const failed: SaveListNamesResult = {
            ok: false,
            fieldErrors: {},
            error: 'Failed to save your list names. Please try again.',
        };

        try {
            const res = await apiFetch('/api/user/list-names', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    names: LIST_IDS.map(id => ({ status: id, name: names[id] ?? null })),
                }),
            });

            if (res.ok) {
                const saved = await res.json() as { names: ListNames };
                dispatch({ type: 'NAMES_SAVED', session, names: saved.names });
                return { ok: true };
            }

            if (res.status === 400) {
                // A ValidationProblemDetails keyed by status key, one message per refused list.
                const problem = await res.json() as { errors?: Record<string, string[]> };
                const fieldErrors: Partial<Record<ListId, string>> = {};
                for (const [key, messages] of Object.entries(problem.errors ?? {})) {
                    const id = LIST_IDS.find(listId => listId.toLowerCase() === key.toLowerCase());
                    if (id && messages.length > 0) fieldErrors[id] = messages[0];
                }
                return Object.keys(fieldErrors).length > 0
                    ? { ok: false, fieldErrors, error: null }
                    : failed;
            }

            return failed;
        } catch {
            // Unreachable, or a body that was not the JSON it claimed to be.
            return failed;
        }
    }, []);

    const addToList = useCallback(async (listId: ListId, game: GameDto): Promise<boolean> => {
        const { state, session, located } = committed.current;
        const { startPending, endPending, rollBack, restore } = stamped(dispatch, session);
        if (!membershipKnown(state) || state.pending.has(game.id)) return false;
        startPending(game.id);

        // Only this game's own row is remembered, never the whole set of lists — see
        // docs/decisions/0022-*, decision 6. Its correctness rests on the pending set: no other
        // mutation can be moving this game while this one holds its id, so what is captured here
        // stays true for as long as it takes to undo.
        const origin = located.get(game.id) ?? null;

        // A move carries the existing entry across so the score does not blink out and back. Not its
        // place in a hand order, which the server clears on any change of list: the game arrives at
        // the end of the one it joins, as `byHand` reads a game with no position.
        const now = new Date().toISOString();
        const moved: ListEntryDto = origin
            ? { ...origin.entry, statusChangedAt: now, position: origin.listId === listId ? origin.entry.position : null }
            : { game, score: null, addedAt: now, statusChangedAt: now, position: null, tagIds: [] };

        // Appended rather than placed: a game just moved to a list is the most recent thing in it.
        dispatch({ type: 'PLACE_ENTRY', session, listId, entry: moved });

        const undo = restore(origin, game.id);

        const res = await answer(() => apiFetch(`/api/lists/${game.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: listId }),
        }));

        return settle(() => {
            const saved = res !== null && res.ok;
            if (saved) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else rollBack(undo, 'Failed to update list. Please try again.');
            endPending(game.id);
            return saved;
        });
    }, []);

    const removeFromList = useCallback(async (listId: ListId, gameId: number): Promise<boolean> => {
        const { state, session } = committed.current;
        const { startPending, endPending, rollBack, restore } = stamped(dispatch, session);
        if (!membershipKnown(state) || state.pending.has(gameId)) return false;
        startPending(gameId);

        const found = state.lists[listId].find(entry => entry.game.id === gameId);
        const removed = found ? { listId, entry: found } : null;
        dispatch({ type: 'DROP_ENTRY', session, gameId });

        const undo = restore(removed, gameId);

        const res = await answer(() => apiFetch(`/api/lists/${gameId}`, { method: 'DELETE' }));

        return settle(() => {
            const saved = res !== null && res.ok;
            if (saved) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else rollBack(undo, 'Failed to remove from list. Please try again.');
            endPending(gameId);
            return saved;
        });
    }, []);

    /**
     * Writes fields of a game's row through its entry — its score, its tags — shown at once wherever the
     * game sits and put back if the save fails.
     *
     * Under the per-game lock, because the row is the one a move writes: two scores set in quick
     * succession could otherwise both be in flight, and the first one failing would roll the second back
     * to a value neither had asked for; and a move of the same game rolling back would put its row back as
     * it was captured, fields and all, over a save that had succeeded. The undo puts back these fields of
     * this game and nothing else, from the values captured under that lock.
     *
     * The entry may be in no list at all, in which case there is nothing on screen to update and the
     * request is the whole of it — a caller holding its own copy reverts it on a failure.
     *
     * A refusal is answered with the server's own sentence where it gave one (`errors` in its
     * `ValidationProblemDetails`), which is the one worth showing; otherwise with `failure`.
     */
    const writeRowFields = useCallback(async (
        gameId: number,
        fields: RowFields,
        send: () => Promise<Response>,
        failure: string,
    ): Promise<SaveResult> => {
        const { state, session, located } = committed.current;
        const { startPending, endPending, rollBack } = stamped(dispatch, session);
        if (state.pending.has(gameId)) {
            return { ok: false, error: 'Another change to this game is still saving. Please try again.' };
        }
        startPending(gameId);

        const row = located.get(gameId)?.entry;
        const previous: RowFields | null = row === undefined
            ? null
            : Object.fromEntries(Object.keys(fields).map(key => [key, row[key as keyof RowFields]]));
        dispatch({ type: 'SET_ENTRY_FIELDS', session, gameId, fields });

        const undo = () => {
            if (previous !== null) dispatch({ type: 'SET_ENTRY_FIELDS', session, gameId, fields: previous });
        };

        const res = await answer(send);
        // The refusal's own sentence is read before anything is put back, so that the undo, the sentence
        // and the lock released are one render.
        const error = res === null ? failure : res.ok ? null : await refusal(res, failure);

        return settle((): SaveResult => {
            if (error === null) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else rollBack(undo, error);
            endPending(gameId);
            return error === null ? { ok: true } : { ok: false, error };
        });
    }, []);

    const setScore = useCallback(async (gameId: number, score: number | null): Promise<boolean> => {
        const result = await writeRowFields(
            gameId,
            { score },
            () => apiFetch(`/api/entries/${gameId}/score`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ score }),
            }),
            'Failed to save your score. Please try again.',
        );
        return result.ok;
    }, [writeRowFields]);

    /**
     * Moves a game in a list's hand order to sit right after another, or first when that is null.
     *
     * `planMove` decides which positions to write — the moved game's, and only rarely a few of its
     * neighbours' — and every game those writes touch takes its per-game lock, because a position is
     * a column of the entry row like a score: with two writes out for one game, the first to fail
     * would roll back over the second. A move that would need a game whose own write is still out is
     * refused rather than queued, and returns false having changed nothing; that is a neighbour in a
     * spread or a passed unplaced game, since the moved game's own handle is inert while it is busy.
     *
     * The undo puts back the position each of those games had, which is exact for the reason the lock
     * gives: nothing else can have moved them while this request was out.
     *
     * The steps are `moveInHandOrder`'s, which the favourites' move runs too; what is this provider's is
     * the list's hand order, its locks, and its actions — a refusal or a failure in the page's banner.
     */
    const moveInOrder = useCallback((listId: ListId, gameId: number, afterGameId: number | null): Promise<boolean> => {
        const { state, session } = committed.current;
        const { startPending, endPending } = stamped(dispatch, session);
        return moveInHandOrder({
            ordered: sortEntries(state.lists[listId], MANUAL_SORT)
                .map(entry => ({ id: entry.game.id, position: entry.position })),
            gameId,
            afterGameId,
            endpoint: `/api/lists/${listId}/positions`,
            saving: id => state.pending.has(id),
            lock: startPending,
            unlock: endPending,
            show: positions => dispatch({ type: 'SET_POSITIONS', session, listId, positions }),
            fail: error => dispatch({ type: 'MUTATION_ERROR', session, error }),
            saved: () => dispatch({ type: 'CLEAR_MUTATION_ERROR', session }),
            failed: 'Failed to save your order. Please try again.',
            settle,
        });
    }, []);

    /**
     * Writes one of the entry's own fields — how the user has the game, or their notes on it.
     *
     * Under the per-game lock, because the row is the one a move or a score writes: with two
     * requests out for one entry, a failure could be taken for the other's, and a delete racing a
     * write could have the write recreate the row it just removed. Nothing optimistic happens here —
     * no list shows either field — so the caller keeps the value on screen and reverts it on false.
     */
    const writeEntryField = useCallback(async (
        gameId: number,
        field: 'ownership' | 'notes',
        body: Record<string, unknown>,
        failure: string,
    ): Promise<boolean> => {
        const { state, session } = committed.current;
        const { startPending, endPending } = stamped(dispatch, session);
        if (state.pending.has(gameId)) return false;
        startPending(gameId);

        const res = await answer(() => apiFetch(`/api/entries/${gameId}/${field}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }));

        return settle(() => {
            const saved = res !== null && res.ok;
            if (saved) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else dispatch({ type: 'MUTATION_ERROR', session, error: failure });
            endPending(gameId);
            return saved;
        });
    }, []);

    const setOwnership = useCallback(
        (gameId: number, ownership: Ownership | null): Promise<boolean> =>
            writeEntryField(gameId, 'ownership', { ownership }, 'Failed to save how you have this game. Please try again.'),
        [writeEntryField],
    );

    const setNotes = useCallback(
        (gameId: number, notes: string | null): Promise<boolean> =>
            writeEntryField(gameId, 'notes', { notes }, 'Failed to save your notes. Please try again.'),
        [writeEntryField],
    );

    /** Replaces the game's tags with this set — the whole set, in one request (ADR 0065). */
    const setTags = useCallback(
        (gameId: number, tagIds: number[]): Promise<SaveResult> =>
            writeRowFields(
                gameId,
                { tagIds },
                () => apiFetch(`/api/entries/${gameId}/tags`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tagIds }),
                }),
                'Failed to save your tags. Please try again.',
            ),
        [writeRowFields],
    );

    const deleteEntry = useCallback(async (gameId: number): Promise<boolean> => {
        const { state, session, located } = committed.current;
        const { startPending, endPending, rollBack, restore } = stamped(dispatch, session);
        if (state.pending.has(gameId)) return false;
        startPending(gameId);

        const origin = located.get(gameId) ?? null;
        dispatch({ type: 'DROP_ENTRY', session, gameId });

        const undo = restore(origin, gameId);

        const res = await answer(() => apiFetch(`/api/entries/${gameId}`, { method: 'DELETE' }));

        return settle(() => {
            // 404 means there was nothing recorded, which is the state the caller wanted anyway.
            const deleted = res !== null && (res.ok || res.status === 404);
            if (deleted) dispatch({ type: 'CLEAR_MUTATION_ERROR', session });
            else rollBack(undo, 'Failed to remove your data. Please try again.');
            endPending(gameId);
            return deleted;
        });
    }, []);

    // The readers are called during render, so they read the state of the render calling them, and change
    // with it: a card that asks after its game is drawn again when the answer can have changed.

    const isInList = useCallback(
        (listId: ListId, gameId: number): boolean => located.get(gameId)?.listId === listId,
        [located],
    );

    const getListFor = useCallback(
        (gameId: number): ListId | null => located.get(gameId)?.listId ?? null,
        [located],
    );

    const scoreFor = useCallback(
        (gameId: number): number | null => located.get(gameId)?.entry.score ?? null,
        [located],
    );

    // The same object until something in it changes, so that a change of sort or of layout, or a save
    // that changes nothing a reader shows, draws none of the readers again.
    const lists = useMemo<ListsContextValue>(() => ({
        lists: state.lists,
        loading: state.loading,
        error: state.error,
        mutationError: state.mutationError,
        reload,
        pending,
        addToList,
        removeFromList,
        isInList,
        getListFor,
        scoreFor,
        setScore,
        moveInOrder,
        setOwnership,
        setNotes,
        setTags,
        deleteEntry,
        names: state.names,
        nameFor,
        namesStatus: state.namesStatus,
        saveListNames,
    }), [
        state.lists, state.loading, state.error, state.mutationError, state.names, state.namesStatus,
        reload, pending, addToList, removeFromList, isInList, getListFor, scoreFor, setScore, moveInOrder,
        setOwnership, setNotes, setTags, deleteEntry, nameFor, saveListNames,
    ]);

    const listView = useMemo<ListViewContextValue>(
        () => ({ view: state.view, setView, sortFor, setSort }),
        [state.view, setView, sortFor, setSort],
    );

    return (
        <ListsContext.Provider value={lists}>
            <ListViewContext.Provider value={listView}>
                {children}
            </ListViewContext.Provider>
        </ListsContext.Provider>
    );
}
