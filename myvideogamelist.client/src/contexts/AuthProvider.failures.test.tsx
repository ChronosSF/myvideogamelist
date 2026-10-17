import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { useAuth } from '@/hooks/useAuth';

/**
 * What the API answers, by method and path. A function that throws is an API that cannot be reached:
 * `fetch` rejects then, with the browser's own message, rather than answering.
 */
type Routes = Record<string, () => Response>;

const UNREACHABLE = () => {
    throw new TypeError('fetch failed');
};

function stubApi(routes: Routes) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const route = `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`;
        const answer = routes[route];
        if (!answer) throw new Error(`No route for ${route}`);
        return answer();
    }));
}

/** Who is signed in, and two buttons that say why they did not work, as the real dialogs do. */
function Session() {
    const { user, loading, login, logout } = useAuth();
    const [error, setError] = useState<string | null>(null);

    const attempt = (action: () => Promise<void>) => () => {
        setError(null);
        action().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
    };

    if (loading) return <p>Asking who is signed in</p>;

    return (
        <>
            <p>{user ? `Signed in as ${user.userName}` : 'Nobody is signed in'}</p>
            <button type="button" onClick={attempt(() => login('alex', 'Passw0rd1', false))}>Sign in</button>
            <button type="button" onClick={attempt(logout)}>Sign out</button>
            {error !== null && <p role="alert">{error}</p>}
        </>
    );
}

function renderSession(routes: Routes) {
    stubApi(routes);
    render(<AuthProvider><Session /></AuthProvider>);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AuthProvider with no API to reach', () => {
    it('takes an unreachable API for nobody signed in, and leaves no rejection unhandled', async () => {
        const unhandled: unknown[] = [];
        const record = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', record);
        try {
            renderSession({ 'GET /api/auth/me': UNREACHABLE });

            expect(await screen.findByText('Nobody is signed in')).toBeInTheDocument();
            // A rejection is reported unhandled only after the turn it escaped in.
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', record);
        }
    });
});
