import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthContext, type AuthContextValue } from '@/contexts/AuthContext';
import { AuthDialogContext, type AuthDialogContextValue } from '@/contexts/AuthDialogContext';
import { ReportButton } from '@/components/ReportButton';
import { empty, expectSentThroughApiFetch, json, stubApi, tearDownApi, unreachable } from '@/test/api';
import { userProfile } from '@/test/factories';
import type { ReportTarget } from '@/types/moderation';

/** Signed in as `reader` unless a test says otherwise. Hoisted, so every render hands back one object. */
const signedIn: AuthContextValue = {
    user: userProfile({ userName: 'reader' }),
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => ({ emailSent: true })),
    resendConfirmation: vi.fn(async () => {}),
    confirmEmail: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    updateLook: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};
const signedOut: AuthContextValue = { ...signedIn, user: null };
const answering: AuthContextValue = { ...signedIn, user: null, loading: true };
const dialogs: AuthDialogContextValue = { open: vi.fn() };

const REVIEW: ReportTarget = { userName: 'Alex', gameId: 1942 };

function renderButton(auth: AuthContextValue | null = signedIn, target: ReportTarget = REVIEW) {
    const button = <ReportButton target={target} subject="Alex's review" label="Report Alex's review" />;
    return render(
        auth === null ? button : (
            <AuthContext.Provider value={auth}>
                <AuthDialogContext.Provider value={dialogs}>{button}</AuthDialogContext.Provider>
            </AuthContext.Provider>
        ),
    );
}

const reportButton = () => screen.getByRole('button', { name: "Report Alex's review" });

afterEach(() => {
    tearDownApi();
    vi.clearAllMocks();
});

describe('ReportButton', () => {
    it('is drawn for somebody signed out, and opens the sign-in dialog rather than a report', async () => {
        renderButton(signedOut);

        await userEvent.click(reportButton());

        expect(dialogs.open).toHaveBeenCalledWith('login');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does nothing while auth has not answered, rather than ask somebody signed in to sign in', async () => {
        renderButton(answering);

        await userEvent.click(reportButton());

        expect(dialogs.open).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is drawn without the app\'s providers, as a list drawn on its own draws it', () => {
        renderButton(null);

        expect(reportButton()).toBeInTheDocument();
    });

    it('is not drawn under the reader\'s own review, whatever the letter case of the handle', () => {
        renderButton({ ...signedIn, user: userProfile({ userName: 'alex' }) });

        expect(screen.queryByRole('button', { name: /report/i })).not.toBeInTheDocument();
    });

    it('sends the reason and the note through apiFetch, then thanks the reader', async () => {
        const api = stubApi({ 'POST /api/reports': () => empty(204) });
        renderButton();

        await userEvent.click(reportButton());
        expect(screen.getByRole('dialog', { name: "Report Alex's review" })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: 'Pretends to be somebody else' }));
        await userEvent.type(screen.getByLabelText(/anything an admin should know/i), 'That is my name.');
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        const [call] = api.callsTo('POST', '/api/reports');
        expectSentThroughApiFetch(call);
        expect(call.body).toEqual({ userName: 'Alex', gameId: 1942, reason: 'impersonation', note: 'That is my name.' });
        expect(await screen.findByRole('heading', { name: 'Thank you' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });

    it('reports a profile with no game, and an empty note as none', async () => {
        const api = stubApi({ 'POST /api/reports': () => empty(204) });
        renderButton(signedIn, { userName: 'Alex' });

        await userEvent.click(reportButton());
        await userEvent.click(screen.getByRole('radio', { name: 'Spam' }));
        await userEvent.type(screen.getByLabelText(/anything an admin should know/i), '   ');
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        expect(api.callsTo('POST', '/api/reports')[0].body).toEqual({ userName: 'Alex', gameId: null, reason: 'spam', note: null });
    });

    it('asks for a reason before sending anything', async () => {
        const api = stubApi({});
        renderButton();

        await userEvent.click(reportButton());
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Choose what is wrong with it.');
        expect(api.writes()).toHaveLength(0);
    });

    it('says when there is nothing left to report, because it was withdrawn since the page loaded', async () => {
        stubApi({ 'POST /api/reports': () => empty(404) });
        renderButton();

        await userEvent.click(reportButton());
        await userEvent.click(screen.getByRole('radio', { name: 'Spam' }));
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/no longer published/i);
        expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
    });

    it("shows the server's own sentence for a refused note", async () => {
        stubApi({
            'POST /api/reports': () => json(
                { title: 'One or more validation errors occurred.', errors: { Note: ['The note is too long.'] } }, 400),
        });
        renderButton();

        await userEvent.click(reportButton());
        await userEvent.click(screen.getByRole('radio', { name: 'Spam' }));
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('The note is too long.');
    });

    it('says the report was not sent when the server cannot be reached', async () => {
        stubApi({ 'POST /api/reports': () => unreachable() });
        renderButton();

        await userEvent.click(reportButton());
        await userEvent.click(screen.getByRole('radio', { name: 'Spam' }));
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be reached/i);
    });

    it('closes on Cancel, having sent nothing', async () => {
        const api = stubApi({});
        renderButton();

        await userEvent.click(reportButton());
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(api.writes()).toHaveLength(0);
    });
});
