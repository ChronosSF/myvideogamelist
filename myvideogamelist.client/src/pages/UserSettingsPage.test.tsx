import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub, type MetaDescriptor } from 'react-router';
import { UserPage } from '@/pages/UserPage';
import UserSettingsPage, { meta } from '@/pages/UserSettingsPage';
import UserTrackingPage from '@/pages/UserTrackingPage';
import { AuthContext, type AuthContextValue } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/auth';
import { userProfile } from '@/test/factories';

/**
 * Auth, supplied through its context rather than by `AuthProvider`, which fetches. The context rather
 * than a mock of `useAuth`, because the router stub memoises its routes: a rerender from outside it
 * never reaches the page, while a new context value does, as a change of account does in the app.
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

function signedIn(user: UserProfile): AuthContextValue {
    return { user, loading: false, ...actions };
}

/** Each card that reads a provider this page does not mount, or makes a request of its own, stands in. */
vi.mock('@/components/ProfileStats', () => ({
    ProfileStats: ({ userId }: { userId: string }) => <div>tracking for {userId}</div>,
}));

vi.mock('@/components/ProfileHistory', () => ({
    ProfileHistory: ({ userId }: { userId: string }) => <div>history for {userId}</div>,
}));

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

/** The tab makes no request of its own, so a stray fetch fails loudly. */
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

function renderSettings(user: UserProfile = userProfile()) {
    stubFetch();
    const page = (value: AuthContextValue) => (
        <AuthContext.Provider value={value}>
            <Stub initialEntries={['/user/settings']} />
        </AuthContext.Provider>
    );
    const view = render(page(signedIn(user)));
    return { ...view, signedInAs: (next: UserProfile) => view.rerender(page(signedIn(next))) };
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

/** The sections, in the order the index lists them. */
const SECTIONS = [
    { id: 'account', title: 'Account' },
    { id: 'profile-page', title: 'Your profile page' },
    { id: 'look', title: 'Look' },
    { id: 'lists-and-tags', title: 'Lists and tags' },
    { id: 'your-data', title: 'Import and your data' },
];

describe('UserSettingsPage meta', () => {
    type Tag = MetaDescriptor & Partial<Record<'title' | 'name' | 'content' | 'rel', string>>;
    const tags = () => meta() as Tag[];

    it('is titled for the tab rather than for the profile around it', () => {
        expect(tags().find(tag => tag.title !== undefined)?.title).toBe('Settings - MyVideoGameList');
    });

    it('keeps itself out of the index, and so names no canonical URL', () => {
        // A leaf's meta replaces its parent's, so the layout's noindex does not carry over on its own.
        expect(tags().some(tag => tag.name === 'robots' && tag.content?.includes('noindex'))).toBe(true);
        expect(tags().find(tag => tag.rel === 'canonical')).toBeUndefined();
    });
});

describe('UserSettingsPage index', () => {
    it('lists the sections in order, each by a link to its own address on the page', () => {
        renderSettings();

        const index = screen.getByRole('navigation', { name: 'Settings' });
        const links = within(index).getAllByRole('link');

        expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual(
            SECTIONS.map(section => [section.title, `#${section.id}`]),
        );
    });

    it('has every section it lists, under the heading it is listed by', () => {
        renderSettings();

        for (const { id, title } of SECTIONS) {
            const section = screen.getByRole('region', { name: title });
            expect(section).toHaveAttribute('id', id);
            expect(within(section).getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
        }
    });
});

describe('UserSettingsPage sections', () => {
    it('keeps the email, the handle, the switch for who can see the profile and the sign-out under Account', () => {
        // The header's "Who can see it" leads to #account, so the switch has to be here.
        renderSettings(userProfile({ email: 'alex@test.local', userName: 'alex' }));

        const account = screen.getByRole('region', { name: 'Account' });
        expect(within(account).getByText('alex@test.local')).toBeInTheDocument();
        expect(within(account).getByText('Only you can see this.')).toBeInTheDocument();
        expect(within(account).getByText('@alex')).toBeInTheDocument();
        expect(within(account).getByRole('checkbox', { name: 'Make my profile public' })).toBeInTheDocument();
        expect(within(account).getByRole('button', { name: 'Sign Out' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('puts the profile details, the look, the lists and tags, and the data each in its own section', () => {
        renderSettings();

        expect(within(screen.getByRole('region', { name: 'Your profile page' })).getByLabelText('Display name'))
            .toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Look' })).getByText('look')).toBeInTheDocument();

        const lists = screen.getByRole('region', { name: 'Lists and tags' });
        expect(within(lists).getByText('list names')).toBeInTheDocument();
        expect(within(lists).getByText('tags')).toBeInTheDocument();

        const data = screen.getByRole('region', { name: 'Import and your data' });
        expect(within(data).getByRole('link', { name: 'Start an import' })).toHaveAttribute('href', '/import');
        expect(within(data).getByRole('button', { name: 'Download my data' })).toBeInTheDocument();
        expect(within(data).getByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
    });

    it('leaves the tracking to its own tab', () => {
        const user = userProfile();
        renderSettings(user);

        expect(screen.queryByText('favourites')).not.toBeInTheDocument();
        expect(screen.queryByText(`tracking for ${user.id}`)).not.toBeInTheDocument();
        expect(screen.queryByText(`history for ${user.id}`)).not.toBeInTheDocument();
    });
});

describe('UserSettingsPage profile details', () => {
    it('never shows one account\'s half-typed details under another', async () => {
        // Both accounts have nothing stored, so only the card's key tells their drafts apart: without
        // it, a display name typed by one would sit, ready to save, under the other's name.
        const actor = userEvent.setup();
        const view = renderSettings(userProfile({ id: 'user-1', userName: 'alex' }));

        await actor.type(screen.getByLabelText('Display name'), 'Alex Smith');
        expect(screen.getByLabelText('Display name')).toHaveValue('Alex Smith');

        view.signedInAs(userProfile({ id: 'user-2', userName: 'sam', email: 'sam@test.local' }));

        // The new account is the one on the page, so the empty field is its own and not a stale render.
        expect(screen.getByText('sam@test.local')).toBeInTheDocument();
        expect(screen.getByLabelText('Display name')).toHaveValue('');
    });
});
