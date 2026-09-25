import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { UserPage } from '@/pages/UserPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/auth';
import { userProfile } from '@/test/factories';

/**
 * Auth, mocked rather than provided: the real provider fetches, and this page only reads what it
 * holds.
 *
 * One module-level object handed back on every call, never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure.
 */
const auth: AuthContextValue = {
    user: null,
    loading: true,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

/**
 * The tracking block has its own test file and three requests of its own. These tests are about
 * the page around it.
 */
vi.mock('@/components/ProfileStats', () => ({
    ProfileStats: ({ userId }: { userId: string }) => <div>tracking for {userId}</div>,
}));

/** Likewise the favourites and the list names, which read providers this page does not mount. */
vi.mock('@/components/FavouritesShowcase', () => ({
    FavouritesShowcase: () => <div>favourites</div>,
}));

vi.mock('@/components/ListNamesCard', () => ({
    ListNamesCard: () => <div>list names</div>,
}));

/**
 * Answers nothing, because the page makes no request of its own — everything it shows either comes
 * from auth or belongs to a child mocked above — so a stray fetch fails loudly.
 */
function stubFetch() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        throw new Error(`unexpected fetch: ${String(input)}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

function renderPage() {
    return render(<MemoryRouter><UserPage /></MemoryRouter>);
}

beforeEach(() => {
    vi.unstubAllGlobals();
    // Where every visit starts, the server render included: nobody known yet.
    auth.user = null;
    auth.loading = true;
    vi.mocked(auth.updateTheme).mockReset();
    vi.mocked(auth.updateTheme).mockResolvedValue(undefined);
});

describe('UserPage before the account is known', () => {
    it('says it is loading rather than that nobody is signed in', () => {
        // The server render never knows who is signed in and neither does the first client render,
        // so without this every visit opened on the signed-out page and then replaced it.
        stubFetch();
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent(/loading your profile/i);
        expect(screen.queryByText(/sign in to see your profile/i)).not.toBeInTheDocument();
    });

    it('asks a signed-out visitor to sign in once that is settled', () => {
        authAnswered(null);
        stubFetch();
        renderPage();

        expect(screen.getByText(/sign in to see your profile/i)).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('asks for nothing while nobody is signed in', () => {
        authAnswered(null);
        const fetchMock = stubFetch();
        renderPage();

        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('UserPage account deletion', () => {
    beforeEach(() => {
        authAnswered(userProfile());
        vi.mocked(auth.deleteAccount).mockReset();
    });

    /**
     * Deletes through the dialog, as a user would. The confirming button is found inside the dialog,
     * because the card's own button that opened it has the same name.
     */
    async function deleteThroughDialog(actor: ReturnType<typeof userEvent.setup>) {
        await actor.click(screen.getByRole('button', { name: 'Delete my account' }));
        const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
        await actor.type(within(dialog).getByLabelText('Password'), 'Passw0rd1');
        await actor.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    }

    it('says the account is gone rather than asking the user to sign in', async () => {
        // The provider signs the user out as part of deleting them. Without the page knowing why,
        // the render that follows would ask somebody who has just deleted their account to sign in.
        const actor = userEvent.setup();
        stubFetch();
        vi.mocked(auth.deleteAccount).mockImplementation(async () => { auth.user = null; });
        const view = renderPage();

        await deleteThroughDialog(actor);
        await waitFor(() => expect(auth.deleteAccount).toHaveBeenCalledWith('Passw0rd1'));
        view.rerender(<MemoryRouter><UserPage /></MemoryRouter>);

        expect(await screen.findByText('Your account has been deleted.')).toBeInTheDocument();
        expect(screen.queryByText(/sign in to see your profile/i)).not.toBeInTheDocument();
    });

    it('keeps the profile when the deletion is refused', async () => {
        const actor = userEvent.setup();
        stubFetch();
        vi.mocked(auth.deleteAccount).mockRejectedValue(new Error('Password is incorrect.'));
        renderPage();

        await deleteThroughDialog(actor);

        expect(await screen.findByText('Password is incorrect.')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Delete your account?' })).toBeInTheDocument();
        expect(screen.queryByText('Your account has been deleted.')).not.toBeInTheDocument();
    });
});

describe('UserPage appearance', () => {
    beforeEach(() => authAnswered(userProfile()));

    it('names the switch for the state it turns on, not the action', async () => {
        // "Switch to light mode, checked" says nothing about which mode is on.
        const actor = userEvent.setup();
        stubFetch();
        renderPage();

        const toggle = screen.getByRole('checkbox', { name: 'Light mode' });
        expect(toggle).not.toBeChecked();

        await actor.click(toggle);

        await waitFor(() => expect(auth.updateTheme).toHaveBeenCalledWith('light'));
    });
});
