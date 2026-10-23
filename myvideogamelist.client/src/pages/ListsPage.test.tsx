import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ListsPage } from '@/pages/ListsPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import { DEFAULT_SORT, MANUAL_SORT } from '@/lib/listSort';
import type { UserProfile } from '@/types/auth';
import { emptyLists, LIST_NAMES, type ListId } from '@/types/list';
import { entry, platform, userProfile } from '@/test/factories';

/**
 * Auth and the lists, mocked rather than provided: both real providers fetch, and the page only
 * reads what they hold. The wishlist is here for the same reason and for one more: a populated
 * list renders `GameCard`, whose heart reads the wishlist, so its real hook would throw.
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
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

const lists: ListsContextValue = {
    lists: emptyLists(),
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
    deleteEntry: vi.fn(async () => true),
    view: 'tiles',
    setView: vi.fn(),
    sortFor: () => DEFAULT_SORT,
    setSort: vi.fn(),
    names: {},
    nameFor: (id: ListId) => LIST_NAMES[id],
    namesStatus: 'ready',
    saveListNames: vi.fn(async () => ({ ok: true as const })),
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
vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

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
    lists.lists = emptyLists();
    lists.loading = false;
    lists.error = null;
    lists.nameFor = (id: ListId) => LIST_NAMES[id];
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

describe('ListsPage when nothing is tracked yet', () => {
    const importLink = { name: /bring your games across/i };

    it('offers browsing and an import', () => {
        // The importer is otherwise linked from one card on the account page. Somebody whose games
        // are all still in another tracker is here, now, looking at nothing — see the comment on
        // the empty state and `specs/csv-list-import.md` §1.
        authAnswered(userProfile());
        renderPage();

        expect(screen.getByRole('link', { name: 'Browse Games' })).toHaveAttribute('href', '/games');
        expect(screen.getByRole('link', importLink)).toHaveAttribute('href', '/import');
    });

    it('offers neither once the list has games in it', () => {
        authAnswered(userProfile());
        lists.lists = { ...emptyLists(), playing: [entry({ game: { id: 7, title: 'Hollow Knight' } })] };
        renderPage();

        expect(screen.queryByRole('link', { name: 'Browse Games' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', importLink)).not.toBeInTheDocument();
    });

    it('drops only the import offer when the library has games but this tab does not', () => {
        // Four of the five tabs are empty for most accounts, so an offer tied to `entries` would
        // invite somebody who finished importing months ago to import again, more or less for ever.
        authAnswered(userProfile());
        lists.lists = { ...emptyLists(), finished: [entry({ game: { id: 7, title: 'Hollow Knight' } })] };
        renderPage();

        expect(screen.getByRole('link', { name: 'Browse Games' })).toBeInTheDocument();
        expect(screen.queryByRole('link', importLink)).not.toBeInTheDocument();
    });
});

describe('ListsPage and renamed lists', () => {
    it('names each tab as its owner renamed it', () => {
        authAnswered(userProfile());
        lists.nameFor = (id: ListId) => (id === 'finished' ? 'Beaten' : LIST_NAMES[id]);
        renderPage();

        expect(screen.getByRole('tab', { name: /Beaten/ })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /Finished/ })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Playing/ })).toBeInTheDocument();
    });
});

describe('ListsPage and the hand order', () => {
    // Three backlog games across two platforms, so the platform filter is offered: one placed, and two
    // that follow it in the order they joined. Held in the reverse of that order, so that only the
    // page sorting them puts them right.
    const SWITCH = platform(130, 'Switch');
    const PC = platform(6, 'PC');
    const BACKLOG = [
        entry({ game: { id: 3, title: 'Cuphead', platforms: [PC] }, statusChangedAt: '2026-03-01T00:00:00Z' }),
        entry({ game: { id: 2, title: 'Hades', platforms: [PC] }, statusChangedAt: '2026-02-01T00:00:00Z' }),
        entry({ game: { id: 1, title: 'Celeste', platforms: [SWITCH] }, position: 0 }),
    ];

    const grips = () => screen.getAllByRole('button', { name: /^Move / }).map(grip => grip.getAttribute('aria-label'));

    /** Covers or rows on a fifty-pixel pitch down the page, since jsdom lays nothing out. */
    function layOutDownThePage() {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (!this.hasAttribute('data-reorder-item')) return new DOMRect(0, 0, 800, 600);
            return new DOMRect(0, [...this.parentElement!.children].indexOf(this) * 50, 800, 40);
        });
    }

    /** A drag of one game's grip from one point to another, as a pointer makes it. */
    function drag(name: string, fromY: number, toY: number) {
        const grip = screen.getByRole('button', { name: `Move ${name}` });
        fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 10, clientY: fromY });
        fireEvent.pointerMove(grip, { button: 0, pointerId: 1, clientX: 10, clientY: fromY + 10 });
        fireEvent.pointerMove(grip, { button: 0, pointerId: 1, clientX: 10, clientY: toY });
        fireEvent.pointerUp(grip, { button: 0, pointerId: 1, clientX: 10, clientY: toY });
    }

    beforeEach(() => {
        authAnswered(userProfile());
        lists.lists = { ...emptyLists(), backlog: BACKLOG, playing: [entry({ game: { id: 9, title: 'Tunic' } })] };
        lists.sortFor = (id: ListId) => (id === 'backlog' ? MANUAL_SORT : DEFAULT_SORT);
        lists.view = 'tiles';
        lists.moveInOrder = vi.fn(async () => true);
    });

    afterEach(() => {
        lists.sortFor = () => DEFAULT_SORT;
        lists.view = 'tiles';
        lists.isPending = () => false;
        vi.restoreAllMocks();
    });

    const openBacklog = () => userEvent.click(screen.getByRole('tab', { name: /Backlog/ }));

    it('offers "My order" on the backlog and on no other list', async () => {
        renderPage();
        const options = () => [...(screen.getByLabelText('Sort') as HTMLSelectElement).options].map(o => o.textContent);

        expect(options()).not.toContain('My order');

        await openBacklog();
        expect(options()).toContain('My order');
    });

    it('draws the backlog in its hand order with a handle on every game, and says how to use them', async () => {
        renderPage();
        await openBacklog();

        expect(grips()).toEqual(['Move Celeste', 'Move Hades', 'Move Cuphead']);
        expect(screen.getByText(/drag a game by its handle/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Move Hades' })).toHaveAccessibleDescription(/press space or enter to pick it up/i);
    });

    it('draws the grid as a list while it is an order, so each game\'s place can be heard', async () => {
        renderPage();
        await openBacklog();

        const order = screen.getByRole('list');
        expect(within(order).getAllByRole('listitem').map(item => item.querySelector('h3')?.textContent))
            .toEqual(['Celeste', 'Hades', 'Cuphead']);
    });

    it('draws a game being moved where it would land, before it is put down', async () => {
        renderPage();
        await openBacklog();

        screen.getByRole('button', { name: 'Move Cuphead' }).focus();
        await userEvent.keyboard(' {ArrowLeft}');

        expect(grips()).toEqual(['Move Celeste', 'Move Cuphead', 'Move Hades']);
        expect(lists.moveInOrder).not.toHaveBeenCalled();
    });

    it('drags a cover to a new place in the grid through the provider', async () => {
        layOutDownThePage();
        renderPage();
        await openBacklog();

        drag('Celeste', 20, 120);

        expect(lists.moveInOrder).toHaveBeenCalledExactlyOnceWith('backlog', 1, 3);
    });

    it('drags a row to a new place in the table through the provider', async () => {
        lists.view = 'table';
        layOutDownThePage();
        renderPage();
        await openBacklog();

        drag('Cuphead', 120, 20);

        expect(lists.moveInOrder).toHaveBeenCalledExactlyOnceWith('backlog', 3, null);
    });

    it('leaves the grip of a game whose save is out unable to move it', async () => {
        lists.isPending = id => id === 2;
        renderPage();
        await openBacklog();

        expect(screen.getByRole('button', { name: 'Move Hades' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Move Celeste' })).not.toHaveAttribute('aria-disabled');
    });

    it('moves a game from the keyboard through the provider, after the game it now follows', async () => {
        renderPage();
        await openBacklog();

        screen.getByRole('button', { name: 'Move Cuphead' }).focus();
        await userEvent.keyboard(' {ArrowLeft} ');

        expect(lists.moveInOrder).toHaveBeenCalledExactlyOnceWith('backlog', 3, 1);
    });

    it('has no handles in any other order', async () => {
        lists.sortFor = () => DEFAULT_SORT;
        renderPage();
        await openBacklog();

        expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
    });

    it('shows the order but will not rearrange it while a filter hides part of the list', async () => {
        // A game dropped between two that the filter left showing would land among games the user
        // cannot see.
        renderPage();
        await openBacklog();

        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Switch' }));

        expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
        expect(screen.getByText(/clear the platform filter to rearrange your order/i)).toBeInTheDocument();
    });

    it('puts the handles in a column of their own in the table', async () => {
        lists.view = 'table';
        renderPage();
        await openBacklog();

        // The column says it is the sort, and each row's place is text in it, as a column's value is.
        expect(screen.getByRole('columnheader', { name: 'Order' })).toHaveAttribute('aria-sort', 'ascending');
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows.map(row => within(row).getByRole('button', { name: /^Move / }).getAttribute('aria-label')))
            .toEqual(['Move Celeste', 'Move Hades', 'Move Cuphead']);
        expect(rows.map(row => row.querySelector('.col-order')?.textContent)).toEqual(['1', '2', '3']);
    });
});
