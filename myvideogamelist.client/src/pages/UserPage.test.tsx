import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub } from 'react-router';
import { UserPage } from '@/pages/UserPage';
import UserSettingsPage from '@/pages/UserSettingsPage';
import UserTrackingPage from '@/pages/UserTrackingPage';
import { AuthContext, type AuthContextValue } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/auth';
import { userProfile } from '@/test/factories';

/**
 * Auth, supplied through its context rather than by `AuthProvider`: the real provider fetches, and this
 * page only reads what it holds. The context rather than a mock of `useAuth`, because the router stub
 * memoises its routes — a rerender from outside it never reaches the page, while a new context value
 * does, which is how a change of account reaches it in the app too.
 *
 * The functions are module-level, so a test can assert on them whichever value it rendered with.
 */
const actions = {
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
    deleteAccount: vi.fn(async (_password: string) => {}),
} satisfies Omit<AuthContextValue, 'user' | 'loading'>;

/** `/api/auth/me` has come back, with an account or with nobody. */
function answered(user: UserProfile | null): AuthContextValue {
    return { user, loading: false, ...actions };
}

/** Where every visit starts, the server render included: nobody known yet. */
const UNANSWERED: AuthContextValue = { user: null, loading: true, ...actions };

/**
 * The tracking block has its own test file and three requests of its own. These tests are about
 * the page around it.
 */
vi.mock('@/components/ProfileStats', () => ({
    ProfileStats: ({ userId }: { userId: string }) => <div>tracking for {userId}</div>,
}));

/** And the history, which pages through its own endpoint and is tested beside itself. */
vi.mock('@/components/ProfileHistory', () => ({
    ProfileHistory: ({ userId }: { userId: string }) => <div>history for {userId}</div>,
}));

/** Likewise the favourites and the list names, which read providers this page does not mount. */
vi.mock('@/components/FavouritesShowcase', () => ({
    FavouritesShowcase: () => <div>favourites</div>,
}));

vi.mock('@/components/LookCard', () => ({
    LookCard: () => <div>look</div>,
}));

vi.mock('@/components/ListNamesCard', () => ({
    ListNamesCard: () => <div>list names</div>,
}));

vi.mock('@/components/TagsCard', () => ({
    TagsCard: () => <div>tags</div>,
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

/** The page and its two tabs as `routes.ts` nests them, and a home page for the sign-out to land on. */
const Stub = createRoutesStub([
    { path: '/', Component: () => <h1>Home</h1> },
    {
        path: '/user',
        Component: UserPage,
        children: [
            { index: true, Component: UserTrackingPage },
            { path: 'settings', Component: UserSettingsPage },
        ],
    },
]);

/** The page at one of its tabs' addresses, and a way to hand it what auth says next. */
function renderAt(path: '/user' | '/user/settings', auth: AuthContextValue) {
    const page = (value: AuthContextValue) => (
        <AuthContext.Provider value={value}>
            <Stub initialEntries={[path]} />
        </AuthContext.Provider>
    );
    const view = render(page(auth));
    return { ...view, authSays: (next: AuthContextValue) => view.rerender(page(next)) };
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('UserPage before the account is known', () => {
    it('says it is loading rather than that nobody is signed in', () => {
        // The server render never knows who is signed in and neither does the first client render,
        // so without this every visit opened on the signed-out page and then replaced it.
        stubFetch();
        renderAt('/user', UNANSWERED);

        expect(screen.getByRole('status')).toHaveTextContent(/loading your profile/i);
        expect(screen.queryByText(/sign in to see your profile/i)).not.toBeInTheDocument();
    });

    it('shows the tabs while it loads, so they do not arrive with the account', () => {
        stubFetch();
        renderAt('/user/settings', UNANSWERED);

        const tabs = screen.getByRole('navigation', { name: 'My profile' });
        expect(within(tabs).getByRole('link', { name: 'Your tracking' })).toHaveAttribute('href', '/user');
        expect(within(tabs).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    });

    it('asks a signed-out visitor to sign in once that is settled', () => {
        stubFetch();
        renderAt('/user', answered(null));

        expect(screen.getByText(/sign in to see your profile/i)).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('asks a signed-out visitor to sign in on the Settings tab too, and shows none of it', () => {
        stubFetch();
        renderAt('/user/settings', answered(null));

        expect(screen.getByText(/sign in to see your profile/i)).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Settings' })).not.toBeInTheDocument();
    });

    it('asks for nothing while nobody is signed in', () => {
        const fetchMock = stubFetch();
        renderAt('/user', answered(null));

        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('UserPage header', () => {
    it('names the reader by their handle, and says a private profile is private and where that is decided', () => {
        stubFetch();
        renderAt('/user', answered(userProfile({ userName: 'alex', profileVisibility: 'private' })));

        expect(screen.getByRole('heading', { level: 1, name: 'My Profile' })).toBeInTheDocument();
        expect(screen.getByText('@alex')).toBeInTheDocument();

        const where = screen.getByRole('link', { name: 'Who can see it' });
        expect(where).toHaveAttribute('href', '/user/settings#account');
        expect(where.parentElement).toHaveTextContent('Private profile · Who can see it');
        expect(screen.queryByRole('link', { name: 'See it as others do' })).not.toBeInTheDocument();
    });

    it('names a reader with a display name by it, keeps the handle beside it, and links a public profile', () => {
        stubFetch();
        renderAt('/user', answered(userProfile({
            userName: 'alex',
            displayName: 'Alex Smith',
            profileVisibility: 'public',
        })));

        expect(screen.getByText('Alex Smith')).toBeInTheDocument();
        expect(screen.getByText('@alex')).toBeInTheDocument();

        const asOthers = screen.getByRole('link', { name: 'See it as others do' });
        expect(asOthers).toHaveAttribute('href', '/u/alex');
        expect(asOthers.parentElement).toHaveTextContent('Public profile · See it as others do');
        expect(screen.queryByRole('link', { name: 'Who can see it' })).not.toBeInTheDocument();
    });
});

describe('UserPage tabs', () => {
    it('marks Your tracking as the page at /user, and links to the Settings tab', () => {
        stubFetch();
        renderAt('/user', answered(userProfile()));

        const tabs = screen.getByRole('navigation', { name: 'My profile' });
        const tracking = within(tabs).getByRole('link', { name: 'Your tracking' });
        const settings = within(tabs).getByRole('link', { name: 'Settings' });

        expect(tracking).toHaveAttribute('href', '/user');
        expect(tracking).toHaveAttribute('aria-current', 'page');
        expect(settings).toHaveAttribute('href', '/user/settings');
        expect(settings).not.toHaveAttribute('aria-current');
    });

    it('marks Settings as the page at /user/settings, and not Your tracking, whose address it extends', () => {
        stubFetch();
        renderAt('/user/settings', answered(userProfile()));

        const tabs = screen.getByRole('navigation', { name: 'My profile' });
        expect(within(tabs).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
        expect(within(tabs).getByRole('link', { name: 'Your tracking' })).not.toHaveAttribute('aria-current');
    });

    it('moves between the two under the same header', async () => {
        const user = userProfile();
        const actor = userEvent.setup();
        stubFetch();
        renderAt('/user', answered(user));

        const tabs = screen.getByRole('navigation', { name: 'My profile' });
        await actor.click(within(tabs).getByRole('link', { name: 'Settings' }));

        expect(await screen.findByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
        expect(screen.queryByText(`history for ${user.id}`)).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'My Profile' })).toBeInTheDocument();

        await actor.click(within(tabs).getByRole('link', { name: 'Your tracking' }));

        expect(await screen.findByText(`history for ${user.id}`)).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Settings' })).not.toBeInTheDocument();
    });
});

/**
 * Deleting and signing out are pressed on the Settings tab but owned by the page, because the render in
 * which the account disappears is the page's — so they are tested here, from that tab.
 */
describe('UserPage account deletion', () => {
    beforeEach(() => {
        vi.mocked(actions.deleteAccount).mockReset();
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
        const view = renderAt('/user/settings', answered(userProfile()));

        await deleteThroughDialog(actor);
        await waitFor(() => expect(actions.deleteAccount).toHaveBeenCalledWith('Passw0rd1'));
        view.authSays(answered(null));

        expect(await screen.findByText('Your account has been deleted.')).toBeInTheDocument();
        expect(screen.queryByText(/sign in to see your profile/i)).not.toBeInTheDocument();
    });

    it('keeps the profile when the deletion is refused', async () => {
        const actor = userEvent.setup();
        stubFetch();
        vi.mocked(actions.deleteAccount).mockRejectedValue(new Error('Password is incorrect.'));
        renderAt('/user/settings', answered(userProfile()));

        await deleteThroughDialog(actor);

        expect(await screen.findByText('Password is incorrect.')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Delete your account?' })).toBeInTheDocument();
        expect(screen.queryByText('Your account has been deleted.')).not.toBeInTheDocument();
    });
});

describe('UserPage signing out', () => {
    it('says why under the button when the sign-out does not happen', async () => {
        // The account is still signed in, so the page stays as it is and says so.
        vi.mocked(actions.logout).mockRejectedValueOnce(new Error('Could not sign you out. Please try again.'));
        const actor = userEvent.setup();
        stubFetch();
        renderAt('/user/settings', answered(userProfile()));

        await actor.click(screen.getByRole('button', { name: 'Sign Out' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign you out. Please try again.');
        expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    });

    it('holds the button while the request is out, without taking its focus, and asks only once', async () => {
        let finish = () => {};
        vi.mocked(actions.logout).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const actor = userEvent.setup();
        stubFetch();
        renderAt('/user/settings', answered(userProfile()));

        await actor.click(screen.getByRole('button', { name: 'Sign Out' }));
        const held = screen.getByRole('button', { name: 'Signing out…' });

        expect(held).toHaveAttribute('aria-disabled', 'true');
        expect(held).not.toBeDisabled();
        expect(held).toHaveFocus();

        await actor.click(held);
        expect(actions.logout).toHaveBeenCalledTimes(1);

        finish();
        expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    });

    it('goes home once the server agrees', async () => {
        const actor = userEvent.setup();
        stubFetch();
        renderAt('/user/settings', answered(userProfile()));

        await actor.click(screen.getByRole('button', { name: 'Sign Out' }));

        expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
        expect(actions.logout).toHaveBeenCalledTimes(1);
    });
});
