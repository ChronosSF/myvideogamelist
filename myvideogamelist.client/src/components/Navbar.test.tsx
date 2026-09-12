import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
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

/** A data router rather than MemoryRouter, so a test can navigate without touching the navbar. */
function renderNavbar(path = '/') {
    const router = createMemoryRouter([{ path: '*', element: <Navbar /> }], { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return router;
}

/**
 * The main menu's button, and the panel it says it controls. Found through `aria-controls` because
 * that is the relationship under test: jsdom applies no stylesheet, so the bar's own copy of the
 * links is on screen here too.
 */
function mainMenu() {
    const button = screen.getByRole('button', { name: 'Main menu' });
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('The main menu button controls nothing.');
    return { button, panel };
}

function linkNames(panel: HTMLElement) {
    return within(panel).getAllByRole('link').map(link => link.textContent);
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
        // Queried on the whole bar rather than within the navigation landmark: there are two of
        // those, the bar's row and the main menu's panel, and a closed panel is `hidden`, so only
        // the row's links are on screen.
        renderNavbar();

        expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '/lists');
        expect(screen.queryByRole('link', { name: 'Wishlist' })).not.toBeInTheDocument();
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

describe('Navbar main menu', () => {
    it('starts collapsed', () => {
        authAnswered(null);
        renderNavbar();
        const { button, panel } = mainMenu();

        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(panel).not.toBeVisible();
    });

    it('opens from the keyboard, as the first stop in the page', async () => {
        authAnswered(null);
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.tab();
        expect(button).toHaveFocus();

        await actor.keyboard('{Enter}');

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(panel).toBeVisible();
    });

    it('opens to the same links as the bar, with no wishlist for a visitor', async () => {
        authAnswered(null);
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(panel).toBeVisible();
        expect(linkNames(panel)).toEqual(['Home', 'Games', 'Lists']);
    });

    it('offers the wishlist once signed in', async () => {
        authAnswered(ALEX);
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);

        expect(linkNames(panel)).toEqual(['Home', 'Games', 'Lists', 'Wishlist']);
    });

    it('marks the page you are on', async () => {
        authAnswered(null);
        const actor = userEvent.setup();
        renderNavbar('/games');
        const { button, panel } = mainMenu();

        await actor.click(button);

        expect(within(panel).getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page');
        expect(within(panel).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('closes once a link is followed', async () => {
        authAnswered(null);
        const actor = userEvent.setup();
        const router = renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);
        await actor.click(within(panel).getByRole('link', { name: 'Games' }));

        expect(router.state.location.pathname).toBe('/games');
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on Escape and hands focus back to its button', async () => {
        authAnswered(null);
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);
        await actor.tab();
        expect(within(panel).getByRole('link', { name: 'Home' })).toHaveFocus();

        await actor.keyboard('{Escape}');

        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(button).toHaveFocus();
    });

    it('closes when focus moves past its last link', async () => {
        // Otherwise a keyboard user carries on into the page with the panel still covering it.
        authAnswered(null);
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);
        await actor.tab();
        await actor.tab();
        await actor.tab();
        expect(within(panel).getByRole('link', { name: 'Lists' })).toHaveFocus();

        await actor.tab();

        expect(screen.getByRole('link', { name: 'MyVideoGameList' })).toHaveFocus();
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes when the scrim is tapped', async () => {
        // The only page-level way to dismiss the panel. Queried by class for the same reason as the
        // user menu's layer: it is presentational, with no role of its own.
        authAnswered(null);
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);
        const scrim = document.querySelector<HTMLElement>('.navbar-scrim');
        expect(scrim).toBeInTheDocument();

        await actor.click(scrim!);

        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(panel).not.toBeVisible();
        expect(document.querySelector('.navbar-scrim')).not.toBeInTheDocument();
    });

    it('closes when the page changes under it, and stays closed coming back', async () => {
        // A back-swipe: nothing in the menu is touched and no focus moves. Coming back to the page
        // it was opened on is the case a comparison against the opening location would get wrong.
        authAnswered(null);
        const actor = userEvent.setup();
        const router = renderNavbar();
        const { button } = mainMenu();

        await actor.click(button);
        await act(() => router.navigate('/games'));

        expect(button).toHaveAttribute('aria-expanded', 'false');

        await act(() => router.navigate(-1));

        expect(router.state.location.pathname).toBe('/');
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('Navbar user menu', () => {
    it('is a popup button that reports whether it is open', async () => {
        authAnswered(ALEX);
        const actor = userEvent.setup();
        renderNavbar();
        const button = screen.getByRole('button', { name: 'User menu' });

        expect(button).toHaveAttribute('aria-haspopup', 'true');
        expect(button).toHaveAttribute('aria-expanded', 'false');

        await actor.click(button);

        expect(button).toHaveAttribute('aria-expanded', 'true');
        const menu = screen.getByRole('menu');
        expect(within(menu).getByText('@alex')).toBeInTheDocument();
        expect(within(menu).getByRole('menuitem', { name: 'My Profile' })).toHaveAttribute('href', '/user');
        expect(within(menu).getByRole('menuitem', { name: 'Sign Out' })).toBeInTheDocument();
    });

    it('has no public page to offer for a private profile', async () => {
        authAnswered(ALEX);
        const actor = userEvent.setup();
        renderNavbar();

        await actor.click(screen.getByRole('button', { name: 'User menu' }));

        expect(screen.queryByRole('menuitem', { name: 'My public page' })).not.toBeInTheDocument();
    });

    it('links to the public page of a public profile', async () => {
        authAnswered({ ...ALEX, profileVisibility: 'public' });
        const actor = userEvent.setup();
        renderNavbar();

        await actor.click(screen.getByRole('button', { name: 'User menu' }));

        expect(screen.getByRole('menuitem', { name: 'My public page' })).toHaveAttribute('href', '/u/alex');
    });

    it('closes when the page behind it is clicked', async () => {
        // The click-away layer covers the viewport only because the bar's blur sits on a
        // pseudo-element rather than on the bar, which would make the bar the containing block for
        // anything fixed inside it. Queried by class because the layer is presentational and has
        // no role to find it by. jsdom has no layout, so this holds the layer's presence and its
        // handler; that it lies over the page is the CSS half, checked in a browser.
        authAnswered(ALEX);
        const actor = userEvent.setup();
        renderNavbar();
        const button = screen.getByRole('button', { name: 'User menu' });

        await actor.click(button);
        const overlay = document.querySelector<HTMLElement>('.navbar-dropdown-overlay');
        expect(overlay).toBeInTheDocument();

        await actor.click(overlay!);

        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(document.querySelector('.navbar-dropdown-overlay')).not.toBeInTheDocument();
    });

    it('never shares the screen with the main menu', () => {
        // fireEvent rather than userEvent: Safari moves no focus on a click, so the main menu's
        // focus-out close cannot be what closes it here.
        authAnswered(ALEX);
        renderNavbar();
        const { button } = mainMenu();
        const userButton = screen.getByRole('button', { name: 'User menu' });

        fireEvent.click(button);
        fireEvent.click(userButton);

        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(userButton).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(button);

        expect(userButton).toHaveAttribute('aria-expanded', 'false');
        expect(button).toHaveAttribute('aria-expanded', 'true');
    });
});
