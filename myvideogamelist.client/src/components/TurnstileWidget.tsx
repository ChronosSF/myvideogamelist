import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { loadTurnstile, turnstileSiteKey } from '@/lib/turnstile';

interface Props {
    /**
     * The token Turnstile hands over once it is satisfied, and null when that token stops being good:
     * expired, or the widget failed. A token is spent by the one sign-up it is sent with, so a form that
     * sent one remounts this, with a new `key`, for the next.
     */
    onToken: (token: string | null) => void;
}

/**
 * Why there is no check to complete. Three different things, with three different people able to do
 * something about them, so the form says which:
 *
 * - `unavailable`: the API handed over no site key. The deployment has none, or the API is away. Nothing
 *   the reader can change.
 * - `blocked`: Cloudflare's script did not load. The one the reader may be able to change.
 * - `widget`: the script loaded and the widget reported an error, by Cloudflare's code for it: a site
 *   key it does not know, a host the widget is not for, a challenge that failed. Shown with the code,
 *   which is what tells the owner which of those it was.
 */
type Failure =
    | { kind: 'unavailable' }
    | { kind: 'blocked' }
    | { kind: 'widget'; code: string | null };

function sentenceFor(failure: Failure): string {
    switch (failure.kind) {
        case 'unavailable':
            return 'Signing up is not available just now. Please try again later.';
        case 'blocked':
            return 'The check that you are a person could not load. If something blocks '
                + 'challenges.cloudflare.com, allow it for this site.';
        case 'widget':
            return failure.code === null
                ? 'The check that you are a person did not finish.'
                : `The check that you are a person did not finish (Cloudflare error ${failure.code}). `
                    + 'If it keeps happening, tell us that number.';
    }
}

/**
 * Cloudflare's check that the person filling in the form is one (ADR 0092), drawn into the form.
 *
 * Its script and the site key are fetched when this mounts, which is when the sign-up form opens, so
 * nobody who never opens it is sent to Cloudflare. It draws in the site's one theme, dark, as wide as
 * the form. The box keeps the widget's height while it loads, so the form does not jump when it arrives.
 */
export function TurnstileWidget({ onToken }: Props) {
    const container = useRef<HTMLDivElement>(null);
    const [failure, setFailure] = useState<Failure | null>(null);
    // Bumped by "Try again", which runs the effect below once more.
    const [attempt, setAttempt] = useState(0);

    const report = useEffectEvent((token: string | null) => onToken(token));
    const fail = useEffectEvent((because: Failure) => {
        onToken(null);
        setFailure(because);
    });

    useEffect(() => {
        // Strict Mode runs this twice in development, cleaning up between: the first run's widget is
        // removed, or never drawn if the script was still on its way.
        let cancelled = false;
        let remove: (() => void) | null = null;

        // Settled, not raced: which of the two failed is what the form says.
        void Promise.allSettled([turnstileSiteKey(), loadTurnstile()]).then(([sitekey, turnstile]) => {
            if (cancelled || container.current === null) return;

            if (sitekey.status === 'rejected') {
                fail({ kind: 'unavailable' });
                return;
            }
            if (turnstile.status === 'rejected') {
                fail({ kind: 'blocked' });
                return;
            }

            const api = turnstile.value;
            try {
                const id = api.render(container.current, {
                    sitekey: sitekey.value,
                    theme: 'dark',
                    size: 'flexible',
                    callback: token => {
                        setFailure(null);
                        report(token);
                    },
                    'expired-callback': () => report(null),
                    'error-callback': code => {
                        fail({ kind: 'widget', code: code ? code : null });
                        return true;
                    },
                });

                if (id) remove = () => api.remove(id);
                else fail({ kind: 'widget', code: null });
            } catch {
                // What `render` does with options it will not draw with is not documented. Thrown or
                // returned empty, it is the widget's failure, with no code to show.
                fail({ kind: 'widget', code: null });
            }
        });

        return () => {
            cancelled = true;
            remove?.();
        };
    }, [attempt]);

    return (
        <div className="dialog-field">
            <div ref={container} className="min-h-[65px]" />
            {failure !== null && (
                <div className="dialog-error" role="alert">
                    {sentenceFor(failure)}{' '}
                    <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                            setFailure(null);
                            setAttempt(current => current + 1);
                        }}
                    >
                        Try again
                    </button>
                </div>
            )}
        </div>
    );
}
