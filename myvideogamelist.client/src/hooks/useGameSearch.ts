import { useEffect, useReducer, useRef } from 'react';
import type { GameDto } from '@/types/game';
import { searchApiPath } from '@/lib/gameBrowse';

/**
 * How the navbar's typeahead spends IGDB's budget.
 *
 * IGDB is called at most four times a second by the whole of this API process (ADR 0034), so a
 * typeahead asking once per keystroke would spend most of it on one reader: forty words a minute is
 * a keystroke every 300ms. And IGDB's search matches whole words — "zel" and "hollow kn" find
 * nothing, "zelda" and "hollow knight" find the games — so a request made in the middle of a word is
 * one spent on nothing. Four rules keep a typing reader to one request a second at most, and mostly
 * to one a finished word.
 *
 * - **The debounce decides when to ask:** once typing has paused for `SEARCH_DEBOUNCE_MS`. That is
 *   longer than the gap between two keystrokes of all but slow typing, so a word is rarely asked
 *   half-typed, and shorter than the gap around a space, which is two keystrokes long — the space
 *   itself leaves the trimmed term unchanged — so a finished word usually is asked.
 * - **The spacing decides how often:** never two starts within `SEARCH_SPACING_MS`, whatever the
 *   rhythm. A debounce alone does not bound the rate — a slow, steady typist whose every keystroke
 *   lands just past it would ask on every one. An aborted request still counts, because it may well
 *   have reached IGDB anyway.
 * - **Nothing under `MIN_SEARCH_LENGTH` characters is asked about.** Two rather than three, because
 *   some titles are two letters long — *Ys* is a series of a dozen games — and a third letter of a
 *   longer word is as much a partial word as the second.
 * - **An answer is remembered**, the last `REMEMBERED_TERMS` of them, so backspacing to a term
 *   already answered shows it again without asking. The API keeps its own copy of every search for
 *   half an hour, shared by everybody, so what does reach it rarely reaches IGDB twice.
 *
 * And when the API answers 503 — its own queue for IGDB is full — the box asks nothing more, for any
 * term, for as long as the answer's `Retry-After` says (`holdFor`), and does not ask by itself when
 * that is over: readers who were all told to wait at once would otherwise all ask again at once.
 */
export const SEARCH_DEBOUNCE_MS = 450;
export const SEARCH_SPACING_MS = 1000;
export const MIN_SEARCH_LENGTH = 2;
const REMEMBERED_TERMS = 20;

/** How many games the dropdown lists: the first of the browse page's own results. */
export const TYPEAHEAD_SIZE = 6;

/**
 * The longest term the box takes, as the import's matcher bounds its own (`ImportTitle`): past this a
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
 * so nothing offers to.
 */
export const SEARCH_REFUSED = 'That search could not be run.';

export interface SearchAnswer {
    games: GameDto[];
    /** Whether the browse page has more for this search than the dropdown shows. */
    hasMore: boolean;
}

/** What the box knows about its current term. */
export type GameSearch =
    /** Nothing to ask about: the box is closed, or the term is too short. */
    | { status: 'idle'; term: string }
    /** Waiting out the debounce or the spacing, or for the API to answer. */
    | { status: 'waiting'; term: string }
    | { status: 'answered'; term: string; answer: SearchAnswer }
    /** `canRetry` is false while a 503's wait runs, and after a refusal no retry can change. */
    | { status: 'failed'; term: string; message: string; canRetry: boolean };

interface Failure {
    /** The term it happened to, or null while it stands for whatever is in the box. */
    term: string | null;
    message: string;
    retryable: boolean;
    /** How long a 503 asked to be left alone, while that wait runs; null otherwise. */
    hold: number | null;
}

interface State {
    /** Answers by term, oldest first. */
    answers: ReadonlyMap<string, SearchAnswer>;
    failure: Failure | null;
}

type Action =
    | { type: 'answered'; term: string; answer: SearchAnswer }
    | { type: 'failed'; failure: Failure }
    | { type: 'hold-over' }
    | { type: 'pin-failure'; term: string }
    | { type: 'forget-failure' };

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
        case 'hold-over':
            return state.failure?.hold == null ? state : { ...state, failure: { ...state.failure, hold: null } };
        case 'pin-failure':
            return state.failure?.term !== null ? state : { ...state, failure: { ...state.failure, term: action.term } };
        case 'forget-failure':
            // A 503's wait outlasts anything that would otherwise forget it, a retry included.
            return state.failure === null || state.failure.hold !== null ? state : { ...state, failure: null };
    }
}

const failed = (term: string, message: string, retryable = true): Action =>
    ({ type: 'failed', failure: { term, message, retryable, hold: null } });

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
 * queue sixty-four deep drains in sixteen seconds — and a box shut for longer than the reader will
 * wait is a box they stop using.
 */
function holdFor(response: Response): number {
    const seconds = Number(response.headers.get('Retry-After'));
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_HOLD_MS;
    return Math.min(Math.max(wait, 1000), MAX_HOLD_MS);
}

/**
 * Whether an item has every field a row of the dropdown reads, as the type it reads it as: `null` or
 * a value, exactly as the API writes them. Only those fields — the rest of a `GameDto` is never shown
 * here, and checking it would refuse an answer over a field that cannot break anything.
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
 * One request, settled as the action it calls for. Never rejects: a request aborted because the term
 * moved on settles as a failure too, which the caller drops unread.
 *
 * Plain `fetch` with the default credentials, not `credentials: 'omit'`: `/api/games` is not one of the
 * endpoints the dev site's basic auth lets through, and the browser sends that only with credentials.
 */
async function ask(term: string, signal: AbortSignal): Promise<Action> {
    let response: Response;
    try {
        response = await fetch(searchApiPath(term, TYPEAHEAD_SIZE), { signal });
    } catch {
        return failed(term, SEARCH_UNREACHABLE);
    }

    if (response.status === 503 || response.status === 429) {
        const message = await problem(response);
        return { type: 'failed', failure: { term: null, message, retryable: true, hold: holdFor(response) } };
    }
    if (response.status >= 400 && response.status < 500) return failed(term, SEARCH_REFUSED, false);
    if (!response.ok) return failed(term, await problem(response));

    try {
        const page: unknown = await response.json();
        const { items, hasMore } = (page ?? {}) as { items?: unknown; hasMore?: unknown };
        // Checked rather than trusted, game by game, because the answer is rendered in the navbar of
        // every page and a crash there takes the page with it. One game that is not what a row reads
        // fails the answer whole, as unreachable: listing the rest would pass a broken API off as a
        // search that found less. Cut to size as well: an API older than this client, mid-deploy,
        // ignores `limit` and sends a whole page.
        if (!Array.isArray(items) || !items.every(isListedGame)) return failed(term, SEARCH_UNREACHABLE);
        return {
            type: 'answered',
            term,
            answer: {
                games: items.slice(0, TYPEAHEAD_SIZE),
                hasMore: hasMore === true || items.length > TYPEAHEAD_SIZE,
            },
        };
    } catch {
        return failed(term, SEARCH_UNREACHABLE);
    }
}

/**
 * The typeahead's answer for whatever is in the box, asked for under the rules above.
 *
 * `enabled` is whether anybody is looking: a box that is closed asks nothing, and closing it abandons
 * the request in flight. Every answer is filed under the term it was asked for, and only the current
 * term's is shown. An answer to a term the box has moved on from is dropped with its aborted request;
 * one that lands in the instant before the abort is filed under its own term. Either way it cannot
 * stand in for the current term's.
 *
 * `retry` asks again after a failure. Editing the term, or closing and reopening the box, does too: a
 * failure stands only for the term it happened to, while the box is open on it — except a 503's,
 * which stands for every term until its wait is over, and then for whatever is in the box.
 */
export function useGameSearch(query: string, enabled: boolean): GameSearch & { retry: () => void } {
    const term = query.trim();
    const [state, dispatch] = useReducer(reducer, INITIAL);

    // When the last request started, for the spacing. Written only when one starts, and read only
    // when the next is scheduled, both outside render.
    const lastStart = useRef(Number.NEGATIVE_INFINITY);

    const failure = state.failure;
    if (failure !== null && failure.hold === null) {
        if (failure.term === null) dispatch({ type: 'pin-failure', term });
        else if (failure.term !== term || !enabled) dispatch({ type: 'forget-failure' });
    }

    const active = enabled && term.length >= MIN_SEARCH_LENGTH;
    const answer = state.answers.get(term);
    const standing = failure !== null && (failure.term === null || failure.term === term) ? failure : null;
    const settled = !active || answer !== undefined || standing !== null;

    useEffect(() => {
        if (settled) return;

        const controller = new AbortController();
        // Never longer than the spacing itself, so a clock set back cannot stall the box.
        const spacing = Math.min(SEARCH_SPACING_MS, lastStart.current + SEARCH_SPACING_MS - Date.now());
        const timer = setTimeout(() => {
            lastStart.current = Date.now();
            void ask(term, controller.signal).then(action => {
                if (!controller.signal.aborted) dispatch(action);
            });
        }, Math.max(SEARCH_DEBOUNCE_MS, spacing));

        // The term moved on, the box closed, or an answer came: whatever is still waiting or in
        // flight is no longer wanted. The API cancels its IGDB call when the connection drops, but
        // only a direct connection is sure to drop — the dev server's proxy does not pass an abort
        // on, and that call completes — so the spacing counts every request from its start.
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [term, settled]);

    // A 503's wait, run out on a timer. What it leaves behind is a failure for whatever is in the box
    // by then, so nothing is asked until the reader types or asks again.
    const hold = failure?.hold ?? null;
    useEffect(() => {
        if (hold === null) return;
        const timer = setTimeout(() => dispatch({ type: 'hold-over' }), hold);
        return () => clearTimeout(timer);
    }, [hold]);

    const retry = () => dispatch({ type: 'forget-failure' });

    if (!active) return { status: 'idle', term, retry };
    if (answer !== undefined) return { status: 'answered', term, answer, retry };
    if (standing !== null) {
        const canRetry = standing.retryable && standing.hold === null;
        return { status: 'failed', term, message: standing.message, canRetry, retry };
    }
    return { status: 'waiting', term, retry };
}
