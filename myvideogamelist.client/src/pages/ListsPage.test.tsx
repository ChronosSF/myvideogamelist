import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ListsPage } from '@/pages/ListsPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { TagsContextValue } from '@/contexts/TagsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import { DEFAULT_SORT } from '@/lib/listSort';
import type { UserProfile } from '@/types/auth';
import { emptyLists, LIST_NAMES, type ListId } from '@/types/list';
import { entry, platform, tag, userProfile } from '@/test/factories';

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
    isInList: () => false,
    getListFor: () => null,
    scoreFor: () => null,
    setScore: vi.fn(async () => true),
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

/** The account's tags, which the chips and the tag filter resolve a row's ids through. */
const tags: TagsContextValue = {
    tags: [],
    status: 'ready',
    reload: vi.fn(),
    tagFor: () => undefined,
    byId: new Map(),
    createTag: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
    renameTag: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
    deleteTag: vi.fn(async () => true),
    adjustCounts: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));
vi.mock('@/hooks/useTags', () => ({ useTags: () => tags }));

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
    lists.view = 'tiles';
    lists.nameFor = (id: ListId) => LIST_NAMES[id];
    tags.tags = [];
    tags.byId = new Map();
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

describe('ListsPage and tags', () => {
    const COOP = tag({ id: 1, name: 'Co-op', count: 2 });
    const SHORT = tag({ id: 2, name: 'short', count: 2 });
    const UNUSED = tag({ id: 3, name: 'someday', count: 0 });

    const PC = platform(6, 'PC');
    const SWITCH = platform(130, 'Switch');

    const HADES = entry({ game: { id: 7, title: 'Hades', platforms: [SWITCH] }, tagIds: [1, 2] });
    const CELESTE = entry({ game: { id: 8, title: 'Celeste', platforms: [SWITCH] }, tagIds: [2] });
    const INSIDE = entry({ game: { id: 9, title: 'Inside', platforms: [SWITCH] } });
    const PORTAL = entry({ game: { id: 10, title: 'Portal 2', platforms: [PC] }, tagIds: [1] });

    function withTags(list: TagsContextValue['tags']) {
        tags.tags = list;
        tags.byId = new Map(list.map(t => [t.id, t]));
    }

    beforeEach(() => {
        authAnswered(userProfile());
        withTags([COOP, SHORT, UNUSED]);
        lists.view = 'tiles';
        lists.lists = { ...emptyLists(), playing: [HADES, CELESTE, INSIDE], finished: [PORTAL] };
    });

    const titles = () => screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);

    it('draws each game’s tags on its tile, in name order', () => {
        renderPage();

        const hades = screen.getByRole('heading', { name: 'Hades' }).closest('article')!;
        const list = within(hades).getByRole('list', { name: 'Your tags' });
        expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Co-op', 'short']);
    });

    it('draws them under the title in the table', () => {
        lists.view = 'table';
        renderPage();

        const row = screen.getByRole('link', { name: 'Hades' }).closest('tr')!;
        expect(within(row).getByRole('list', { name: 'Your tags' })).toHaveTextContent('Co-opshort');
    });

    it('offers the tags some game in the lists carries, and narrows to the games carrying every one ticked', async () => {
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Filter by tag' }));
        const group = screen.getByRole('group', { name: 'Filter by tag' });
        expect(within(group).getAllByRole('checkbox').map(box => box.getAttribute('aria-label')))
            .toEqual(['Co-op, 1 game in this list', 'short, 2 games in this list']);

        await userEvent.click(within(group).getByRole('checkbox', { name: /^short/ }));
        expect(titles()).toEqual(['Celeste', 'Hades']);

        await userEvent.click(within(group).getByRole('checkbox', { name: /^Co-op/ }));
        expect(titles()).toEqual(['Hades']);
    });

    it('says the filters left nothing in this list, and clears both at once', async () => {
        // Portal 2 carries the tag ticked, so it is the platform filter alone that hides it — and the
        // one press has to take off both, or it would stay hidden behind the one not cleared.
        renderPage();
        await userEvent.click(screen.getByRole('tab', { name: /Finished/ }));

        await userEvent.click(screen.getByRole('button', { name: 'Filter by tag' }));
        await userEvent.click(screen.getByRole('checkbox', { name: /^Co-op/ }));
        await userEvent.keyboard('{Escape}');
        expect(titles()).toEqual(['Portal 2']);

        await userEvent.click(screen.getByRole('button', { name: 'All platforms' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'PC' }));

        expect(screen.getByText('No games in Finished match the filters.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Clear the filters' }));

        expect(titles()).toEqual(['Portal 2']);
        expect(screen.getByRole('button', { name: 'Filter by tag' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'All platforms' })).toBeInTheDocument();
    });

    it('still says "the platform filter" when no tag is ticked', async () => {
        renderPage();
        await userEvent.click(screen.getByRole('tab', { name: /Finished/ }));

        await userEvent.click(screen.getByRole('button', { name: 'All platforms' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'PC' }));

        expect(screen.getByText('No games in Finished match the platform filter.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear the filter' })).toBeInTheDocument();
    });

    it('offers no tag filter when no game carries a tag', () => {
        lists.lists = { ...emptyLists(), playing: [INSIDE] };
        renderPage();

        expect(screen.queryByRole('button', { name: 'Filter by tag' })).not.toBeInTheDocument();
    });
});
