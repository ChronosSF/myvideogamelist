import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { GameCard } from '@/components/GameCard';
import { ListsContext, type ListsContextValue } from '@/contexts/ListsContext';
import { WishlistContext, type WishlistContextValue } from '@/contexts/WishlistContext';
import { DEFAULT_SORT } from '@/lib/listSort';
import { game } from '@/test/factories';

// Stable object: the card only reads `user`, and going through the real provider would mean
// mocking its fetches too.
vi.mock('@/hooks/useAuth', () => {
    const value = {
        user: { id: 'u1', email: 'alice@test.local', theme: 'dark' },
        loading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        updateTheme: vi.fn(),
    };
    return { useAuth: () => value };
});

const CELESTE = game({ id: 1, title: 'Celeste' });

function listsValue(overrides: Partial<ListsContextValue> = {}): ListsContextValue {
    return {
        lists: { backlog: [], playing: [], on_hold: [], finished: [], dropped: [] },
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
        ...overrides,
    };
}

function wishlistValue(overrides: Partial<WishlistContextValue> = {}): WishlistContextValue {
    return {
        items: [],
        loading: false,
        error: null,
        mutationError: null,
        isWishlisted: () => false,
        isPending: () => false,
        add: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        reload: vi.fn(),
        ...overrides,
    };
}

function renderCard(wishlistOverrides: Partial<WishlistContextValue> = {}) {
    const wishlist = wishlistValue(wishlistOverrides);
    render(
        <MemoryRouter>
            <ListsContext.Provider value={listsValue()}>
                <WishlistContext.Provider value={wishlist}>
                    <GameCard game={CELESTE} />
                </WishlistContext.Provider>
            </ListsContext.Provider>
        </MemoryRouter>,
    );
    return wishlist;
}

const wishlistButton = () => screen.getByRole('button', { name: 'Wishlist' });

describe('GameCard wishlist control', () => {
    it('offers the toggle alongside the five statuses', () => {
        renderCard();

        for (const name of ['Backlog', 'Playing', 'On Hold', 'Finished', 'Dropped', 'Wishlist']) {
            expect(screen.getByRole('button', { name }), name).toBeInTheDocument();
        }
    });

    it('marks a wishlisted game', () => {
        renderCard({ isWishlisted: () => true });

        expect(wishlistButton()).toHaveAttribute('aria-pressed', 'true');
    });

    it('adds the game, passing the whole DTO for the optimistic row', async () => {
        const wishlist = renderCard();

        await userEvent.click(wishlistButton());

        expect(wishlist.add).toHaveBeenCalledWith(CELESTE);
    });

    it('removes a game that is already wishlisted', async () => {
        const wishlist = renderCard({ isWishlisted: () => true });

        await userEvent.click(wishlistButton());

        expect(wishlist.remove).toHaveBeenCalledWith(1);
    });

    it('is disabled while its own mutation is in flight', () => {
        renderCard({ isPending: () => true });

        expect(wishlistButton()).toBeDisabled();
    });
});

describe('GameCard wishlist failure', () => {
    // Cards appear on Games, Home and the timeline, none of which render the provider's shared
    // mutationError. Without something on the card itself, a failed toggle would just snap the
    // heart back with no explanation.
    it('says so when the toggle fails', async () => {
        renderCard({ add: vi.fn(async () => false) });

        await userEvent.click(wishlistButton());

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(/could not update your wishlist/i));
    });

    it('says nothing when the toggle succeeds', async () => {
        renderCard({ add: vi.fn(async () => true) });

        await userEvent.click(wishlistButton());

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('clears the message when the next attempt succeeds', async () => {
        let fails = true;
        renderCard({ add: vi.fn(async () => { const ok = !fails; fails = false; return ok; }) });

        await userEvent.click(wishlistButton());
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

        await userEvent.click(wishlistButton());

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('puts the message outside the hover overlay, so it survives the pointer leaving', async () => {
        // The overlay is only visible on hover or tap. A failure message inside it would vanish
        // the moment the user moved the mouse, which is no message at all.
        const { container } = render(
            <MemoryRouter>
                <ListsContext.Provider value={listsValue()}>
                    <WishlistContext.Provider value={wishlistValue({ add: vi.fn(async () => false) })}>
                        <GameCard game={CELESTE} />
                    </WishlistContext.Provider>
                </ListsContext.Provider>
            </MemoryRouter>,
        );

        await userEvent.click(wishlistButton());

        const alert = await screen.findByRole('alert');
        expect(container.querySelector('.game-card-overlay')).not.toBeNull();
        expect(container.querySelector('.game-card-overlay')!.contains(alert)).toBe(false);
    });

    it('does not report a failure for a game the user never toggled', () => {
        renderCard({ mutationError: 'Failed to update your wishlist. Please try again.' });

        // The shared error belongs to whichever card was clicked last, which is why the card
        // reads its own result instead.
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
