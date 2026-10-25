import { useContext, useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { SearchPacerContext } from '@/contexts/SearchPacerContext';
import type { GameDto } from '@/types/game';
import { searchApiPath } from '@/lib/gameBrowse';

/**
 * How a search for a game spends IGDB's budget: the navbar's typeahead, and the search an import's
 * review row opens for the game it names (§M4).
 *
 * IGDB is called at most four times a second by the whole of this API process (ADR 0034), and the
 * import's matcher draws on the same four, so a search asking once per keystroke would spend most of
 * it on one reader: forty words a minute is a keystroke every 300ms. And IGDB's search matches whole
 * words — "zel" and "hollow kn" find nothing, "zelda" and "hollow knight" find the games — so a
 * request made in the middle of a word is one spent on nothing. Four rules keep a typing reader to
 * one request a second at most, and mostly to one a finished word.
 *
 * - **The debounce decides when to ask:** once typing has paused for `SEARCH_DEBOUNCE_MS`. That is
 *   longer than the gap between two keystrokes of all but slow typing, so a word is rarely asked
 *   half-typed, and shorter than the gap around a space, which is two keystrokes long — the space
 *   itself leaves the trimmed term unchanged — so a finished word usually is asked.
 * - **The spacing decides how often:** never two starts within `SEARCH_SPACING_MS`, whatever the
 *   rhythm, and whichever search asks: they share one `SearchPacer`. A debounce alone does not bound
 *   the rate — a slow, steady typist whose every keystroke lands just past it would ask on every one.
 *   An aborted request still counts, because it may well have reached IGDB anyway.
 * - **Nothing under `MIN_SEARCH_LENGTH` characters is asked about.** Two rather than three, because
 *   some titles are two letters long — *Ys* is a series of a dozen games — and a third letter of a
 *   longer word is as much a partial word as the second.
 * - **An answer is remembered**, the last `REMEMBERED_TERMS` of them, so backspacing to a term
 *   already answered shows it again without asking. The API keeps its own copy of every search for
 *   half an hour, shared by everybody, so what does reach it rarely reaches IGDB twice.
 *
 * And when the API answers 503 — its own queue for IGDB is full — no search asks anything more, for
 * any term, for as long as the answer's `Retry-After` says (`holdFor`), and none asks by itself when
 * that is over: readers who were all told to wait at once would otherwise all ask again at once.
 */
export const SEARCH_DEBOUNCE_MS = 450;
export const SEARCH_SPACING_MS = 1000;
export const MIN_SEARCH_LENGTH = 2;
const REMEMBERED_TERMS = 20;

/** How many games the dropdown lists: the first of the browse page's own results. */
export const TYPEAHEAD_SIZE = 6;

/** The most a search can list: the browse page's whole page, which the API's `limit` only cuts short. */
export const SEARCH_PAGE_SIZE = 20;

/**
 * The longest term a search takes, as the import's matcher bounds its own (`ImportTitle`): past this
 * a term is a paste accident rather than a name, and every request stays well inside a URL's limits.
 */
export const MAX_SEARCH_LENGTH = 120;

/** A 503's wait when it names none, and the longest one honoured. */
const DEFAULT_HOLD_MS = 5_000;
const MAX_HOLD_MS = 30_000;

/** Said when the API cannot be reached at all, so there is no body to read a sentence from. */
export const SEARCH_UNREACHABLE = 'Search is unavailable right now. Try again in a moment.';

/**
 * Said when the API refused the question itself (a 4xx). Asking it again would get the same answer,
 * so nothing offers to.
 */
export const SEARCH_REFUSED = 'That search could not be run.';

export interface SearchAnswer {
    games: GameDto[];
    /** Whether the browse page has more for this search than the answer lists. */
    hasMore: boolean;
}

/** What a search knows about its current term. */
export type GameSearch =
    /** Nothing to ask about: the search is closed, or the term is too short. */
    | { status: 'idle'; term: string }
    /** Waiting out the debounce or the spacing, or for the API to answer. */
    | { status: 'waiting'; term: string }
    | { status: 'answered'; term: string; answer: SearchAnswer }
    /**
     * `canRetry` is false while a 503's wait runs, and after a refusal no retry can change. `busy`
     * says the failure is a 503's, whose retry is offered only once its wait is over.
     */
    | { status: 'failed'; term: string; message: string; canRetry: boolean; busy: boolean };

/** A 503's sentence, while its wait runs. */
interface Hold {
    message: string;
}

/**
 * What a search spends: when its last request started, for the spacing, and a 503's wait. Every
 * search shares the one `SearchPacerProvider` holds, because the budget is the reader's rather than
 * the field's — with a clock each, opening one import row's search after another started two requests
 * within half a second, and a row opened during another row's 503 asked at once. A search outside the
 * provider, as a test renders one, keeps its own.
 *
 * A small external store, so that a hold reaches every search sharing it the moment it is set and the
 * moment it ends. Its timer is its own rather than any one search's, so a hold set by a search that
 * has since closed still runs out.
 */
export interface SearchPacer {
    subscribe: (listener: () => void) => () => void;
    /** The hold, or null. The same object for as long as it lasts. */
    held: () => Hold | null;
    /** How long a search that is ready to ask should wait: the debounce, or what is left of the spacing. */
    delay: () => number;
    /**
     * What is left of the spacing now. A search checks again when it is due, because another can have
     * started meanwhile: the navbar's and a row's can both be waiting at once, which two rows never are.
     */
    remaining: () => number;
    /** A request starts now. Counted whether or not it is later abandoned. */
    started: () => void;
    hold: (message: string, ms: number) => void;
}

export function createSearchPacer(): SearchPacer {
    const listeners = new Set<() => void>();
    let lastStart = Number.NEGATIVE_INFINITY;
    let current: Hold | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const notify = () => listeners.forEach(listener => listener());

    // Never more than the spacing itself, and none once the clock has been set back past the last
    // start, so a clock set back cannot stall a search.
    const remaining = () => {
        const since = Date.now() - lastStart;
        return since < 0 ? 0 : Math.max(0, SEARCH_SPACING_MS - since);
    };

    return {
        subscribe: listener => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        held: () => current,
        delay: () => Math.max(SEARCH_DEBOUNCE_MS, remaining()),
        remaining,
        started: () => {
            lastStart = Date.now();
        },
        hold: (message, ms) => {
            clearTimeout(timer);
            current = { message };
            timer = setTimeout(() => {
                current = null;
                notify();
            }, ms);
            notify();
        },
    };
}

interface Failure {
    /** The term it stands for. */
    term: string;
    message: string;
    retryable: boolean;
    /** A 503, or a term the field moved to while one's wait ran. */
    busy: boolean;
}

interface State {
    /** Answers by term, oldest first. */
    answers: ReadonlyMap<string, SearchAnswer>;
    failure: Failure | null;
}

type Action =
    | { type: 'answered'; term: string; answer: SearchAnswer }
    | { type: 'failed'; failure: Failure }
    | { type: 'forget-failure' };

/** What one request came to: an action, or a 503 with the wait it asked for. */
type Asked = Action | { type: 'busy'; term: string; message: string; hold: number };

const INITIAL: State = { answers: new Map(), failure: null };

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'answered': {
            const answers = new Map(state.answers);
            answers.delete(action.term);
            answers.set(action.term, action.answer);
            for (const oldest of answers.keys()) {
                if (answers.size <= REMEMBERED_TERMS) break;
                answers.delete(oldest);
            }
            return { answers, failure: state.failure?.term === action.term ? null : state.failure };
        }
        case 'failed':
            return { ...state, failure: action.failure };
        case 'forget-failure':
            return state.failure === null ? state : { ...state, failure: null };
    }
}

const failed = (term: string, message: string, retryable = true): Action =>
    ({ type: 'failed', failure: { term, message, retryable, busy: false } });

/** The sentence a failed response carries, or a plain one when it carries none. */
async function problem(response: Response): Promise<string> {
    try {
        const body: unknown = await response.json();
        if (typeof body === 'object' && body !== null) {
            const { detail, title } = body as { detail?: unknown; title?: unknown };
            if (typeof detail === 'string' && detail !== '') return detail;
            if (typeof title === 'string' && title !== '') return title;
        }
    } catch {
        // Not a ProblemDetails — a balancer's 503 has no body — which leaves the plain sentence.
    }
    return SEARCH_UNREACHABLE;
}

/**
 * How long a 503 asks to be left alone: its `Retry-After` in seconds, held between a second and
 * `MAX_HOLD_MS`, or `DEFAULT_HOLD_MS` when it gives none. The limiter's own figure can be long — a
 * queue sixty-four deep drains in sixteen seconds — and a search shut for longer than the reader will
 * wait is one they stop using.
 */
function holdFor(response: Response): number {
    const seconds = Number(response.headers.get('Retry-After'));
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_HOLD_MS;
    return Math.min(Math.max(wait, 1000), MAX_HOLD_MS);
}

/**
 * Whether an item has every field a listed game is drawn with, as the type it is read as: `null` or a
 * value, exactly as the API writes them. The dropdown's row and the import's candidate read the same
 * six; the rest of a `GameDto` is never shown from a search, and checking it would refuse an answer
 * over a field that cannot break anything.
 */
function isListedGame(item: unknown): item is GameDto {
    if (typeof item !== 'object' || item === null) return false;
    const game = item as Record<keyof GameDto, unknown>;
    const nullOr = (value: unknown, type: 'string' | 'number') => value === null || typeof value === type;
    return typeof game.id === 'number'
        && typeof game.title === 'string'
        && nullOr(game.releaseDate, 'string')
        && nullOr(game.coverImageUrl, 'string')
        && nullOr(game.criticScore, 'number')
        && nullOr(game.criticScoreCount, 'number');
}

/**
 * One request, settled as what it calls for. Never rejects: a request aborted because the term moved
 * on settles as a failure too, which the caller drops unread.
 *
 * Plain `fetch` with the default credentials, not `credentials: 'omit'`: `/api/games` is not one of the
 * endpoints the dev site's basic auth lets through, and the browser sends that only with credentials.
 */
async function ask(term: string, size: number, signal: AbortSignal): Promise<Asked> {
    let response: Response;
    try {
        response = await fetch(searchApiPath(term, size), { signal });
    } catch {
        return failed(term, SEARCH_UNREACHABLE);
    }

    if (response.status === 503 || response.status === 429) {
        return { type: 'busy', term, message: await problem(response), hold: holdFor(response) };
    }
    if (response.status >= 400 && response.status < 500) return failed(term, SEARCH_REFUSED, false);
    if (!response.ok) return failed(term, await problem(response));

    try {
        const page: unknown = await response.json();
        const { items, hasMore } = (page ?? {}) as { items?: unknown; hasMore?: unknown };
        // Checked rather than trusted, game by game, because the answer is rendered in the navbar of
        // every page, where a crash takes the page with it, and as buttons that write a game into
        // somebody's import. One game that is not what a row reads fails the answer whole, as
        // unreachable: listing the rest would pass a broken API off as a search that found less. Cut
        // to size as well: an API older than this client, mid-deploy, ignores `limit` and sends a
        // whole page.
        if (!Array.isArray(items) || !items.every(isListedGame)) return failed(term, SEARCH_UNREACHABLE);
        return {
            type: 'answered',
            term,
            answer: { games: items.slice(0, size), hasMore: hasMore === true || items.length > size },
        };
    } catch {
        return failed(term, SEARCH_UNREACHABLE);
    }
}

export interface GameSearchOptions {
    /** How many games to ask for, up to `SEARCH_PAGE_SIZE`. The dropdown's `TYPEAHEAD_SIZE` unless said. */
    size?: number;
}

/**
 * IGDB's answer for whatever is in a search's field, asked for under the rules above.
 *
 * `enabled` is whether anybody is looking: a search that is closed asks nothing, and closing it
 * abandons the request in flight. Every answer is filed under the term it was asked for, and only the
 * current term's is shown. An answer to a term the field has moved on from is dropped whole with its
 * aborted request, a 503 included; one that lands in the instant before the abort is filed under its
 * own term. Either way it cannot stand in for the current term's — which is what stops a slow answer
 * to "resident" being chosen from under "resident evil 2".
 *
 * Nothing here is account-scoped: IGDB's catalogue reads the same for everybody, and what is chosen
 * from it goes through its caller's own write, which carries its own guard.
 *
 * `retry` asks again after a failure. Editing the term, or closing and reopening the search, does
 * too: a failure stands only for the term it happened to, while the search is open on it — except a
 * 503's, which every term the field moves to takes while its wait runs, so that nothing is asked until
 * the wait is over and the reader asks.
 */
export function useGameSearch(
    query: string,
    enabled: boolean,
    { size = TYPEAHEAD_SIZE }: GameSearchOptions = {},
): GameSearch & { retry: () => void } {
    const term = query.trim();
    const [state, dispatch] = useReducer(reducer, INITIAL);

    const [own] = useState(createSearchPacer);
    const shared = useContext(SearchPacerContext) ?? own;
    const held = useSyncExternalStore(shared.subscribe, shared.held, shared.held);

    const active = enabled && term.length >= MIN_SEARCH_LENGTH;
    const answer = state.answers.get(term);
    const failure = state.failure;
    const standing = failure !== null && failure.term === term && enabled ? failure : null;

    // Both idempotent by their condition, so React re-renders at once and nothing loops.
    if (failure !== null && standing === null) {
        dispatch({ type: 'forget-failure' });
    } else if (held !== null && active && answer === undefined && standing === null) {
        dispatch({ type: 'failed', failure: { term, message: held.message, retryable: true, busy: true } });
    }

    const settled = !active || answer !== undefined || standing !== null || held !== null;

    useEffect(() => {
        if (settled) return;

        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;

        // The spacing is checked again when the search is due, not only now: another search may have
        // started in between.
        const due = () => {
            const left = shared.remaining();
            if (left > 0) {
                timer = setTimeout(due, left);
                return;
            }

            shared.started();
            void ask(term, size, controller.signal).then(asked => {
                if (controller.signal.aborted) return;

                if (asked.type === 'busy') {
                    shared.hold(asked.message, asked.hold);
                    dispatch({
                        type: 'failed',
                        failure: { term: asked.term, message: asked.message, retryable: true, busy: true },
                    });
                } else {
                    dispatch(asked);
                }
            });
        };
        timer = setTimeout(due, shared.delay());

        // The term moved on, the search closed, or an answer came: whatever is still waiting or in
        // flight is no longer wanted. The API cancels its IGDB call when the connection drops, but
        // only a direct connection is sure to drop — the dev server's proxy does not pass an abort
        // on, and that call completes — so the spacing counts every request from its start.
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [term, settled, shared, size]);

    const retry = () => dispatch({ type: 'forget-failure' });

    if (!active) return { status: 'idle', term, retry };
    if (answer !== undefined) return { status: 'answered', term, answer, retry };
    if (standing !== null) {
        return {
            status: 'failed',
            term,
            message: standing.message,
            canRetry: standing.retryable && held === null,
            busy: standing.busy,
            retry,
        };
    }
    return { status: 'waiting', term, retry };
}
