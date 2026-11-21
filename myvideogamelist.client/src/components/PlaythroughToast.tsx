import { type FocusEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameDto } from '@/types/game';
import type { PlaythroughDto } from '@/types/playthrough';
import { useHydrated } from '@/lib/useHydrated';
import {
    type PromptAsk, type PromptRefusal, PROMPT_HOTKEY, PROMPT_TIMING, PROMPT_WORDS, askMeta, confirmedMeta,
} from '@/lib/playthroughPrompt';
import './PlaythroughToast.css';

/** Where a toast is: asked, its yes out, failed, refused by the server, or done. */
export type ToastPhase = 'asking' | 'saving' | 'failed' | 'refused' | 'confirmed';

/** One question about one game's playthrough, and what has come of it. */
export interface ToastView {
    id: number;
    game: GameDto;
    ask: PromptAsk;
    phase: ToastPhase;
    refusal: PromptRefusal | null;
    /** The run the yes wrote, once it has. */
    saved: PlaythroughDto | null;
    /** The popup's code could not be fetched, so the confirmation says so in place of its line. */
    detailsFailed: boolean;
}

interface PlaythroughToastProps {
    toast: ToastView | null;
    onAccept: (toast: ToastView) => void;
    onDismiss: (id: number) => void;
    onDetails: (id: number) => void;
    /** Where focus came from when it went into the toast, which is where it goes back. */
    rememberReturn: (target: HTMLElement | null) => void;
    restoreFocus: () => void;
}

const CHECK = 'M5 13l4 4L19 7';

/** An element focus can be given back to: not nothing, and not the body, which is nowhere in particular. */
function returnable(target: EventTarget | Element | null): HTMLElement | null {
    return target instanceof HTMLElement && target !== document.body ? target : null;
}

/**
 * The question a list move asks about a playthrough, and what came of the answer (ADR 0097).
 *
 * Fixed at the bottom of the window, so it moves nothing on the page. It never takes focus when it
 * appears: the question is announced politely, a failure as an alert, and `PROMPT_HOTKEY` takes focus to
 * it from anywhere, which the announcement says. Its timer stops while the pointer is over it or focus is
 * inside it, and Escape inside it closes it. Closed with focus inside, focus goes back where it came from.
 *
 * Drawn only once hydrated, so nothing of it is in the server render; the two live regions are drawn then,
 * empty, so that a question put in them later is announced as it arrives.
 */
export function PlaythroughToast({
    toast, onAccept, onDismiss, onDetails, rememberReturn, restoreFocus,
}: PlaythroughToastProps) {
    const hydrated = useHydrated();
    const host = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);

    // A toast taken away under the pointer or with focus in it fires no leave and no blur, so the next one
    // would start paused and never be remembered as entered. Put right during render, as a prop's change is.
    if (toast === null && (hovered || focused)) {
        setHovered(false);
        setFocused(false);
    }

    // The key that reaches it, listened for only while there is something to reach.
    const up = toast !== null;
    useEffect(() => {
        if (!up) return;
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key !== PROMPT_HOTKEY || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const element = host.current;
            const first = element?.querySelector('button');
            if (!element || !first) return;
            event.preventDefault();
            if (!element.contains(document.activeElement)) rememberReturn(returnable(document.activeElement));
            first.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [up, rememberReturn]);

    // A change of state with focus inside keeps focus inside: the button that had it may be gone, the
    // confirmation's "Not now" for one, and focus would otherwise fall to the top of the page.
    const id = toast?.id;
    const phase = toast?.phase;
    useLayoutEffect(() => {
        const element = host.current;
        if (!focused || element === null || phase === undefined) return;
        if (!element.contains(document.activeElement)) element.querySelector('button')?.focus();
    }, [id, phase, focused]);

    const focusInside = () => host.current?.contains(document.activeElement) ?? false;

    const close = (view: ToastView) => {
        const hadFocus = focusInside();
        onDismiss(view.id);
        if (hadFocus) restoreFocus();
    };

    const expire = useCallback(() => {
        if (id !== undefined) onDismiss(id);
    }, [id, onDismiss]);

    // Remembered as focus comes in from somewhere on the page, and only then: a move inside the toast, to the
    // button a new state draws after the pressed one has gone, comes from an element no longer in it, and a
    // return to the window from another comes from nowhere, which is no way back.
    const onFocus = (event: FocusEvent<HTMLDivElement>) => {
        const from = returnable(event.relatedTarget);
        if (!focused && from !== null) rememberReturn(from);
        setFocused(true);
    };

    // A blur to nowhere that leaves the document's focused element inside the toast has not left it, so the
    // pause and the way back both stay.
    const onBlur = (event: FocusEvent<HTMLDivElement>) => {
        const to = event.relatedTarget;
        if (to === null && event.currentTarget.contains(document.activeElement)) return;
        if (!(to instanceof Node) || !event.currentTarget.contains(to)) setFocused(false);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || toast === null || toast.phase === 'saving') return;
        event.stopPropagation();
        close(toast);
    };

    if (!hydrated) return null;

    const failed = toast?.phase === 'failed';
    const box = toast === null ? null : (
        <ToastBox
            key={toast.id}
            toast={toast}
            onAccept={() => onAccept(toast)}
            onClose={() => close(toast)}
            onDetails={() => onDetails(toast.id)}
            onHover={setHovered}
        />
    );
    const duration = toast === null || toast.phase === 'saving'
        ? null
        : toast.phase === 'confirmed' ? PROMPT_TIMING.confirmedMs : PROMPT_TIMING.askMs;

    return (
        <div ref={host} className="playthrough-toast-host" onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>
            <div role="status">{!failed && box}</div>
            <div role="alert">{failed && box}</div>
            {toast !== null && duration !== null && (
                <Countdown
                    key={`${toast.id}:${toast.phase}`}
                    ms={duration}
                    paused={hovered || focused}
                    onExpire={expire}
                />
            )}
        </div>
    );
}

/**
 * Dismisses after `ms` of not being paused, keeping what was left across a pause. Keyed on the toast and
 * its state, so each state starts from its own duration.
 */
function Countdown({ ms, paused, onExpire }: { ms: number; paused: boolean; onExpire: () => void }) {
    const remaining = useRef(ms);

    useEffect(() => {
        if (paused) return;
        const started = Date.now();
        const timer = window.setTimeout(onExpire, remaining.current);
        return () => {
            window.clearTimeout(timer);
            remaining.current = Math.max(0, remaining.current - (Date.now() - started));
        };
    }, [paused, onExpire]);

    return null;
}

interface ToastBoxProps {
    toast: ToastView;
    onAccept: () => void;
    onClose: () => void;
    onDetails: () => void;
    onHover: (hovered: boolean) => void;
}

const PRIMARY = 'h-10 px-[18px] text-sm btn-primary aria-disabled:opacity-60 aria-disabled:cursor-default max-sm:h-11 max-sm:flex-1';
const OUTLINE = 'h-10 px-[18px] text-sm btn-outline aria-disabled:opacity-60 aria-disabled:cursor-default max-sm:h-11 max-sm:flex-1';

/**
 * The box itself. The yes and "Not now" keep their places from the question through its saving to a
 * failure, so that the button a reader pressed is the same element afterwards and keeps their focus. While
 * a yes saves they are `aria-disabled` rather than disabled for the same reason: a disabled button drops its
 * focus. The confirmation's and the refusal's one button is new, and `PlaythroughToast` moves focus to it.
 */
function ToastBox({ toast, onAccept, onClose, onDetails, onHover }: ToastBoxProps) {
    const { ask, phase } = toast;
    const kind = ask.kind;
    const saving = phase === 'saving';

    const title = phase === 'failed' || phase === 'refused'
        ? PROMPT_WORDS.failed[kind]
        : phase === 'confirmed' ? PROMPT_WORDS.confirmed[kind] : PROMPT_WORDS.question[kind];

    let line: { text: string; tone: 'meta' | 'danger' | 'muted' } | null;
    if (phase === 'failed') line = { text: PROMPT_WORDS.failedDetail, tone: 'danger' };
    else if (phase === 'refused') line = { text: PROMPT_WORDS.refused[toast.refusal ?? 'changed'], tone: 'muted' };
    else if (phase === 'confirmed') {
        line = toast.detailsFailed
            ? { text: PROMPT_WORDS.detailsFailed, tone: 'danger' }
            : { text: confirmedMeta(ask), tone: 'meta' };
    }
    else {
        const meta = askMeta(ask);
        line = meta === null ? null : { text: meta, tone: 'meta' };
    }

    return (
        <div
            className="playthrough-toast"
            aria-label={PROMPT_WORDS.region}
            aria-keyshortcuts={PROMPT_HOTKEY}
            role="group"
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
        >
            <div className="flex flex-col gap-1.5 min-w-0">
                <p className="type-kicker text-xs text-fg-faint truncate">{PROMPT_WORDS.kicker(toast.game.title)}</p>
                <p className="type-title text-[19px] leading-tight text-fg-strong flex items-center gap-2">
                    {phase === 'confirmed' && (
                        <svg className="w-[18px] h-[18px] shrink-0 text-success-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={CHECK} />
                        </svg>
                    )}
                    <span>{title}</span>
                </p>
                {line !== null && (
                    <p className={line.tone === 'meta'
                        ? 'type-meta text-xs text-fg-muted'
                        : line.tone === 'danger' ? 'text-sm text-danger-300' : 'text-sm text-fg-muted'}
                    >
                        {line.text}
                    </p>
                )}
                {(phase === 'asking' || phase === 'failed') && <span className="sr-only">{PROMPT_WORDS.hotkeyHint}</span>}
            </div>

            <div className="flex gap-2.5">
                {phase === 'confirmed' && (
                    <button type="button" className={`${OUTLINE} font-semibold`} onClick={onDetails}>
                        {PROMPT_WORDS.details[kind]}
                    </button>
                )}
                {phase === 'refused' && (
                    <button type="button" className={OUTLINE} onClick={onClose}>
                        {PROMPT_WORDS.close}
                    </button>
                )}
                {(phase === 'asking' || phase === 'saving' || phase === 'failed') && (
                    <>
                        <button
                            key="first"
                            type="button"
                            className={PRIMARY}
                            aria-disabled={saving || undefined}
                            onClick={saving ? undefined : onAccept}
                        >
                            {saving ? PROMPT_WORDS.saving[kind] : phase === 'failed' ? PROMPT_WORDS.tryAgain : PROMPT_WORDS.yes[kind]}
                        </button>
                        <button
                            key="second"
                            type="button"
                            className={OUTLINE}
                            aria-disabled={saving || undefined}
                            onClick={saving ? undefined : onClose}
                        >
                            {PROMPT_WORDS.notNow}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
