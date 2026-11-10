import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { AuthDialogProvider } from '@/contexts/AuthDialogProvider';
import { useAuth } from '@/hooks/useAuth';
import { useAuthDialog } from '@/hooks/useAuthDialog';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import { quickActor } from '@/test/actor';
import { userProfile } from '@/test/factories';
import { type ApiRoutes, empty, expectSentThroughApiFetch, json, stubApi, tearDownApi } from '@/test/api';

/**
 * A forgotten password over the real `AuthProvider` and the real dialogs, with only the network played by
 * the test (ADR 0090): the requests each step sends, the write guard's header, and how each refusal the
 * API answers with, in its own words, becomes what somebody reads.
 */
const ALEX = userProfile({ id: 'user-1', email: 'alex@test.local', userName: 'alex' });
const NEW_PASSWORD = 'new-passw0rd';
const LINK_REFUSED = 'This link has expired or has already been used. Ask for a new one.';

/** Who the provider has signed in, as the navbar would say it, and the way into the sign-in dialog. */
function Session() {
    const { user, loading } = useAuth();
    const dialog = useAuthDialog();
    if (loading) return <p>Asking who is signed in</p>;
    return (
        <>
            <p>{user === null ? 'Nobody is signed in' : `Signed in as ${user.userName}`}</p>
            <button type="button" onClick={() => dialog.open('login')}>Open sign-in</button>
        </>
    );
}

function renderApp(routes: ApiRoutes, page = false) {
    const api = stubApi({ 'GET /api/auth/me': () => empty(), ...routes });
    render(
        <AuthProvider>
            <AuthDialogProvider>
                <Session />
                {page && <ResetPasswordPage />}
            </AuthDialogProvider>
        </AuthProvider>,
    );
    return api;
}

async function chooseNewPassword(actor: ReturnType<typeof quickActor>) {
    await actor.type(await screen.findByLabelText('New password'), NEW_PASSWORD);
    await actor.type(screen.getByLabelText('Confirm new password'), NEW_PASSWORD);
    await actor.click(screen.getByRole('button', { name: 'Set the new password' }));
}

afterEach(() => {
    tearDownApi();
    window.history.replaceState(null, '', '/');
});

describe('Forgot password, from the sign-in dialog', () => {
    it('carries what was typed into the request, sends it through the write guard, and hedges the answer', async () => {
        const actor = quickActor();
        const api = renderApp({ 'POST /api/auth/forgot-password': () => empty(202) });
        await actor.click(await screen.findByRole('button', { name: 'Open sign-in' }));

        await actor.type(screen.getByLabelText('Email or username'), 'alex');
        await actor.click(screen.getByRole('button', { name: 'Forgot password?' }));
        await actor.click(screen.getByRole('button', { name: 'Send the link' }));

        expect(await screen.findByRole('dialog', { name: 'Check your inbox' })).toBeInTheDocument();
        const [request] = api.callsTo('POST', '/api/auth/forgot-password');
        expect(request.body).toEqual({ email: 'alex' });
        expectSentThroughApiFetch(request);
        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
    });

    it("reads a rate-limited request by what the limiter said", async () => {
        const actor = quickActor();
        renderApp({
            'POST /api/auth/forgot-password': () => json({
                title: 'Too many requests',
                detail: 'Too many attempts from this device. Wait a few minutes and try again.',
                status: 429,
            }, 429),
        });
        await actor.click(await screen.findByRole('button', { name: 'Open sign-in' }));
        await actor.click(screen.getByRole('button', { name: 'Forgot password?' }));

        await actor.type(screen.getByLabelText('Email or username'), 'alex');
        await actor.click(screen.getByRole('button', { name: 'Send the link' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts from this device.');
    });
});

describe('Setting a new password, on the page the link opens', () => {
    it('posts the link and the password through the write guard, and offers the sign-in', async () => {
        const actor = quickActor();
        window.history.replaceState(null, '', '/reset-password#user=user-1&token=CfDJ8%2Ba%2Fb%3D');
        const api = renderApp({ 'POST /api/auth/reset-password': () => empty(204) }, true);

        await chooseNewPassword(actor);

        expect(await screen.findByText(/your password is changed/i)).toBeInTheDocument();
        const [reset] = api.callsTo('POST', '/api/auth/reset-password');
        expect(reset.body).toEqual({ userId: 'user-1', token: 'CfDJ8+a/b=', password: NEW_PASSWORD });
        expectSentThroughApiFetch(reset);

        await actor.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(await screen.findByRole('dialog', { name: 'Sign In' })).toBeInTheDocument();
    });

    it("signs this browser out at once when it was signed in as the account, since the reset ended that session", async () => {
        const actor = quickActor();
        window.history.replaceState(null, '', '/reset-password#user=user-1&token=secret');
        renderApp({
            'GET /api/auth/me': () => json(ALEX),
            'POST /api/auth/reset-password': () => empty(204),
        }, true);
        expect(await screen.findByText('Signed in as alex')).toBeInTheDocument();

        await chooseNewPassword(actor);

        await waitFor(() => expect(screen.getByText('Nobody is signed in')).toBeInTheDocument());
    });

    it('keeps a different account signed in, whose sessions the reset did not touch', async () => {
        const actor = quickActor();
        window.history.replaceState(null, '', '/reset-password#user=someone-else&token=secret');
        renderApp({
            'GET /api/auth/me': () => json(ALEX),
            'POST /api/auth/reset-password': () => empty(204),
        }, true);
        expect(await screen.findByText('Signed in as alex')).toBeInTheDocument();

        await chooseNewPassword(actor);

        expect(await screen.findByText(/your password is changed/i)).toBeInTheDocument();
        expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
    });

    it("reads the API's refusal of the link as a link to replace, and offers to ask for one", async () => {
        const actor = quickActor();
        window.history.replaceState(null, '', '/reset-password#user=user-1&token=old');
        renderApp({ 'POST /api/auth/reset-password': () => json({ message: LINK_REFUSED, invalidLink: true }, 400) }, true);

        await chooseNewPassword(actor);

        expect(await screen.findByText(LINK_REFUSED)).toBeInTheDocument();
        await actor.click(screen.getByRole('button', { name: 'Ask for a new link' }));
        expect(await screen.findByRole('dialog', { name: 'Forgot your password?' })).toBeInTheDocument();
    });

    it("shows every one of Identity's reasons for refusing the password, beside the form", async () => {
        const actor = quickActor();
        window.history.replaceState(null, '', '/reset-password#user=user-1&token=secret');
        renderApp({
            'POST /api/auth/reset-password': () => json({
                errors: [
                    "Passwords must have at least one digit ('0'-'9').",
                    'Passwords must be at least 8 characters.',
                ],
            }, 400),
        }, true);

        await chooseNewPassword(actor);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Passwords must have at least one digit ('0'-'9').");
        expect(alert).toHaveTextContent('Passwords must be at least 8 characters.');
        expect(screen.getByLabelText('New password')).toBeInTheDocument();
    });
});
