import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { GameCard } from '@/components/GameCard';
import { FavouritesContext, type FavouritesContextValue } from '@/contexts/FavouritesContext';
import { ListsContext, type ListsContextValue } from '@/contexts/ListsContext';
import { WishlistContext, type WishlistContextValue } from '@/contexts/WishlistContext';
import { GAME_GRID_COVER_SIZES } from '@/lib/gameGrid';
import { DEFAULT_SORT } from '@/lib/listSort';
import { game } from '@/test/factories';
import { LIST_NAMES, type ListId } from '@/types/list';

// Stable object: the card only reads `user`, and going through the real provider would mean
// mocking its fetches too.
vi.mock('@/hooks/useAuth', () => {
    const value = {
        user: { id: 'u1', email: 'alice@test.local' },
        loading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
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
        reload: vi.fn(),
        isPending: () => false,
        addToList: vi.fn(async () => {}),
        removeFromList: vi.fn(async () => {}),
        isInList: () => false,
        getListFor: () => null,
        scoreFor: () => null,
        setScore: vi.fn(async () => true),
        moveInOrder: vi.fn(async () => true),
        setOwnership: vi.fn(async () => true),
        setNotes: vi.fn(async () => true),
        setTags: vi.fn(async () => ({ ok: true as const })),
        deleteEntry: vi.fn(async () => true),
        view: 'tiles',
        setView: vi.fn(),
        sortFor: () => DEFAULT_SORT,
        setSort: vi.fn(),
        names: {},
        nameFor: (id: ListId) => LIST_NAMES[id],
        namesStatus: 'ready',
        saveListNames: vi.fn(async () => ({ ok: true as const })),
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

function favouritesValue(overrides: Partial<FavouritesContextValue> = {}): FavouritesContextValue {
    return {
        items: [],
        loading: false,
        error: null,
        mutationError: null,
        orderError: null,
        isFavourite: () => false,
        isPending: () => false,
        add: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        moveInOrder: vi.fn(async () => true),
        reload: vi.fn(),
        ...overrides,
    };
}

function renderCard(
    wishlistOverrides: Partial<WishlistContextValue> = {},
    listsOverrides: Partial<ListsContextValue> = {},
    favouritesOverrides: Partial<FavouritesContextValue> = {},
) {
    const wishlist = wishlistValue(wishlistOverrides);
    render(
        <MemoryRouter>
            <ListsContext.Provider value={listsValue(listsOverrides)}>
                <WishlistContext.Provider value={wishlist}>
                    <FavouritesContext.Provider value={favouritesValue(favouritesOverrides)}>
                        <GameCard game={CELESTE} />
                    </FavouritesContext.Provider>
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
    // Cards appear on Games and Lists, neither of which renders the wishlist provider's shared
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
                        <FavouritesContext.Provider value={favouritesValue()}>
                            <GameCard game={CELESTE} />
                        </FavouritesContext.Provider>
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

describe('GameCard list options toggle', () => {
    const toggle = () => screen.getByRole('button', { name: 'Open list options for Celeste' });

    it('shows no words and holds no other control', () => {
        // A control's name has to contain the words it shows (WCAG 2.5.3), and a control may not hold
        // another: the cover was once the toggle itself, around a score and the list buttons (issue 329).
        renderCard();

        expect(toggle()).toBeEmptyDOMElement();
        expect(toggle().contains(screen.getByRole('button', { name: 'Backlog' }))).toBe(false);
    });

    it('opens the overlay and closes it again', async () => {
        renderCard();

        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        await userEvent.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens from the keyboard', async () => {
        renderCard();

        toggle().focus();
        await userEvent.keyboard('{Enter}');
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        await userEvent.keyboard(' ');
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('leaves the overlay open when a list button inside it is pressed', async () => {
        renderCard();

        await userEvent.click(toggle());
        await userEvent.click(screen.getByRole('button', { name: 'Backlog' }));

        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('GameCard cover', () => {
    const COVERED = game({
        id: 2,
        title: 'Hades',
        coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co39vc.jpg',
    });

    function renderCovered(eager?: boolean) {
        render(
            <MemoryRouter>
                <ListsContext.Provider value={listsValue()}>
                    <WishlistContext.Provider value={wishlistValue()}>
                        <FavouritesContext.Provider value={favouritesValue()}>
                            <GameCard game={COVERED} eager={eager} />
                        </FavouritesContext.Provider>
                    </WishlistContext.Provider>
                </ListsContext.Provider>
            </MemoryRouter>,
        );
        return screen.getByRole('img', { name: 'Hades cover' });
    }

    it("offers the smaller sizes, chosen by the width the grid's columns draw it at", () => {
        const img = renderCovered();

        expect(img.getAttribute('srcset')).toContain('/t_cover_small_2x/co39vc.jpg 180w');
        expect(img).toHaveAttribute('sizes', `auto, ${GAME_GRID_COVER_SIZES}`);
    });

    it('waits until it is scrolled near, below the first row', () => {
        const img = renderCovered();

        expect(img).toHaveAttribute('loading', 'lazy');
        expect(img).toHaveAttribute('decoding', 'async');
    });

    it('loads with the page in the first row, where it may be the largest first paint', () => {
        const img = renderCovered(true);

        expect(img).not.toHaveAttribute('loading', 'lazy');
        expect(img).not.toHaveAttribute('decoding', 'async');
        // Chosen before layout, so by the grid's own arithmetic alone.
        expect(img).toHaveAttribute('sizes', GAME_GRID_COVER_SIZES);
    });
});

/**
 * The rosette drawn on a cover. By its class, the one exception to querying by role: the mark is
 * deliberately outside the accessibility tree, and what it says is asserted through the words instead.
 */
const coverMarks = () => document.querySelectorAll('.favourite-mark-cover');

describe('GameCard favourite mark', () => {
    it("marks one of the reader's favourites, and says so in its heading", () => {
        // The rosette on the cover is decoration. The heading is where the words go (ADR 0064).
        renderCard({}, {}, { isFavourite: id => id === CELESTE.id });

        expect(screen.getByRole('heading', { name: 'Celeste, one of your favourites' })).toBeInTheDocument();
        expect(coverMarks()).toHaveLength(1);
    });

    it('marks nothing on a game that is not a favourite', () => {
        renderCard({}, {}, { isFavourite: () => false });

        expect(screen.getByRole('heading', { name: 'Celeste' })).toBeInTheDocument();
        expect(coverMarks()).toHaveLength(0);
    });

    it('marks a favourite and offers no way to change it', () => {
        // A favourite is made or unmade on the game's page, and on a release card; a card in a grid
        // carries the five statuses and the wishlist, and a mark (ADR 0029 §4).
        renderCard({}, {}, { isFavourite: () => true });

        expect(screen.queryByRole('button', { name: /favourite/i })).not.toBeInTheDocument();
    });
});

describe('GameCard and renamed lists', () => {
    it('labels its list buttons with the names their owner gave them', () => {
        renderCard({}, { nameFor: (id: ListId) => (id === 'dropped' ? 'Nope' : LIST_NAMES[id]) });

        expect(screen.getByRole('button', { name: 'Nope' })).toHaveAttribute('title', 'Add to Nope');
        expect(screen.queryByRole('button', { name: 'Dropped' })).not.toBeInTheDocument();
    });
});

describe('GameCard release year', () => {
    it('reads a game out on 1 January as that year, wherever the reader is', () => {
        // The suite runs in Honolulu (vitest.config.ts), where `new Date('2025-01-01')` is still 2024
        // (issue 267).
        render(
            <MemoryRouter>
                <ListsContext.Provider value={listsValue()}>
                    <WishlistContext.Provider value={wishlistValue()}>
                        <FavouritesContext.Provider value={favouritesValue()}>
                            <GameCard game={game({ id: 3, title: 'Balatro', releaseDate: '2025-01-01' })} />
                        </FavouritesContext.Provider>
                    </WishlistContext.Provider>
                </ListsContext.Provider>
            </MemoryRouter>,
        );

        expect(screen.getByText('2025')).toBeInTheDocument();
        expect(screen.queryByText('2024')).not.toBeInTheDocument();
    });
});
