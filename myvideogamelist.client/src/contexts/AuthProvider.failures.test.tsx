import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { useAuth } from '@/hooks/useAuth';
import { userProfile } from '@/test/factories';

/**
 * What the API answers, by method and path. A function that throws is an API that cannot be reached:
 * `fetch` rejects then, with the browser's own message, rather than answering.
 */
type Routes = Record<string, () => Response>;

const UNREACHABLE = () => {
    throw new TypeError('fetch failed');
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

    it("says in the site's words, not the browser's, that signing in could not reach the API", async () => {
        const actor = userEvent.setup();
        renderSession({ 'GET /api/auth/me': () => new Response(null, { status: 204 }), 'POST /api/auth/login': UNREACHABLE });

        await actor.click(await screen.findByRole('button', { name: 'Sign in' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach MyVideoGameList just now. Please try again.');
        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
    });
});

describe('AuthProvider signing out', () => {
    const signedIn = { 'GET /api/auth/me': () => json(userProfile()) };

    it('keeps the session, and says so, when the API refuses to sign out', async () => {
        // Shown signed out while the cookie lives on, somebody leaves a shared computer signed in.
        const actor = userEvent.setup();
        renderSession({ ...signedIn, 'POST /api/auth/logout': () => new Response('<html>Bad gateway</html>', { status: 502 }) });

        await actor.click(await screen.findByRole('button', { name: 'Sign out' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign you out. Please try again.');
        expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
    });

    it("keeps the session when the API cannot be reached to sign out, and says so in the site's words", async () => {
        const actor = userEvent.setup();
        renderSession({ ...signedIn, 'POST /api/auth/logout': UNREACHABLE });

        await actor.click(await screen.findByRole('button', { name: 'Sign out' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach MyVideoGameList just now. Please try again.');
        expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
    });

    it('signs out on screen when the session had already ended', async () => {
        // The 401 of a session that expired, or was signed out in another tab, says what a 204 does.
        const actor = userEvent.setup();
        renderSession({ ...signedIn, 'POST /api/auth/logout': () => json({}, 401) });

        await actor.click(await screen.findByRole('button', { name: 'Sign out' }));

        await waitFor(() => expect(screen.getByText('Nobody is signed in')).toBeInTheDocument());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('signs out on screen once the API has signed the session out', async () => {
        const actor = userEvent.setup();
        renderSession({ ...signedIn, 'POST /api/auth/logout': () => new Response(null, { status: 204 }) });

        await actor.click(await screen.findByRole('button', { name: 'Sign out' }));

        await waitFor(() => expect(screen.getByText('Nobody is signed in')).toBeInTheDocument());
    });
});
