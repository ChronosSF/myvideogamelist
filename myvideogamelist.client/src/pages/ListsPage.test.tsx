import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ListsPage } from '@/pages/ListsPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import { DEFAULT_SORT, MANUAL_SORT } from '@/lib/listSort';
import type { BulkResult } from '@/lib/listBulk';
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
    moveGames: vi.fn(async () => ({ outcome: 'saved' as const, gameIds: [], moved: [], missing: [] })),
    removeGames: vi.fn(async () => ({ outcome: 'saved' as const, gameIds: [], moved: [], missing: [] })),
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

/** The reader's favourites, as far as the rosette reads them. Hoisted and handed back whole, as above. */
const favoured = new Set<number>();
const favourites = {
    isFavourite: (gameId: number) => favoured.has(gameId),
} as unknown as FavouritesContextValue;

vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

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
    favoured.clear();
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
        expect(screen.getByText(/clear the filters to rearrange your order/i)).toBeInTheDocument();
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

describe('ListsPage favourites', () => {
    beforeEach(() => {
        authAnswered(userProfile());
        lists.lists = { ...emptyLists(), playing: [entry({ game: { id: 7, title: 'Tunic' } })] };
    });

    afterEach(() => {
        lists.view = 'tiles';
    });

    it('marks a favourite on its card', async () => {
        favoured.add(7);
        renderPage();
        await userEvent.click(screen.getByRole('tab', { name: /Playing/ }));

        expect(screen.getByRole('heading', { name: 'Tunic, one of your favourites' })).toBeInTheDocument();
    });

    it('marks a favourite in the table as well', async () => {
        lists.view = 'table';
        favoured.add(7);
        renderPage();
        await userEvent.click(screen.getByRole('tab', { name: /Playing/ }));

        const row = screen.getByRole('row', { name: /Tunic/ });
        expect(within(row).getByRole('img', { name: 'One of your favourites' })).toBeInTheDocument();
    });
});

describe('ListsPage bulk actions', () => {
    // Three playing games on two platforms, two of them with an ownership recorded, so both filters are
    // offered; held out of title order, so only the page's sort puts them in it.
    const SWITCH = platform(130, 'Switch');
    const PC = platform(6, 'PC');
    const PLAYING = [
        entry({ game: { id: 3, title: 'Hades', platforms: [PC] }, ownership: 'subscription', addedAt: '2026-03-01T00:00:00Z' }),
        entry({ game: { id: 1, title: 'Celeste', platforms: [SWITCH] }, ownership: 'owned', addedAt: '2026-01-01T00:00:00Z' }),
        entry({ game: { id: 2, title: 'Cuphead', platforms: [PC] }, addedAt: '2026-02-01T00:00:00Z' }),
    ];
    const saved = (gameIds: number[]): BulkResult => ({ outcome: 'saved', gameIds, moved: gameIds, missing: [] });

    beforeEach(() => {
        authAnswered(userProfile({ id: 'u1' }));
        lists.lists = { ...emptyLists(), playing: PLAYING, backlog: [entry({ game: { id: 9, title: 'Tunic' } })] };
        lists.view = 'table';
        lists.sortFor = () => ({ key: 'title', descending: false });
        lists.moveGames = vi.fn(async (gameIds: readonly number[]) => saved([...gameIds]));
        lists.removeGames = vi.fn(async (gameIds: readonly number[]) => saved([...gameIds]));
    });

    afterEach(() => {
        lists.view = 'tiles';
        lists.sortFor = () => DEFAULT_SORT;
        lists.isPending = () => false;
        vi.restoreAllMocks();
    });

    const tick = (title: string) => userEvent.click(screen.getByRole('checkbox', { name: `Select ${title}` }));
    const everyRow = () => screen.getByRole('checkbox', { name: 'Select every game shown' });
    const bar = () => screen.getByRole('region', { name: 'Selected games' });
    // Each move button carries "Move to" in its own name, for a screen reader that does not speak the group's.
    const moveTo = (name: string) => userEvent.click(
        within(screen.getByRole('group', { name: 'Move the selected games to' })).getByRole('button', { name: `Move to ${name}` }));
    const announced = (text: string) => {
        const said = screen.getByText(text);
        expect(said.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    };

    it('selects in the table, and draws neither the checkboxes nor the bar over the tiles', () => {
        lists.view = 'tiles';
        renderPage();

        expect(screen.queryByRole('checkbox', { name: /^Select / })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Selected games' })).not.toBeInTheDocument();
    });

    it('names how many are selected as they are ticked, and says so to a screen reader', async () => {
        renderPage();

        await tick('Celeste');
        await tick('Hades');

        expect(bar()).toHaveTextContent('2 games selected');
        announced('2 games selected.');
    });

    it('comes before the table, so the keyboard reaches it before any row', () => {
        renderPage();

        const firstRowBox = screen.getByRole('checkbox', { name: 'Select Celeste' });
        expect(bar().compareDocumentPosition(firstRowBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('selects every game a filter leaves showing, and no other', async () => {
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Switch' }));
        await userEvent.click(everyRow());
        await moveTo('Finished');

        expect(lists.moveGames).toHaveBeenCalledExactlyOnceWith([2, 3], 'finished');
    });

    it('moves the selected games through the provider, in the order they are drawn, to the list pressed', async () => {
        renderPage();

        await tick('Hades');
        await tick('Celeste');
        // Every list but the one they are in.
        expect(within(screen.getByRole('group', { name: 'Move the selected games to' })).getAllByRole('button')
            .map(button => button.textContent)).toEqual(['Move to Backlog', 'Move to On Hold', 'Move to Finished', 'Move to Dropped']);

        await moveTo('On Hold');

        expect(lists.moveGames).toHaveBeenCalledExactlyOnceWith([1, 3], 'on_hold');
    });

    it('offers the lists by the names their owner gave them', async () => {
        lists.nameFor = (id: ListId) => (id === 'finished' ? 'Beaten' : LIST_NAMES[id]);
        renderPage();

        await tick('Hades');
        await moveTo('Beaten');

        expect(lists.moveGames).toHaveBeenCalledExactlyOnceWith([3], 'finished');
        announced('Moved 1 game to Beaten.');
    });

    it('asks before taking games out, and takes them out through the provider once answered', async () => {
        renderPage();

        await tick('Cuphead');
        await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
        expect(lists.removeGames).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Remove 1 game' }));

        expect(lists.removeGames).toHaveBeenCalledExactlyOnceWith([2]);
        announced('Took 1 game out of Playing.');
    });

    it('lets go of exactly the games the provider says it acted on', async () => {
        // The provider left Celeste out — already where it was sent, say — so she stays selected.
        lists.moveGames = vi.fn(async () => saved([3]));
        renderPage();

        await tick('Hades');
        await tick('Celeste');
        await moveTo('Finished');

        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Select Celeste' })).toBeChecked();
    });

    it('keeps games a failure put back selected, so trying again is one press, and says why in the bar', async () => {
        // The page's banner is at the top, out of sight deep in a long list; the bar is in reach.
        const message = 'Failed to move 2 games to Finished. Please try again.';
        lists.moveGames = vi.fn(async (gameIds: readonly number[]) => ({ outcome: 'failed' as const, gameIds: [...gameIds], message }));
        renderPage();

        await tick('Hades');
        await tick('Celeste');
        await moveTo('Finished');

        expect(bar()).toHaveTextContent(message);
        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Select Celeste' })).toBeChecked();
        expect(screen.queryByText(/^Moved/)).not.toBeInTheDocument();

        // The next change of selection is a new start, and the bar counts again.
        await tick('Cuphead');
        expect(bar()).toHaveTextContent('3 games selected');
        expect(bar()).not.toHaveTextContent(message);
    });

    it('keeps the selection after a refusal too, which changed nothing, and says why', async () => {
        const message = 'Another change to one of these games is still saving. Try again in a moment.';
        lists.removeGames = vi.fn(async () => ({ outcome: 'refused' as const, message }));
        renderPage();

        await tick('Cuphead');
        await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
        await userEvent.click(screen.getByRole('button', { name: 'Remove 1 game' }));

        expect(screen.getByRole('checkbox', { name: 'Select Cuphead' })).toBeChecked();
        expect(bar()).toHaveTextContent(message);
    });

    it('says in the bar which games were not moved when the server had no entry for them', async () => {
        lists.moveGames = vi.fn(async () => ({ outcome: 'saved' as const, gameIds: [1, 3], moved: [1], missing: [3] }));
        renderPage();

        await tick('Hades');
        await tick('Celeste');
        await moveTo('Finished');

        expect(bar()).toHaveTextContent('1 of the 2 games was not moved: it is no longer in your lists.');
        announced('Moved 1 of the 2 games to Finished.');
    });

    it('says what it is doing while the request is out, and moves focus to the bar before the pressed button goes', async () => {
        let finish!: (result: BulkResult) => void;
        lists.moveGames = vi.fn(() => new Promise<BulkResult>(resolve => { finish = resolve; }));
        renderPage();

        await tick('Hades');
        await moveTo('Dropped');

        expect(bar()).toHaveTextContent('Moving 1 game to Dropped…');
        expect(bar()).toHaveFocus();

        await act(async () => finish(saved([3])));
        expect(bar()).toHaveFocus();
        announced('Moved 1 game to Dropped.');
    });

    it('sends focus to the list\'s tab when an action empties the list, taking the bar with it', async () => {
        // The provider has moved them all by the time it answers, so the table and its bar are gone.
        lists.moveGames = vi.fn(async (gameIds: readonly number[]) => {
            lists.lists = { ...lists.lists, playing: [] };
            return saved([...gameIds]);
        });
        renderPage();

        await userEvent.click(everyRow());
        await moveTo('Finished');

        await waitFor(() => expect(screen.getByRole('tab', { name: /Playing/ })).toHaveFocus());
        expect(screen.queryByRole('region', { name: 'Selected games' })).not.toBeInTheDocument();
    });

    it('moves focus to the list\'s tab at once when the action takes every row shown', async () => {
        // The table and the bar go with the rows, so the tab is where focus goes before the request, not
        // after it, where a second move could cut off what is announced.
        let finish!: (result: BulkResult) => void;
        lists.moveGames = vi.fn(() => new Promise<BulkResult>(resolve => { finish = resolve; }));
        renderPage();

        await userEvent.click(everyRow());
        await moveTo('Finished');

        expect(screen.getByRole('tab', { name: /Playing/ })).toHaveFocus();
        await act(async () => finish(saved([1, 2, 3])));
        expect(screen.getByRole('tab', { name: /Playing/ })).toHaveFocus();
    });

    it('keeps games a failed whole-list action brought back selected, with focus left where it went', async () => {
        // The provider shows the move at once, emptying the list, and puts the games back when it fails.
        let finish!: (result: BulkResult) => void;
        lists.moveGames = vi.fn((gameIds: readonly number[]) => {
            lists.lists = { ...lists.lists, playing: [] };
            return new Promise<BulkResult>(resolve => {
                finish = result => {
                    lists.lists = { ...lists.lists, playing: PLAYING };
                    resolve(result);
                };
                void gameIds;
            });
        });
        renderPage();

        await userEvent.click(everyRow());
        await moveTo('Finished');
        expect(screen.queryByRole('region', { name: 'Selected games' })).not.toBeInTheDocument();

        await act(async () => finish({ outcome: 'failed', gameIds: [1, 2, 3], message: 'Failed to move 3 games to Finished. Please try again.' }));

        expect(screen.getByRole('tab', { name: /Playing/ })).toHaveFocus();
        expect(screen.getAllByRole('checkbox', { name: /^Select (?!every)/ }).every(box => (box as HTMLInputElement).checked)).toBe(true);
        expect(bar()).toHaveTextContent('Failed to move 3 games to Finished');
    });

    it('keeps a game whose move is still out selected through a change of filter, for a failure to bring back', async () => {
        // Celeste's move has taken her off the list for the moment. A filter change lets go of what it
        // hides, and Celeste is hidden by nothing: she is merely out. Tunic keeps Switch on offer.
        lists.lists = { ...lists.lists, backlog: [entry({ game: { id: 9, title: 'Tunic', platforms: [SWITCH] } })] };
        let finish!: (result: BulkResult) => void;
        lists.moveGames = vi.fn(() => {
            lists.lists = { ...lists.lists, playing: PLAYING.filter(e => e.game.id !== 1) };
            return new Promise<BulkResult>(resolve => {
                finish = result => {
                    lists.lists = { ...lists.lists, playing: PLAYING };
                    resolve(result);
                };
            });
        });
        renderPage();

        await tick('Celeste');
        await moveTo('Finished');
        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Switch' }));
        await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

        await act(async () => finish({ outcome: 'failed', gameIds: [1], message: 'Failed to move 1 game to Finished. Please try again.' }));

        expect(screen.getByRole('checkbox', { name: 'Select Celeste' })).toBeChecked();
    });

    it('puts focus on the bar when Clear takes the selection\'s controls away', async () => {
        renderPage();

        await tick('Hades');
        await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

        expect(bar()).toHaveFocus();
        expect(bar()).toHaveTextContent(/tick games/i);
        announced('No games selected.');
    });

    it('selects only the rows a filter leaves showing, and the header\'s second press clears them', async () => {
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Switch' }));
        await userEvent.click(everyRow());
        await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

        // Celeste was hidden when the header was pressed, and is not ticked now she is back.
        expect(screen.getByRole('checkbox', { name: 'Select Celeste' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Select Cuphead' })).toBeChecked();

        await userEvent.click(everyRow());
        await userEvent.click(everyRow());
        expect(screen.getAllByRole('checkbox', { name: /^Select (?!every)/ }).some(box => (box as HTMLInputElement).checked)).toBe(false);
    });

    it('lets go of what a new ownership choice stops drawing, as a platform choice does', async () => {
        renderPage();

        await tick('Hades');
        await tick('Celeste');
        await userEvent.click(screen.getByRole('button', { name: 'Any ownership' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Owned' }));
        await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(screen.getByRole('checkbox', { name: 'Select Celeste' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).toBeChecked();
    });

    it('says nothing of the last list once another is opened, so the next count is heard even if the same', async () => {
        renderPage();

        await tick('Hades');
        announced('1 game selected.');
        await userEvent.click(screen.getByRole('tab', { name: /Backlog/ }));

        expect(screen.queryByText('1 game selected.')).not.toBeInTheDocument();
    });

    it('shows the next account neither what a previous account\'s action is doing nor what it did', async () => {
        let finish!: (result: BulkResult) => void;
        lists.moveGames = vi.fn(() => new Promise<BulkResult>(resolve => { finish = resolve; }));
        lists.nameFor = (id: ListId) => (id === 'finished' ? 'Beaten' : LIST_NAMES[id]);
        const view = renderPage();

        await tick('Hades');
        await moveTo('Beaten');
        expect(bar()).toHaveTextContent('Moving 1 game to Beaten…');

        authAnswered(userProfile({ id: 'u2' }));
        lists.nameFor = (id: ListId) => LIST_NAMES[id];
        view.rerender(<MemoryRouter><ListsPage /></MemoryRouter>);
        expect(bar()).toHaveTextContent(/tick games/i);

        await act(async () => finish(saved([3])));
        expect(screen.queryByText(/Beaten/)).not.toBeInTheDocument();
        expect(screen.queryByText(/^Moved/)).not.toBeInTheDocument();
    });

    it('lets the selection go with a change of tab, and does not bring it back', async () => {
        renderPage();

        await tick('Hades');
        await userEvent.click(screen.getByRole('tab', { name: /Backlog/ }));
        expect(bar()).toHaveTextContent(/tick games/i);

        await userEvent.click(screen.getByRole('tab', { name: /Playing/ }));
        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).not.toBeChecked();
    });

    it('lets go of what a new filter stops drawing, so a hidden game is never acted on', async () => {
        renderPage();

        await tick('Hades');
        await tick('Celeste');
        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Switch' }));
        await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

        // Celeste was hidden by the filter, and is not selected when the filter is reset.
        expect(screen.getByRole('checkbox', { name: 'Select Celeste' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).toBeChecked();
    });

    it('lets the selection go when the layout goes back to tiles', async () => {
        renderPage();

        await tick('Hades');
        await userEvent.click(screen.getByRole('button', { name: 'Tiles' }));
        expect(lists.setView).toHaveBeenCalledWith('tiles');

        // The provider is mocked and keeps the table on screen, which shows the selection gone with it.
        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).not.toBeChecked();
    });

    it('does not carry a selection over to the next account, even for a game they share', async () => {
        const view = renderPage();

        await tick('Hades');
        authAnswered(userProfile({ id: 'u2' }));
        view.rerender(<MemoryRouter><ListsPage /></MemoryRouter>);

        expect(screen.getByRole('checkbox', { name: 'Select Hades' })).not.toBeChecked();
        expect(bar()).toHaveTextContent(/tick games/i);
    });

    it('filters by ownership, offered once the lists hold two kinds, "not recorded" included', async () => {
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Any ownership' }));
        for (const choice of ['Owned', 'Subscription', 'Not recorded']) {
            expect(screen.getByRole('checkbox', { name: choice })).toBeChecked();
        }
        expect(screen.queryByRole('checkbox', { name: 'Borrowed' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('checkbox', { name: 'Not recorded' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Subscription' }));

        const titles = screen.getAllByRole('row').slice(1).map(row => within(row).getByRole('link', { name: /.+/ }).textContent);
        expect(titles).toEqual(['Celeste']);
        expect(screen.getByRole('button', { name: 'Owned' })).toBeInTheDocument();
    });

    it('stops filtering by a kind once its last game has left every list', async () => {
        // Hades was the only game on a subscription. Taken out of every list while the filter showed only
        // that kind, the choice would otherwise go on hiding every game behind a menu that no longer has it.
        const view = renderPage();
        await userEvent.click(screen.getByRole('button', { name: 'Any ownership' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Owned' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Not recorded' }));
        expect(screen.getAllByRole('row').slice(1).map(row => within(row).getByRole('link', { name: /.+/ }).textContent))
            .toEqual(['Hades']);

        lists.lists = { ...lists.lists, playing: PLAYING.filter(e => e.game.id !== 3) };
        view.rerender(<MemoryRouter><ListsPage /></MemoryRouter>);

        expect(screen.getAllByRole('row').slice(1).map(row => within(row).getByRole('link', { name: /.+/ }).textContent))
            .toEqual(['Celeste', 'Cuphead']);
        expect(screen.getByRole('button', { name: 'Any ownership' })).toBeInTheDocument();
    });

    it('filters by nothing it no longer offers, when fewer than two kinds are left', async () => {
        const view = renderPage();
        await userEvent.click(screen.getByRole('button', { name: 'Any ownership' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Not recorded' }));

        // Only games nobody has said anything about are left, so the filter is not drawn — and must not
        // go on hiding them with a choice of Owned and Subscription nobody can see.
        lists.lists = { ...emptyLists(), playing: [entry({ game: { id: 2, title: 'Cuphead' } })] };
        view.rerender(<MemoryRouter><ListsPage /></MemoryRouter>);

        expect(screen.queryByRole('button', { name: /ownership|owned|subscription/i })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Cuphead' })).toBeInTheDocument();
    });

    it('offers no ownership filter while every game is the same', () => {
        lists.lists = { ...emptyLists(), playing: [entry({ game: { id: 1, title: 'Celeste' } })] };
        renderPage();

        expect(screen.queryByRole('button', { name: 'Any ownership' })).not.toBeInTheDocument();
    });

    it('says which filter matched nothing, and clears it', async () => {
        // Borrowed is offered because the backlog holds a borrowed game, and matches nothing playing.
        lists.lists = {
            ...emptyLists(),
            playing: PLAYING.slice(0, 2),
            backlog: [entry({ game: { id: 9, title: 'Tunic' }, ownership: 'borrowed' })],
        };
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Any ownership' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Owned' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Subscription' }));

        expect(screen.getByText(/no games in playing match the ownership filter/i)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Clear the filter' }));
        expect(screen.getAllByRole('row')).toHaveLength(3);
    });
});

describe('ListsPage, the ownership filter and the hand order', () => {
    beforeEach(() => {
        authAnswered(userProfile());
        lists.lists = {
            ...emptyLists(),
            backlog: [
                entry({ game: { id: 1, title: 'Celeste' }, ownership: 'owned', position: 0 }),
                entry({ game: { id: 2, title: 'Hades' } }),
            ],
        };
        lists.sortFor = (id: ListId) => (id === 'backlog' ? MANUAL_SORT : DEFAULT_SORT);
        lists.view = 'table';
    });

    afterEach(() => {
        lists.sortFor = () => DEFAULT_SORT;
        lists.view = 'tiles';
    });

    it('shows the order but will not rearrange it while an ownership filter hides part of the list', async () => {
        // ADR 0054 §8, for either filter: a game dropped between two the filter left showing would land
        // among games the user cannot see.
        renderPage();
        await userEvent.click(screen.getByRole('tab', { name: /Backlog/ }));
        expect(screen.getAllByRole('button', { name: /^Move / })).toHaveLength(2);

        await userEvent.click(screen.getByRole('button', { name: 'Any ownership' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Not recorded' }));

        expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
        expect(screen.getByText(/clear the filters to rearrange your order/i)).toBeInTheDocument();
    });

    it('offers selection beside the hand order\'s handles', async () => {
        renderPage();
        await userEvent.click(screen.getByRole('tab', { name: /Backlog/ }));

        const rows = screen.getAllByRole('row').slice(1);
        expect(rows.map(row => [
            within(row).getByRole('checkbox').getAttribute('aria-label'),
            within(row).getByRole('button', { name: /^Move / }).getAttribute('aria-label'),
        ])).toEqual([['Select Celeste', 'Move Celeste'], ['Select Hades', 'Move Hades']]);
    });
});
