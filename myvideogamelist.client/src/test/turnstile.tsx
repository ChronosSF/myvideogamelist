import { useEffect, useState } from 'react';
import { turnstileStub } from '@/test/turnstileStub';

/**
 * Cloudflare's widget, for a test of a form that draws it (ADR 0092). The real one loads a script jsdom
 * never runs, so a form under test would wait for its token for ever. Mount it in its place with
 * `vi.mock('@/components/TurnstileWidget', () => import('@/test/turnstile'))`.
 *
 * Each mount hands over its own token, `turnstile-token-1`, `-2` and so on, as soon as it mounts unless
 * `turnstileStub.autoPass` is off, and again from its "Pass the check" button. So a test can see that a
 * form sent the token it was given, and that it asked for a new one after spending one.
 */
export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
    const [token] = useState(() => `turnstile-token-${++turnstileStub.mounts}`);

    useEffect(() => {
        if (turnstileStub.autoPass) onToken(token);
    }, [onToken, token]);

    return <button type="button" onClick={() => onToken(token)}>Pass the check</button>;
}
