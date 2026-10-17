import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { apiFetch } from '@/lib/api';
import { EMPTY_BROWSE, gamesApiPath } from '@/lib/gameBrowse';
import type { GameDto } from '@/types/game';

/**
 * How a review row's search for its game spends IGDB's budget (§M4).
 *
 * IGDB is called at most four times a second by the whole of this API process (ADR 0034), and the
 * matcher's own passes draw on the same four. A search asking once per keystroke would spend most
 * of that on one person: forty words a minute is a keystroke every 300ms. IGDB's search is not
 * fuzzy (ADR 0040), and it matches whole words — "hollow kn" and "zeld" find nothing, measured by
 * the navbar typeahead in pull request 270 and again for this — so a request made in the middle of
 * a word is one spent on nothing. Four rules keep a person to one request a second at most, and
 * mostly to one a finished word.
 *
 * - **The debounce decides when to ask:** once typing has paused for `SEARCH_DEBOUNCE_MS`. Longer
 *   than the gap between two keystrokes of all but slow typing, so a word is rarely asked
 *   half-typed, and shorter than the pause around a space, which is two keystrokes long because
 *   the space itself leaves the trimmed term unchanged — so a finished word usually is asked.
 * - **The spacing decides how often:** never two starts within `SEARCH_SPACING_MS` on one page,
 *   whatever the rhythm and whichever row's search asks (`SearchPacer`). A debounce alone does not
 *   bound the rate — a slow, steady typist whose every keystroke lands just past it would ask on
 *   every one. An aborted request still counts: the dev server's proxy does not pass an abort on,
 *   so an abandoned search still completes its IGDB call (measured; see the pull request).
 * - **Nothing under `MIN_SEARCH_LENGTH` characters is asked about.** Two rather than three, because
 *   some titles are two letters long — *Ys* is a series of a dozen games.
 * - **An answer is remembered**, the last `REMEMBERED_TERMS` of them, so going back to a term
 *   already answered shows it again without asking. The API keeps its own copy of every search
 *   for half an hour, shared by everybody, so what does reach it rarely reaches IGDB twice.
 *
 * And when the API answers 503 — its own queue for IGDB is full — no search on the page asks
 * anything, for any term, for as long as the answer's `Retry-After` says (`holdFor`), and nothing
 * is asked by itself when that is over: people all told to wait at once would otherwise all ask
 * again at once.
 *
 * The numbers and the shape are those of the navbar's `useGameSearch` in pull request 270, which
 * measured them in a browser: at 300ms, "final fantasy" typed at 400ms a key made five requests,
 * three of them for partial words. The two are meant to become one hook once both have merged.
 * This one asks for the whole page of twenty the browse page shows, rather than a typeahead's six:
 * the person is choosing a game rather than glancing at suggestions, and IGDB's own order can put
 * the game they mean thirteenth (ADR 0040).
 */
export const SEARCH_DEBOUNCE_MS = 450;
export const SEARCH_SPACING_MS = 1000;
export const MIN_SEARCH_LENGTH = 2;
const REMEMBERED_TERMS = 20;

/**
 * The longest term asked about, as the import's matcher bounds its own (`ImportTitle`): past this a
 * term is a paste accident rather than a name, and every request stays well inside a URL's limits.
 */
export const MAX_SEARCH_LENGTH = 120;

/** A 503's wait when it names none, and the longest one honoured. */
const DEFAULT_HOLD_MS = 5_000;
const MAX_HOLD_MS = 30_000;

/** Said when the API cannot be reached at all, so there is no body to read a sentence from. */
export const SEARCH_UNREACHABLE = 'Search is unavailable right now. Try again in a moment.';

/**
 * Said when the API refused the question itself (a 4xx). Asking it again would get the same answer,
 * so nothing offers to. The only 4xx `/api/games` answers is the framework's validation 400, for
 * parameters this client never sends wrong, and its title says nothing a person could act on.
 */
export const SEARCH_REFUSED = 'That search could not be run.';

export interface SearchAnswer {
    games: GameDto[];
    /** Whether IGDB has more for this term than the page it answered with. */
    hasMore: boolean;
}

/** What the search knows about its current term. */
export type ImportSearch =
    /** Nothing to ask about: the search is closed, or the term is too short. */
    | { status: 'idle'; term: string }
    /** Waiting out the debounce or the spacing, or for the API to answer. */
    | { status: 'waiting'; term: string }
    | { status: 'answered'; term: string; answer: SearchAnswer }
    /**
     * `canRetry` is false while a 503's wait runs, and after a refusal no retry can change. `busy`
     * says it was a 503: a retry is offered only once its wait is over.
     */
    | { status: 'failed'; term: string; message: string; canRetry: boolean; busy: boolean };

/** A 503's sentence, while its wait runs. */
interface Hold {
    message: string;
}

/**
 * What every search on one page shares: when the last request started, for the spacing, and a
 * 503's wait. The budget is the person's rather than the field's — with a clock each, opening one
 * row's search after another started two requests within half a second, and a row opened during
 * another row's 503 asked at once.
 *
 * A small external store, so that a hold reaches every search on the page the moment it is set and
 * the moment it ends. Its timer is its own rather than any one search's, so a hold set by a row
 * that has since closed still runs out.
 */
export interface SearchPacer {
    subscribe: (listener: () => void) => () => void;
    /** The hold, or null. The same object for as long as it lasts. */
    held: () => Hold | null;
    /** How long a search that is ready to ask should wait: the debounce, or what is left of the spacing. */
    delay: () => number;
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

    return {
        subscribe: listener => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        held: () => current,
        // Never longer than the spacing itself, so a clock set back cannot stall the search.
        delay: () => Math.max(SEARCH_DEBOUNCE_MS, Math.min(SEARCH_SPACING_MS, lastStart + SEARCH_SPACING_MS - Date.now())),
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

/**
 * The sentence a failed response carries, or a plain one when it carries none. An IGDB outage is
 * the API's 502, whose `detail` says that game data comes from IGDB and that the person's own data
 * is unaffected (`UpstreamFailureHandler`) — the sentence the review screen shows for a failed
 * matching pass too.
 */
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
 * queue sixty-four deep drains in sixteen seconds — and a search shut for longer than the person
 * will wait is one they stop using.
 */
function holdFor(response: Response): number {
    const seconds = Number(response.headers.get('Retry-After'));
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_HOLD_MS;
    return Math.min(Math.max(wait, 1000), MAX_HOLD_MS);
}

/** What the browse page asks for the same term, so the two share the API's cached answer. */
function searchPath(term: string): string {
    return gamesApiPath(0, { ...EMPTY_BROWSE, search: term });
}

/**
 * One request, settled as what it calls for. Never rejects: a request aborted because the term
 * moved on settles as a failure too, which the caller drops unread.
 *
 * A search carries no floor and no order (ADR 0016, ADR 0032): it has to reach a game however
 * thinly reviewed, which is exactly the game a matcher could not place.
 */
async function ask(term: string, signal: AbortSignal): Promise<Asked> {
    let response: Response;
    try {
        response = await apiFetch(searchPath(term), { signal });
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
        // Checked rather than trusted: what comes back is rendered as buttons that write a game
        // into somebody's import, and a body that is not a page of games is a failure to say so.
        if (!Array.isArray(items)) return failed(term, SEARCH_UNREACHABLE);
        return { type: 'answered', term, answer: { games: items as GameDto[], hasMore: hasMore === true } };
    } catch {
        return failed(term, SEARCH_UNREACHABLE);
    }
}

/**
 * IGDB's answer for whatever is in a review row's search field, asked for under the rules above.
 *
 * `enabled` is whether the search is open: a closed one asks nothing, and closing it abandons the
 * request in flight. `pacer` is the page's, shared by every row's search; one used alone keeps its
 * own. Every answer is filed under the term it was asked for, and only the current term's is shown.
 * An answer to a request the field has moved on from is dropped whole with its aborted request, a
 * 503 included, so it cannot stand in for the current term's — which is what stops a slow answer
 * to "resident" being chosen from under "resident evil 2".
 *
 * Nothing here is account-scoped: IGDB's catalogue reads the same for everybody, and the choice made
 * from it goes through the review's own decision write, which carries its own guard.
 *
 * `retry` asks again after a failure. Editing the term, or closing and reopening the search, does
 * too: a failure stands only for the term it happened to, while the search is open on it. During a
 * 503's wait every term the field moves to takes the same failure, so nothing is asked until the
 * wait is over and somebody asks.
 */
export function useImportSearch(
    query: string,
    enabled: boolean,
    pacer?: SearchPacer,
): ImportSearch & { retry: () => void } {
    const term = query.trim();
    const [state, dispatch] = useReducer(reducer, INITIAL);

    const [own] = useState(createSearchPacer);
    const shared = pacer ?? own;
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
        const timer = setTimeout(() => {
            shared.started();
            void ask(term, controller.signal).then(asked => {
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
        }, shared.delay());

        // The term moved on, the search closed, or an answer came: whatever is still waiting or in
        // flight is no longer wanted. The API cancels its IGDB call when the connection drops, but
        // only a direct connection is sure to drop, so the spacing counts every request from its
        // start.
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [term, settled, shared]);

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
