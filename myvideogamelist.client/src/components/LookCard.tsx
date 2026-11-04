import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLook } from '@/hooks/useLook';
import { applyLook } from '@/lib/look';
import { currentColours, lookChecks } from '@/lib/lookChecks';
import { useHydrated } from '@/lib/useHydrated';
import {
    DEFAULT_LOOK,
    PALETTE_IDS,
    PALETTE_NAMES,
    PATTERN_IDS,
    PATTERN_NAMES,
    TINT_IDS,
    TINT_NAMES,
    sameLook,
    type Look,
    type PaletteId,
    type PatternId,
    type TintId,
} from '@/types/look';
import './LookCard.css';

/** How long a colour picker rests before its colour is saved: it reports every colour it passes through. */
const COLOUR_SAVE_DELAY_MS = 500;

type Status = 'saved' | 'saving' | 'unreadable' | 'failed';

/**
 * How the site looks to its owner, at the top of their settings (ADR 0082): a palette, five presets or a
 * custom one of two colours; a background pattern, or none; and whether the pattern is drawn in grey or
 * the accent.
 *
 * The page itself is the preview: every choice is drawn at once, and saved at once to the account, so it
 * follows them to every device they sign in on. A custom palette is checked as it is drawn, and saved only
 * while every check passes; one that fails stays on this page, unsaved, until it passes or the page is left,
 * and then the account's look comes back. Saves go one at a time, the latest choice after the one in
 * flight, so the account ends on the last thing chosen whatever order the answers would have come in.
 */
export function LookCard({ look: saved }: { look: Look }) {
    const { updateLook } = useAuth();
    const { preview } = useLook();
    const hydrated = useHydrated();
    const fieldId = useId();

    // Null while the page shows the account's own look, which is also what a failed save goes back to.
    const [draft, setDraft] = useState<Look | null>(null);
    const [status, setStatus] = useState<Status>('saved');
    const [error, setError] = useState<string | null>(null);
    // The custom colours last drawn here, so that leaving Custom for a preset and coming back keeps them.
    const [lastCustom, setLastCustom] = useState<{ background: string; accent: string } | null>(
        saved.background && saved.accent ? { background: saved.background, accent: saved.accent } : null);

    const inFlight = useRef(false);
    const queued = useRef<Look | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const pending = useRef<Look | null>(null);
    // What an answer or the unmount needs of the latest render. The auth provider makes a new
    // `updateLook` on every render of its own, which every save is, so an effect depending on it would
    // clean up after each one.
    const latest = useRef({ saved, updateLook, preview });
    useEffect(() => {
        latest.current = { saved, updateLook, preview };
    });

    const current = draft ?? saved;
    const custom = current.palette === 'custom';

    // Read off the page, which is already drawn in this look: a handler draws it before it lands here,
    // and the account's look is the page's until one does. Only in the browser, and only for a custom
    // palette, the one whose readability is not already known.
    const checks = useMemo(
        () => (hydrated && custom ? lookChecks() : null),
        // The colours are what the checks measure; the palette is whether there is anything to measure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [hydrated, custom, current.background, current.accent],
    );

    function send(look: Look) {
        if (inFlight.current) {
            queued.current = look;
            return;
        }

        inFlight.current = true;
        setStatus('saving');
        latest.current.updateLook(look)
            .then(() => {
                if (queued.current === null && timer.current === undefined) setStatus('saved');
                setError(null);
            })
            .catch((reason: unknown) => {
                // Back to the account's look, as stored: the choices since are not on it.
                queued.current = null;
                window.clearTimeout(timer.current);
                timer.current = undefined;
                pending.current = null;
                applyLook(latest.current.saved);
                setDraft(null);
                latest.current.preview(null);
                setStatus('failed');
                setError(reason instanceof Error ? reason.message : 'Failed to save your look');
            })
            .finally(() => {
                inFlight.current = false;
                const next = queued.current;
                queued.current = null;
                if (next !== null) send(next);
            });
    }

    /** Draws a look, and saves it after `delay`, or says why it will not. */
    function choose(next: Look, delay = 0) {
        applyLook(next);
        setDraft(next);
        preview(next);
        if (next.palette === 'custom' && next.background && next.accent) {
            setLastCustom({ background: next.background, accent: next.accent });
        }

        window.clearTimeout(timer.current);
        timer.current = undefined;
        pending.current = null;

        if (next.palette === 'custom' && !lookChecks().every(check => check.ok)) {
            setStatus('unreadable');
            return;
        }
        if (sameLook(next, saved) && !inFlight.current) {
            setStatus('saved');
            return;
        }

        if (delay === 0) {
            send(next);
        } else {
            setStatus('saving');
            pending.current = next;
            timer.current = window.setTimeout(() => {
                timer.current = undefined;
                pending.current = null;
                send(next);
            }, delay);
        }
    }

    function choosePalette(palette: PaletteId) {
        if (palette !== 'custom') {
            choose({ ...current, palette, background: null, accent: null });
            return;
        }
        // From the last custom colours, or else from the palette on screen, so the first step into Custom
        // looks like where it started.
        const colours = lastCustom ?? currentColours();
        if (colours === null) return;
        choose({ ...current, palette, ...colours });
    }

    // Leaving the page: a colour still waiting to be saved is saved now, and the page goes back to the
    // account's look, which a custom palette that failed its checks was never part of.
    useEffect(() => () => {
        const waiting = pending.current;
        window.clearTimeout(timer.current);
        if (waiting !== null) void latest.current.updateLook(waiting).catch(() => undefined);
        latest.current.preview(null);
    }, []);

    const customSwatch = custom && current.background && current.accent
        ? { '--look-page': current.background, '--look-accent': current.accent } as CSSProperties
        : undefined;

    return (
        <div className="user-card look-card">
            <div className="user-card-label">Look</div>
            <p className="user-card-hint">
                How the site looks to you, on every device you sign in on. Changes show at once.
            </p>

            <fieldset className="look-group">
                <legend className="look-legend">Palette</legend>
                <div className="look-options">
                    {PALETTE_IDS.map(id => (
                        <label key={id} className="look-option">
                            <input
                                type="radio"
                                className="sr-only"
                                name={`${fieldId}-palette`}
                                value={id}
                                checked={current.palette === id}
                                onChange={() => choosePalette(id)}
                            />
                            {id === 'custom' && customSwatch === undefined ? (
                                <span className="look-swatch look-swatch-empty" aria-hidden="true">
                                    <PaletteGlyph />
                                </span>
                            ) : (
                                <span
                                    className="look-swatch look-palette-swatch"
                                    data-palette-preview={id}
                                    style={id === 'custom' ? customSwatch : undefined}
                                    aria-hidden="true"
                                >
                                    <span className="look-palette-swatch-accent" />
                                </span>
                            )}
                            <span className="look-option-name">{PALETTE_NAMES[id]}</span>
                        </label>
                    ))}
                </div>

                {custom && current.background && current.accent && (
                    <div className="look-custom">
                        <label className="look-colour">
                            <span>Background</span>
                            <input
                                type="color"
                                aria-label="Background colour"
                                value={current.background}
                                onChange={event => choose({ ...current, background: event.target.value }, COLOUR_SAVE_DELAY_MS)}
                            />
                        </label>
                        <label className="look-colour">
                            <span>Accent</span>
                            <input
                                type="color"
                                aria-label="Accent colour"
                                value={current.accent}
                                onChange={event => choose({ ...current, accent: event.target.value }, COLOUR_SAVE_DELAY_MS)}
                            />
                        </label>
                        {checks && (
                            <ul className="look-checks" aria-label="Readability">
                                {checks.map(check => (
                                    <li key={check.id} className="look-check" data-ok={check.ok}>
                                        <span aria-hidden="true">{check.ok ? '✓' : '✗'}</span>{' '}
                                        <span className="sr-only">{check.ok ? 'Passes: ' : 'Fails: '}</span>
                                        {check.label}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </fieldset>

            <fieldset className="look-group">
                <legend className="look-legend">Background pattern</legend>
                <div className="look-options">
                    {PATTERN_IDS.map((id: PatternId) => (
                        <label key={id} className="look-option">
                            <input
                                type="radio"
                                className="sr-only"
                                name={`${fieldId}-pattern`}
                                value={id}
                                checked={current.pattern === id}
                                onChange={() => choose({ ...current, pattern: id })}
                            />
                            <span className="look-swatch look-pattern-swatch" data-pattern-swatch={id} aria-hidden="true">
                                {id === 'none' && 'Off'}
                            </span>
                            <span className="look-option-name">{PATTERN_NAMES[id]}</span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <fieldset className="look-group" disabled={current.pattern === 'none'}>
                <legend className="look-legend">Pattern colour</legend>
                <div className="look-segments">
                    {TINT_IDS.map((id: TintId) => (
                        <label key={id} className="look-segment">
                            <input
                                type="radio"
                                className="sr-only"
                                name={`${fieldId}-tint`}
                                value={id}
                                checked={current.tint === id}
                                onChange={() => choose({ ...current, tint: id })}
                            />
                            {TINT_NAMES[id]}
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="look-footer">
                {status === 'failed' ? (
                    <p className="user-pref-error" role="alert">{error}</p>
                ) : (
                    <p className="look-status" aria-live="polite">
                        {status === 'saving' && 'Saving…'}
                        {status === 'saved' && 'Saved to your account'}
                        {status === 'unreadable' && 'Not saved until every check passes'}
                    </p>
                )}
                <button
                    type="button"
                    className="look-reset"
                    disabled={sameLook(current, DEFAULT_LOOK)}
                    onClick={() => choose({ ...DEFAULT_LOOK })}
                >
                    Reset to default
                </button>
            </div>
        </div>
    );
}

/** A painter's palette, for the custom one before it has colours of its own. */
function PaletteGlyph() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.5-2 4-4.5 4H15a2 2 0 0 0-1.5 3.3c.4.5.5 1.2.1 1.8-.4.6-1 .9-1.6.9Z" />
            <circle cx="7.5" cy="10.5" r="1" />
            <circle cx="12" cy="7.5" r="1" />
            <circle cx="16.5" cy="10.5" r="1" />
        </svg>
    );
}
