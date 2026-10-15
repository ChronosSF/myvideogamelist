import { useEffect, useReducer, useRef } from 'react';
import type { GameDto, PagedGamesResponse } from '@/types/game';
import { searchApiPath } from '@/lib/gameBrowse';

/**
 * How the navbar's typeahead spends IGDB's budget.
 *
 * IGDB is called at most four times a second by the whole of this API process (ADR 0034), so a
 * typeahead asking once per keystroke would spend most of it on one reader: forty words a minute is
 * a keystroke every 300ms. Four rules keep a typing reader to one request a second at most, and
 * usually fewer.
 *
 * - **The debounce decides when to ask:** once typing has paused for `SEARCH_DEBOUNCE_MS`. A fluent
 *   typist's keystrokes come faster than that within a word, so most of a word goes unasked.
 * - **The spacing decides how often:** never two starts within `SEARCH_SPACING_MS`, whatever the
 *   rhythm. A debounce alone does not bound the rate — a steady typist whose every keystroke lands
 *   just past it, which is ordinary typing on a phone, would ask on every one, three times a second.
 *   An aborted request still counts, because it may well have reached IGDB anyway.
 * - **Nothing under `MIN_SEARCH_LENGTH` characters is asked about.** Two rather than three, because
 *   IGDB matches whole words and some titles are two letters long — *Ys* is a series of a dozen
 *   games — while a third letter buys nothing: it is as much a partial word as the second.
 * - **An answer is remembered**, the last `REMEMBERED_TERMS` of them, so backspacing to a term
 *   already answered shows it again without asking. The API keeps its own copy of every search for
 *   half an hour, shared by everybody, so what does reach it rarely reaches IGDB twice.
 */
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_SPACING_MS = 1000;
export const MIN_SEARCH_LENGTH = 2;
const REMEMBERED_TERMS = 20;

/** How many games the dropdown lists: the first of the browse page's own results. */
export const TYPEAHEAD_SIZE = 6;

/** Said when the API cannot be reached at all, so there is no body to read a sentence from. */
export const SEARCH_UNREACHABLE = 'Search is unavailable right now. Try again in a moment.';

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
    | { status: 'failed'; term: string; message: string };

interface State {
    /** Answers by term, oldest first. */
    answers: ReadonlyMap<string, SearchAnswer>;
    /** The request that failed last, which stands until the term moves on or the box closes. */
    failure: { term: string; message: string } | null;
}

type Action =
    | { type: 'answered'; term: string; answer: SearchAnswer }
    | { type: 'failed'; term: string; message: string }
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
            return { ...state, failure: { term: action.term, message: action.message } };
        case 'forget-failure':
            return state.failure === null ? state : { ...state, failure: null };
    }
}

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
        // Not a ProblemDetails, which leaves the plain sentence below.
    }
    return SEARCH_UNREACHABLE;
}

/**
 * One request, settled as the action it calls for. Never rejects: a request aborted because the term
 * moved on settles as a failure too, which the caller drops unread.
 *
 * Plain `fetch` with the default credentials, not `credentials: 'omit'`: `/api/games` is not one of the
 * endpoints the dev site's basic auth lets through, and the browser sends that only with credentials.
 */
async function ask(term: string, signal: AbortSignal): Promise<Action> {
    try {
        const response = await fetch(searchApiPath(term, TYPEAHEAD_SIZE), { signal });
        if (!response.ok) return { type: 'failed', term, message: await problem(response) };

        const page = (await response.json()) as PagedGamesResponse;
        return { type: 'answered', term, answer: { games: page.items, hasMore: page.hasMore } };
    } catch {
        return { type: 'failed', term, message: SEARCH_UNREACHABLE };
    }
}

/**
 * The typeahead's answer for whatever is in the box, asked for under the rules above.
 *
 * `enabled` is whether anybody is looking: a box that is closed asks nothing, and closing it abandons
 * the request in flight. Every answer is filed under the term it was asked for and only the current
 * term's is ever shown, so a late answer to an earlier term cannot stand in for this one — it can only
 * be remembered for the next time that term is typed.
 *
 * `retry` asks again after a failure. Editing the term, or closing and reopening the box, does too: a
 * failure stands only for the term it happened to, while the box is open on it.
 */
export function useGameSearch(query: string, enabled: boolean): GameSearch & { retry: () => void } {
    const term = query.trim();
    const [state, dispatch] = useReducer(reducer, INITIAL);

    // When the last request started, for the spacing. Written only when one starts, and read only
    // when the next is scheduled, both outside render.
    const lastStart = useRef(Number.NEGATIVE_INFINITY);

    if (state.failure !== null && (state.failure.term !== term || !enabled)) {
        dispatch({ type: 'forget-failure' });
    }

    const active = enabled && term.length >= MIN_SEARCH_LENGTH;
    const answer = state.answers.get(term);
    const failure = state.failure !== null && state.failure.term === term ? state.failure : null;
    const settled = !active || answer !== undefined || failure !== null;

    useEffect(() => {
        if (settled) return;

        const controller = new AbortController();
        const delay = Math.max(SEARCH_DEBOUNCE_MS, lastStart.current + SEARCH_SPACING_MS - Date.now());

        const timer = setTimeout(() => {
            lastStart.current = Date.now();
            void ask(term, controller.signal).then(action => {
                if (!controller.signal.aborted) dispatch(action);
            });
        }, delay);

        // The term moved on, the box closed, or an answer came: whatever is still waiting or in
        // flight is no longer wanted. The API cancels its IGDB call when the connection drops, but
        // only a direct connection is sure to drop — the dev server's proxy does not pass an abort
        // on, and that call completes — so the spacing counts every request from its start.
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [term, settled]);

    const retry = () => dispatch({ type: 'forget-failure' });

    if (!active) return { status: 'idle', term, retry };
    if (answer !== undefined) return { status: 'answered', term, answer, retry };
    if (failure !== null) return { status: 'failed', term, message: failure.message, retry };
    return { status: 'waiting', term, retry };
}
