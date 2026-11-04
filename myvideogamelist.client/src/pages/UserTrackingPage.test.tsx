import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { UserPage } from '@/pages/UserPage';
import UserSettingsPage from '@/pages/UserSettingsPage';
import UserTrackingPage from '@/pages/UserTrackingPage';
import { AuthContext, type AuthContextValue } from '@/contexts/AuthContext';
import type { ProfileVisibility, UserProfile } from '@/types/auth';
import { userProfile } from '@/test/factories';

/**
 * Auth, supplied through its context rather than by `AuthProvider`, which fetches: the tab only reads
 * the account the page above it hands down. One value per render, never a fresh one per call.
 */
const actions = {
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    updateLook: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
} satisfies Omit<AuthContextValue, 'user' | 'loading'>;

/**
 * The three blocks have test files of their own and requests of their own. These tests are about the tab
 * that holds them: which account each is for, and the order they are read in.
 */
vi.mock('@/components/FavouritesShowcase', () => ({
    FavouritesShowcase: ({ profileVisibility }: { profileVisibility: ProfileVisibility }) => (
        <div>favourites, {profileVisibility}</div>
    ),
}));

vi.mock('@/components/ProfileStats', () => ({
    ProfileStats: ({ userId }: { userId: string }) => <div>tracking for {userId}</div>,
}));

vi.mock('@/components/ProfileHistory', () => ({
    ProfileHistory: ({ userId }: { userId: string }) => <div>history for {userId}</div>,
}));

/** The tab makes no request of its own — each block above is mocked — so a stray fetch fails loudly. */
function stubFetch() {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        throw new Error(`unexpected fetch: ${String(input)}`);
    }));
}

/** The tab under the page it belongs to, as `routes.ts` nests them. */
const Stub = createRoutesStub([
    {
        path: '/user',
        Component: UserPage,
        children: [
            { index: true, Component: UserTrackingPage },
            { path: 'settings', Component: UserSettingsPage },
        ],
    },
]);

function renderTracking(user: UserProfile) {
    const auth: AuthContextValue = { user, loading: false, ...actions };
    return render(
        <AuthContext.Provider value={auth}>
            <Stub initialEntries={['/user']} />
        </AuthContext.Provider>,
    );
}

/** Whether `later` comes after `earlier` in the document. */
function follows(earlier: Node, later: Node) {
    return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('UserTrackingPage', () => {
    it('opens on the favourites, then the figures, then the history under them, for the signed-in account', () => {
        const user = userProfile({ id: 'user-1' });
        stubFetch();
        renderTracking(user);

        const favourites = screen.getByText(/^favourites/);
        const tracking = screen.getByText(`tracking for ${user.id}`);
        const history = screen.getByText(`history for ${user.id}`);

        expect(follows(favourites, tracking)).toBe(true);
        expect(follows(tracking, history)).toBe(true);
    });

    it('tells the favourites whether anybody else can see them', () => {
        stubFetch();
        renderTracking(userProfile({ profileVisibility: 'public' }));

        expect(screen.getByText('favourites, public')).toBeInTheDocument();
    });

    it('leaves the settings, and the email, to the Settings tab', () => {
        // The email identifies the account to us and is shown in one place only.
        stubFetch();
        renderTracking(userProfile({ email: 'alex@test.local' }));

        expect(screen.queryByRole('navigation', { name: 'Settings' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument();
        expect(screen.queryByText('alex@test.local')).not.toBeInTheDocument();
    });
});
