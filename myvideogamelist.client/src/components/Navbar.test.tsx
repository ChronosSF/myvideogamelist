import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Navbar } from '@/components/Navbar';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/auth';

/**
 * Auth, mocked rather than provided: the real provider fetches, and the navbar only reads what it
 * holds.
 *
 * One module-level object handed back on every call, never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure. Each test sets `user` and `loading` for the moment it is about.
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

const ALEX: UserProfile = {
    id: 'user-1',
    email: 'alex@test.local',
    userName: 'alex',
    theme: 'dark',
    profileVisibility: 'private',
};

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

function renderNavbar() {
    return render(<MemoryRouter><Navbar /></MemoryRouter>);
}

beforeEach(() => {
    // Where every visit starts, the server render included: nobody known yet.
    auth.user = null;
    auth.loading = true;
});

describe('Navbar before auth has answered', () => {
    it('shows neither the sign-in buttons nor the user menu', () => {
        // The server render is always in this state, so the first client render is too. Offering a
        // signed-in visitor Sign In and then swapping it for their avatar is the flash this prevents.
        renderNavbar();

        expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Sign Up' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'User menu' })).not.toBeInTheDocument();
    });

    it('holds back the Wishlist link, and only that one', () => {
        renderNavbar();

        const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
        expect(nav.getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '/lists');
        expect(nav.queryByRole('link', { name: 'Wishlist' })).not.toBeInTheDocument();
    });
});

describe('Navbar once auth has answered', () => {
    it('offers a signed-out visitor Sign In and Sign Up', () => {
        authAnswered(null);
        renderNavbar();

        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'User menu' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Wishlist' })).not.toBeInTheDocument();
    });

    it('shows a signed-in user their menu and the Wishlist link', () => {
        authAnswered(ALEX);
        renderNavbar();

        expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/wishlist');
        expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
    });
});
