import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { GamePage } from '@/pages/GamePage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/auth';
import { game, userProfile } from '@/test/factories';

/**
 * Auth, mocked rather than provided: the real provider fetches, and the page only reads `user` and
 * `loading`.
 *
 * One module-level object handed back on every call and never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure. Each test sets the fields for the moment it is about.
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
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

// All three fetch for themselves after hydration. What this suite is about is which of three things
// the sidebar shows, so the panel — which has a suite of its own — is reduced to the heading a
// reader knows it by, and the two sections that render nothing until their fetch answers are left
// out.
vi.mock('@/components/GameUserPanel', () => ({ GameUserPanel: () => <h2>Your copy</h2> }));
vi.mock('@/components/CompletionTimes', () => ({ CompletionTimes: () => null }));
vi.mock('@/components/GameNewsPanel', () => ({ GameNewsPanel: () => null }));

const CELESTE = game({ id: 1, title: 'Celeste' });

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

/** The route with its loader's answer already in hand, as it is on the server. */
function renderPage() {
    const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
    return render(
        <Stub
            initialEntries={['/games/1']}
            hydrationData={{ loaderData: { game: { game: CELESTE } } }}
        />,
    );
}

beforeEach(() => {
    auth.user = null;
    auth.loading = true;
});

describe('GamePage sidebar before auth has answered', () => {
    it('holds the slot without the panel, a sign-in prompt or a spinner', () => {
        // Every server render is in this state — the page is shared-cached, so it cannot know who
        // is asking — and so is the first client render. It is what every visitor sees first, and
        // what the edge keeps.
        renderPage();

        expect(screen.getByRole('heading', { level: 1, name: 'Celeste' })).toBeInTheDocument();

        const sidebar = screen.getByRole('complementary');
        expect(within(sidebar).queryByRole('heading', { name: 'Your copy' })).not.toBeInTheDocument();
        expect(within(sidebar).queryByText(/sign in to track this game/i)).not.toBeInTheDocument();
        expect(within(sidebar).queryByRole('status')).not.toBeInTheDocument();
    });
});

describe('GamePage sidebar once auth has answered', () => {
    it('asks a signed-out visitor to sign in', () => {
        authAnswered(null);
        renderPage();

        expect(screen.getByText(/sign in to track this game/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Your copy' })).not.toBeInTheDocument();
    });

    it('shows a signed-in user their panel', () => {
        authAnswered(userProfile());
        renderPage();

        expect(screen.getByRole('heading', { name: 'Your copy' })).toBeInTheDocument();
        expect(screen.queryByText(/sign in to track this game/i)).not.toBeInTheDocument();
    });
});
