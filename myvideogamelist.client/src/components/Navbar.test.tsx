import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Navbar } from '@/components/Navbar';
import type { UserProfile } from '@/types/auth';

/**
 * One module-level object handed back on every call, never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure.
 */
const authValue = {
    user: null as UserProfile | null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue }));

function user(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        id: 'user-1',
        email: 'alex@test.local',
        userName: 'alex',
        theme: 'dark',
        profileVisibility: 'private',
        ...overrides,
    };
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
    authValue.user = null;
});

describe('Navbar main menu', () => {
    it('starts collapsed', () => {
        renderNavbar();
        const { button, panel } = mainMenu();

        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(panel).not.toBeVisible();
    });

    it('opens from the keyboard, as the first stop in the page', async () => {
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
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(panel).toBeVisible();
        expect(linkNames(panel)).toEqual(['Home', 'Games', 'Lists']);
    });

    it('offers the wishlist once signed in', async () => {
        authValue.user = user();
        const actor = userEvent.setup();
        renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);

        expect(linkNames(panel)).toEqual(['Home', 'Games', 'Lists', 'Wishlist']);
    });

    it('marks the page you are on', async () => {
        const actor = userEvent.setup();
        renderNavbar('/games');
        const { button, panel } = mainMenu();

        await actor.click(button);

        expect(within(panel).getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page');
        expect(within(panel).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    });

    it('closes once a link is followed', async () => {
        const actor = userEvent.setup();
        const router = renderNavbar();
        const { button, panel } = mainMenu();

        await actor.click(button);
        await actor.click(within(panel).getByRole('link', { name: 'Games' }));

        expect(router.state.location.pathname).toBe('/games');
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes on Escape and hands focus back to its button', async () => {
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

    it('closes when the page changes under it, and stays closed coming back', async () => {
        // A back-swipe: nothing in the menu is touched and no focus moves. Coming back to the page
        // it was opened on is the case a comparison against the opening location would get wrong.
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
        authValue.user = user();
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
        authValue.user = user();
        const actor = userEvent.setup();
        renderNavbar();

        await actor.click(screen.getByRole('button', { name: 'User menu' }));

        expect(screen.queryByRole('menuitem', { name: 'My public page' })).not.toBeInTheDocument();
    });

    it('links to the public page of a public profile', async () => {
        authValue.user = user({ profileVisibility: 'public' });
        const actor = userEvent.setup();
        renderNavbar();

        await actor.click(screen.getByRole('button', { name: 'User menu' }));

        expect(screen.getByRole('menuitem', { name: 'My public page' })).toHaveAttribute('href', '/u/alex');
    });

    it('never shares the screen with the main menu', () => {
        // fireEvent rather than userEvent: Safari moves no focus on a click, so the main menu's
        // focus-out close cannot be what closes it here.
        authValue.user = user();
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

describe('Navbar signed out', () => {
    it('offers sign in and sign up in place of the user menu', () => {
        renderNavbar();

        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'User menu' })).not.toBeInTheDocument();
    });
});
