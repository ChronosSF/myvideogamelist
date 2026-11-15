import { type ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { GameDto } from '@/types/game';
import type { PlaythroughDto, PlaythroughInputDto } from '@/types/playthrough';
import { useAuth } from '@/hooks/useAuth';
import { useLists } from '@/hooks/useLists';
import { apiFetch, problemMessage } from '@/lib/api';
import { localToday } from '@/lib/daySpan';
import { type PromptAsk, type PromptKind, type PromptRefusal, PROMPT_WORDS, askFor } from '@/lib/playthroughPrompt';
import { PlaythroughToast, type ToastView } from '@/components/PlaythroughToast';
import {
    PlaythroughPromptContext, type PlaythroughPromptContextValue, type PlaythroughWritten,
} from './PlaythroughPromptContext';

/**
 * The popup's code, which nobody needs until a yes has been said: the playthrough form and its styles are
 * fetched then, and not with every page (ADR 0097).
 */
const loadPopup = () => import('@/components/PlaythroughPopup');
const PlaythroughPopup = lazy(() => loadPopup().then(module => ({ default: module.PlaythroughPopup })));

/** The form opened in place after a yes, on the run the yes wrote. */
interface Popup {
    game: GameDto;
    kind: PromptKind;
    playthrough: PlaythroughDto;
    saving: boolean;
    error: string | null;
}

interface PromptState {
    /**
     * Whose question this is, as the user id. In the reducer beside the toast it guards, as the lists'
     * account is (ADR 0022 §8): every action an answer raises carries the session it began under, and the
     * reducer drops one that no longer matches, so a yes still out when the account changes cannot put the
     * previous account's run on the next one's screen.
     */
    session: string | null;
    toast: ToastView | null;
    popup: Popup | null;
    /** The next toast's id, so that a late answer for a toast a newer move replaced is dropped. */
    nextId: number;
}

type PromptAction =
    | { type: 'RESET'; session: string | null }
    | { type: 'ASK'; session: string | null; game: GameDto; ask: PromptAsk }
    | { type: 'STALE'; session: string | null; gameId: number }
    | { type: 'DISMISS'; session: string | null; id: number }
    | { type: 'SAVING'; session: string | null; id: number }
    | { type: 'FAILED'; session: string | null; id: number }
    | { type: 'REFUSED'; session: string | null; id: number; refusal: PromptRefusal }
    | { type: 'CONFIRMED'; session: string | null; id: number; playthrough: PlaythroughDto }
    | { type: 'OPEN_POPUP'; session: string | null; id: number }
    | { type: 'POPUP_SAVING'; session: string | null }
    | { type: 'POPUP_FAILED'; session: string | null; error: string }
    | { type: 'CLOSE_POPUP'; session: string | null };

const initialState: PromptState = { session: null, toast: null, popup: null, nextId: 1 };

/** The toast as it is, moved on, when the action is about it; otherwise the state untouched. */
function withToast(state: PromptState, id: number, next: (toast: ToastView) => ToastView | null): PromptState {
    if (state.toast === null || state.toast.id !== id) return state;
    return { ...state, toast: next(state.toast) };
}

function reducer(state: PromptState, action: PromptAction): PromptState {
    if (action.type === 'RESET') {
        // Another account, or nobody: neither the question nor the popup is theirs.
        return action.session === state.session ? state : { ...initialState, nextId: state.nextId, session: action.session };
    }

    // Raised against an account other than the one on screen.
    if (action.session !== state.session) return state;

    switch (action.type) {
        case 'ASK':
            // One at a time: a newer move's question replaces whatever is up, a yes still saving included,
            // whose run is told to the game page all the same.
            return {
                ...state,
                nextId: state.nextId + 1,
                toast: {
                    id: state.nextId, game: action.game, ask: action.ask, phase: 'asking', refusal: null, saved: null,
                },
            };
        case 'STALE':
            // A newer move of the same game that asks nothing makes the question about it stale. What the
            // toast says once a yes has gone out is a report of that yes, and stays.
            return state.toast?.game.id === action.gameId && state.toast.phase === 'asking'
                ? { ...state, toast: null }
                : state;
        case 'DISMISS':
            return withToast(state, action.id, () => null);
        case 'SAVING':
            return withToast(state, action.id, toast => ({ ...toast, phase: 'saving', refusal: null }));
        case 'FAILED':
            return withToast(state, action.id, toast => ({ ...toast, phase: 'failed' }));
        case 'REFUSED':
            return withToast(state, action.id, toast => ({ ...toast, phase: 'refused', refusal: action.refusal }));
        case 'CONFIRMED':
            return withToast(state, action.id, toast => ({ ...toast, phase: 'confirmed', saved: action.playthrough }));
        case 'OPEN_POPUP': {
            // The toast's work is done once the form it offered is open; the popup takes its place.
            const toast = state.toast;
            if (toast === null || toast.id !== action.id || toast.saved === null) return state;
            return {
                ...state,
                toast: null,
                popup: { game: toast.game, kind: toast.ask.kind, playthrough: toast.saved, saving: false, error: null },
            };
        }
        case 'POPUP_SAVING':
            return state.popup === null ? state : { ...state, popup: { ...state.popup, saving: true, error: null } };
        case 'POPUP_FAILED':
            return state.popup === null ? state : { ...state, popup: { ...state.popup, saving: false, error: action.error } };
        case 'CLOSE_POPUP':
            return { ...state, popup: null };
        default:
            return state;
    }
}

/** The response, or null for a request that never arrived, which `fetch` reports by rejecting. */
async function send(request: () => Promise<Response>): Promise<Response | null> {
    try {
        return await request();
    } catch {
        return null;
    }
}

/** A playthrough read from a response that said it carried one, or null for a body that does not. */
async function playthroughIn(res: Response): Promise<PlaythroughDto | null> {
    try {
        const body = (await res.json()) as PlaythroughDto | null;
        return body !== null && typeof body.id === 'number' ? body : null;
    } catch {
        return null;
    }
}

/** Why the server refused a yes, from its status, or null for a failure that is not a refusal. */
function refusalOf(kind: PromptKind, status: number): PromptRefusal | null {
    if (kind === 'start') return status === 409 ? 'running' : null;
    if (status === 404) return 'gone';
    return status === 409 ? 'changed' : null;
}

/**
 * Focus on the page's main content, for when the way back from the toast or the popup is gone: a card that
 * moved to another list, or a press that focused nothing. Focusable for that moment alone, as a skip link's
 * target is, so a click on the page does not focus it afterwards.
 */
function focusMain() {
    const main = document.querySelector<HTMLElement>('main');
    if (main === null) return;
    if (!main.hasAttribute('tabindex')) {
        main.setAttribute('tabindex', '-1');
        main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    }
    main.focus({ preventScroll: true });
}

/** The writes the prompt tells the game page about (`PlaythroughWrites`). */
function createWrittenStore() {
    const listeners = new Set<(written: PlaythroughWritten) => void>();
    return {
        subscribe: (listener: (written: PlaythroughWritten) => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        publish: (written: PlaythroughWritten) => {
            for (const listener of listeners) listener(written);
        },
    };
}

/**
 * The question a list move asks about a playthrough, and the form a yes opens (ADR 0097).
 *
 * Every move goes through `ListsProvider.addToList`, which tells this each one the server saved, with its
 * answer. From that and the reader's own day, `askFor` decides whether to ask, and the toast asks. Nothing
 * is written unless the reader says yes: a yes is one request to the playthrough endpoints, whose guard
 * decides a late or doubled one, and its answer turns the toast into the confirmation, whose one button
 * opens the run's form in a popup, in place.
 *
 * Mounted once, in the root, inside `ListsProvider`. The toast and the popup exist only after a reader's
 * action, so nothing of either is in the server render.
 */
export function PlaythroughPromptProvider({ children }: { children: ReactNode }) {
    const { user, loading: authLoading } = useAuth();
    const { moves } = useLists();
    const [state, dispatch] = useReducer(reducer, initialState);

    // The account transition, applied during render as `ListsProvider` applies its own, for its reason:
    // from an effect it would leave a frame with the new account on screen and the old account's question
    // in it. Idempotent, since the next render finds the session matching.
    const session = user?.id ?? null;
    if (!authLoading && state.session !== session) {
        dispatch({ type: 'RESET', session });
    }

    const [written] = useState(createWrittenStore);

    // Where focus was before it went into the toast, which is where it goes back to when the toast or the
    // popup closes: by then the button that was pressed may be gone. Written by events, read by events.
    const returnFocus = useRef<HTMLElement | null>(null);
    const rememberReturn = useCallback((target: HTMLElement | null) => {
        returnFocus.current = target;
    }, []);
    const restoreFocus = useCallback(() => {
        const target = returnFocus.current;
        returnFocus.current = null;
        if (target?.isConnected) target.focus();
        else focusMain();
    }, []);

    // Each saved move, asked about on the reader's day as it is when the move is saved. Stamped with the
    // session the move began under, so one that lands after the account changed is dropped.
    useEffect(() => moves.subscribe(move => {
        const ask = askFor(move.listId, move.answer, localToday());
        if (ask !== null) dispatch({ type: 'ASK', session: move.session, game: move.game, ask });
        else if (move.answer.moved) dispatch({ type: 'STALE', session: move.session, gameId: move.game.id });
    }), [moves]);

    const toast = state.toast;
    const popup = state.popup;

    /** The yes, or "Try again" after a failure: the day the toast named, never one read again. */
    const accept = useCallback(async (view: ToastView) => {
        const at = state.session;
        const { id, game, ask } = view;
        dispatch({ type: 'SAVING', session: at, id });

        const res = await send(() => apiFetch(
            ask.kind === 'start'
                ? `/api/entries/${game.id}/playthroughs/start`
                : `/api/entries/${game.id}/playthroughs/${ask.run.id}/finish`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ask.kind === 'start' ? { startedOn: ask.day } : { finishedOn: ask.day }),
            },
        ));

        if (res === null) {
            dispatch({ type: 'FAILED', session: at, id });
            return;
        }

        if (res.ok) {
            const playthrough = await playthroughIn(res);
            // Told to the game page whatever happened to the toast since: the run was written.
            written.publish({ session: at, gameId: game.id, playthrough });
            if (playthrough === null) {
                dispatch({ type: 'DISMISS', session: at, id });
                return;
            }
            dispatch({ type: 'CONFIRMED', session: at, id, playthrough });
            // The form is likely next, so its code is fetched now rather than when its button is pressed.
            void loadPopup().catch(() => {});
            return;
        }

        const refusal = refusalOf(ask.kind, res.status);
        if (refusal === null) {
            dispatch({ type: 'FAILED', session: at, id });
            return;
        }

        // Something else wrote the game's runs since the question; the game page reads them again.
        written.publish({ session: at, gameId: game.id, playthrough: null });
        dispatch({ type: 'REFUSED', session: at, id, refusal });
    }, [state.session, written]);

    const dismiss = useCallback((id: number) => {
        dispatch({ type: 'DISMISS', session: state.session, id });
    }, [state.session]);

    const openDetails = useCallback((id: number) => {
        dispatch({ type: 'OPEN_POPUP', session: state.session, id });
    }, [state.session]);

    const closePopup = useCallback(() => {
        if (popup?.saving) return;
        // Committed before focus moves, so the dialog is gone and the page behind it no longer inert.
        flushSync(() => dispatch({ type: 'CLOSE_POPUP', session: state.session }));
        restoreFocus();
    }, [popup?.saving, restoreFocus, state.session]);

    const savePopup = useCallback(async (input: PlaythroughInputDto) => {
        if (popup === null || popup.saving) return;
        const at = state.session;
        const { game, playthrough } = popup;
        dispatch({ type: 'POPUP_SAVING', session: at });

        const res = await send(() => apiFetch(`/api/entries/${game.id}/playthroughs/${playthrough.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        }));

        if (res === null || !res.ok) {
            const error = res === null
                ? PROMPT_WORDS.popupFailed
                : res.status === 404 ? PROMPT_WORDS.refused.gone : await problemMessage(res, PROMPT_WORDS.popupFailed);
            dispatch({ type: 'POPUP_FAILED', session: at, error });
            return;
        }

        written.publish({ session: at, gameId: game.id, playthrough: await playthroughIn(res) });
        flushSync(() => dispatch({ type: 'CLOSE_POPUP', session: at }));
        restoreFocus();
    }, [popup, restoreFocus, state.session, written]);

    const value = useMemo<PlaythroughPromptContextValue>(() => ({ written }), [written]);

    return (
        <PlaythroughPromptContext.Provider value={value}>
            {children}
            <PlaythroughToast
                toast={toast}
                onAccept={accept}
                onDismiss={dismiss}
                onDetails={openDetails}
                rememberReturn={rememberReturn}
                restoreFocus={restoreFocus}
            />
            {popup !== null && (
                <Suspense fallback={null}>
                    <PlaythroughPopup
                        game={popup.game}
                        kind={popup.kind}
                        playthrough={popup.playthrough}
                        saving={popup.saving}
                        error={popup.error}
                        onSubmit={input => void savePopup(input)}
                        onClose={closePopup}
                    />
                </Suspense>
            )}
        </PlaythroughPromptContext.Provider>
    );
}
