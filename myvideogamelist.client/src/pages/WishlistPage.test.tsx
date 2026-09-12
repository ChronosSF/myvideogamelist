import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WishlistPage } from '@/pages/WishlistPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import type { UserProfile } from '@/types/auth';
import { userProfile } from '@/test/factories';

/**
 * Auth and the wishlist, mocked rather than provided: both real providers fetch, and the page only
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

const wishlist: WishlistContextValue = {
    items: [],
    loading: false,
    error: null,
    mutationError: null,
    isWishlisted: () => false,
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    reload: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

function renderPage() {
    return render(<MemoryRouter><WishlistPage /></MemoryRouter>);
}

beforeEach(() => {
    // Where every visit starts, the server render included: nobody known yet, and a provider that
    // has not been told whose wishlist to fetch, so it is not loading anything either.
    auth.user = null;
    auth.loading = true;
    wishlist.loading = false;
    wishlist.error = null;
});

describe('WishlistPage before auth has answered', () => {
    it('shows its loading state rather than asking the visitor to sign in', () => {
        // The server render is always in this state, so the first client render is too. Asking a
        // signed-in visitor to sign in here and then taking it back is the flash this prevents.
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent(/loading your wishlist/i);
        expect(screen.queryByText(/sign in to keep a wishlist/i)).not.toBeInTheDocument();
    });
});

describe('WishlistPage once auth has answered', () => {
    it('asks a signed-out visitor to sign in', () => {
        authAnswered(null);
        renderPage();

        expect(screen.getByText(/sign in to keep a wishlist/i)).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it("keeps the same loading state while a signed-in user's wishlist loads", () => {
        // The wishlist is asked for as soon as auth answers, so the two waits read as one.
        authAnswered(userProfile());
        wishlist.loading = true;
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent(/loading your wishlist/i);
        expect(screen.queryByText(/sign in to keep a wishlist/i)).not.toBeInTheDocument();
    });

    it('shows a signed-in user their wishlist', () => {
        authAnswered(userProfile());
        renderPage();

        expect(screen.getByText(/nothing on your wishlist yet/i)).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText(/sign in to keep a wishlist/i)).not.toBeInTheDocument();
    });
});
