import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { loadTurnstile, turnstileSiteKey, type TurnstileApi } from '@/lib/turnstile';

interface Props {
    /**
     * The token Turnstile hands over once it is satisfied, and null when that token stops being good:
     * expired, or the widget failed. A token is spent by the one sign-up it is sent with, so a form that
     * sent one remounts this, with a new `key`, for the next.
     */
    onToken: (token: string | null) => void;
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
    const [failed, setFailed] = useState(false);
    // Bumped by "Try again", which runs the effect below once more.
    const [attempt, setAttempt] = useState(0);

    const report = useEffectEvent((token: string | null) => onToken(token));
    const fail = useEffectEvent(() => {
        onToken(null);
        setFailed(true);
    });

    useEffect(() => {
        // Strict Mode runs this twice in development, cleaning up between: the first run's widget is
        // removed, or never drawn if the script was still on its way.
        let cancelled = false;
        let drawn: { turnstile: TurnstileApi; id: string } | null = null;

        Promise.all([turnstileSiteKey(), loadTurnstile()])
            .then(([sitekey, turnstile]) => {
                if (cancelled || container.current === null) return;

                const id = turnstile.render(container.current, {
                    sitekey,
                    theme: 'dark',
                    size: 'flexible',
                    callback: token => {
                        setFailed(false);
                        report(token);
                    },
                    'expired-callback': () => report(null),
                    'error-callback': () => {
                        fail();
                        return true;
                    },
                });

                if (id) drawn = { turnstile, id };
                else fail();
            })
            .catch(() => {
                if (!cancelled) fail();
            });

        return () => {
            cancelled = true;
            if (drawn !== null) drawn.turnstile.remove(drawn.id);
        };
    }, [attempt]);

    return (
        <div className="dialog-field">
            <div ref={container} className="min-h-[65px]" />
            {failed && (
                <div className="dialog-error" role="alert">
                    The check that you are a person could not load. If something blocks
                    challenges.cloudflare.com, allow it for this site.{' '}
                    <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                            setFailed(false);
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
