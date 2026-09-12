import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ListsPage } from '@/pages/ListsPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import { DEFAULT_SORT } from '@/lib/listSort';
import type { UserProfile } from '@/types/auth';
import { emptyLists } from '@/types/list';
import { userProfile } from '@/test/factories';

/**
 * Auth and the lists, mocked rather than provided: both real providers fetch, and the page only
 * reads what they hold.
 *
 * One module-level object each, handed back on every call and never a fresh literal — a new object
 * per render re-runs any effect depending on it, which ends in a heap crash rather than an
 * assertion failure. Each test sets the fields for the moment it is about.
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

const lists: ListsContextValue = {
    lists: emptyLists(),
    loading: false,
    error: null,
    mutationError: null,
    isPending: () => false,
    addToList: vi.fn(async () => {}),
    removeFromList: vi.fn(async () => {}),
    isInList: () => false,
    getListFor: () => null,
    scoreFor: () => null,
    setScore: vi.fn(async () => true),
    deleteEntry: vi.fn(async () => {}),
    view: 'tiles',
    setView: vi.fn(),
    sortFor: () => DEFAULT_SORT,
    setSort: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

function renderPage() {
    return render(<MemoryRouter><ListsPage /></MemoryRouter>);
}

beforeEach(() => {
    // Where every visit starts, the server render included: nobody known yet, and a provider that
    // has not been told whose lists to fetch, so it is not loading anything either.
    auth.user = null;
    auth.loading = true;
    lists.loading = false;
    lists.error = null;
});

describe('ListsPage before auth has answered', () => {
    it('shows its loading state rather than asking the visitor to sign in', () => {
        // The server render is always in this state, so the first client render is too. Asking a
        // signed-in visitor to sign in here and then taking it back is the flash this prevents.
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent(/loading your lists/i);
        expect(screen.queryByText(/sign in to manage your game lists/i)).not.toBeInTheDocument();
    });
});

describe('ListsPage once auth has answered', () => {
    it('asks a signed-out visitor to sign in', () => {
        authAnswered(null);
        renderPage();

        expect(screen.getByText(/sign in to manage your game lists/i)).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it("keeps the same loading state while a signed-in user's lists load", () => {
        // The lists are asked for as soon as auth answers, so the two waits read as one.
        authAnswered(userProfile());
        lists.loading = true;
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent(/loading your lists/i);
        expect(screen.queryByText(/sign in to manage your game lists/i)).not.toBeInTheDocument();
    });

    it('shows a signed-in user their lists', () => {
        authAnswered(userProfile());
        renderPage();

        expect(screen.getByText(/no games in playing yet/i)).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText(/sign in to manage your game lists/i)).not.toBeInTheDocument();
    });
});
