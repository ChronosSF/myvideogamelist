import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ReleaseLine } from '@/components/ReleaseLine';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import type { UseReleaseLineResult } from '@/hooks/useReleaseLine';
import { calendarEvents, connectedRelease, platform, releaseEntry, userProfile } from '@/test/factories';
import { LIST_NAMES, type ListId } from '@/types/list';

/**
 * The hook mocked rather than its endpoints: what is tested here is what the line draws from what it
 * holds, and the reads are `useReleaseLine`'s own tests. One module-level object, handed back on every
 * call — a fresh literal per render re-runs any effect that depends on it.
 */
const line: UseReleaseLineResult = {
    today: '2026-10-06',
    releases: { data: [], loading: false, error: null },
    events: { data: calendarEvents(), loading: false, error: null },
};

vi.mock('@/hooks/useReleaseLine', () => ({ useReleaseLine: () => line }));

/**
 * The lists, as far as the Backlog button reads them: which list each game is in, whether they have
 * loaded, and the add. Hoisted and handed back whole for the reason the line's value is.
 */
const listed = new Map<number, ListId>();
const lists = {
    loading: false,
    error: null as string | null,
    getListFor: (gameId: number) => listed.get(gameId) ?? null,
    isPending: () => false,
    nameFor: (id: ListId) => LIST_NAMES[id],
    addToList: vi.fn(async () => {}),
} as unknown as ListsContextValue;

vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));

/** The favourites, as far as the mark reads them. Hoisted and handed back whole, as above. */
const favoured = new Set<number>();
const favourites = {
    isFavourite: (gameId: number) => favoured.has(gameId),
} as unknown as FavouritesContextValue;

vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

/** Somebody signed in, which is when a card offers anything at all. Handed back whole, as above. */
const auth = { user: userProfile({ id: 'user-1' }), loading: false } as unknown as AuthContextValue;

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

/** The wishlist, as far as the heart reads it. Hoisted and handed back whole, as above. */
const wishlisted = new Set<number>();
const wishlist = {
    isWishlisted: (gameId: number) => wishlisted.has(gameId),
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
} as unknown as WishlistContextValue;

vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

const SWITCH_2 = platform(508, 'Nintendo Switch 2', 'Switch 2');

const RESIDENT_EVIL_2 = releaseEntry('2026-10-16', [connectedRelease({
    gameId: 19686,
    title: 'Resident Evil 2',
    platforms: [SWITCH_2],
    reason: { gameId: 19686, title: 'Resident Evil 2', membership: 'wishlist' },
})]);

const KINGDOM_HEARTS = releaseEntry('2026-10-08', [
    connectedRelease({
        gameId: 19560, title: 'Kingdom Hearts III', platforms: [SWITCH_2],
        reason: { relation: 'itself', gameId: 19560, title: 'Kingdom Hearts III', membership: 'list', list: 'finished' },
    }),
    connectedRelease({
        gameId: 2350, title: 'Kingdom Hearts HD 1.5 + 2.5 ReMIX', platforms: [SWITCH_2],
        reason: { relation: 'series', gameId: 19560, title: 'Kingdom Hearts III', membership: 'list', list: 'finished', series: 'Kingdom Hearts' },
    }),
], 'Kingdom Hearts');

function renderLine() {
    return render(
        <MemoryRouter>
            <ReleaseLine userId="user-1" />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    line.releases = { data: [], loading: false, error: null };
    line.events = { data: calendarEvents(), loading: false, error: null };

    listed.clear();
    Object.assign(lists, {
        loading: false,
        error: null,
        nameFor: (id: ListId) => LIST_NAMES[id],
        addToList: vi.fn(async () => {}),
    });

    favoured.clear();
    wishlisted.clear();
    Object.assign(wishlist, { add: vi.fn(async () => true), remove: vi.fn(async () => true) });
    Object.assign(auth, { user: userProfile({ id: 'user-1' }) });
});

describe('ReleaseLine', () => {
    it('draws the two weeks as a ruler of fourteen days, today first, hidden from whoever has the list', () => {
        renderLine();

        expect(screen.getByRole('heading', { name: 'Coming up' })).toBeInTheDocument();
        const ruler = document.querySelector('.release-ruler')!;
        expect(ruler).toHaveAttribute('aria-hidden', 'true');

        const labels = ruler.querySelectorAll('.release-ruler-label');
        expect(labels).toHaveLength(14);
        expect(labels[0]).toHaveTextContent('Today6Oct');
        expect(labels[13]).toHaveTextContent('Mon19');
    });

    it('lists a release under its day, with a link to it and why it is there, and no empty day', () => {
        line.releases.data = [RESIDENT_EVIL_2];
        renderLine();

        // The day, and in its own list, named by the whole date, its one release.
        const [day, ...rest] = within(screen.getByRole('list', { name: 'The next two weeks' })).getAllByRole('listitem');
        expect(day).toHaveTextContent('Fri, Oct 16');
        expect(day).toHaveTextContent('In 10 days');
        const due = within(day).getByRole('list', { name: 'Due on Friday, October 16' });
        expect(rest).toEqual(within(due).getAllByRole('listitem'));
        expect(within(due).getByRole('link', { name: 'Resident Evil 2' })).toHaveAttribute('href', '/games/19686');
        expect(due).toHaveTextContent('On your wishlist — out on Switch 2');
    });

    it('marks a release on the ruler, on its day', () => {
        line.releases.data = [RESIDENT_EVIL_2];
        renderLine();

        const mark = document.querySelector('.release-ruler-mark') as HTMLElement;
        expect(mark.style.gridColumn).toContain('11');
    });

    it('lists an update under its day, as an update for the game it updates', () => {
        // Gran Turismo 7's Spec IV, which IGDB types an update: there because the reader plays the game.
        line.releases.data = [releaseEntry('2026-10-15', [connectedRelease({
            gameId: 416116,
            title: 'Gran Turismo 7: Spec IV',
            kind: 'update',
            platforms: [platform(48, 'PlayStation 4', 'PS4'), platform(167, 'PlayStation 5', 'PS5'), platform(390, 'PlayStation VR2', 'PSVR2')],
            reason: { relation: 'child', gameId: 101006, title: 'Gran Turismo 7', membership: 'list', list: 'playing' },
        })])];
        renderLine();

        const [thursday] = within(screen.getByRole('list', { name: 'The next two weeks' })).getAllByRole('listitem');
        expect(thursday).toHaveTextContent('Thu, Oct 15');
        expect(within(thursday).getByRole('link', { name: 'Gran Turismo 7: Spec IV' })).toHaveAttribute('href', '/games/416116');
        expect(within(thursday).getByText("Update for Gran Turismo 7, which you're playing")).toBeInTheDocument();
        expect(within(thursday).getByText('PS4, PS5, PSVR2')).toBeInTheDocument();
    });

    it('shows a group as one, named after what its releases share, with all of them a click away (L5)', async () => {
        line.releases.data = [KINGDOM_HEARTS];
        renderLine();

        const [thursday] = within(screen.getByRole('list', { name: 'The next two weeks' })).getAllByRole('listitem');
        expect(thursday).toHaveTextContent('Thu, Oct 8');
        expect(thursday).toHaveTextContent('Kingdom Hearts');
        expect(thursday).toHaveTextContent('2 releases');
        expect(thursday).toHaveTextContent('Includes Kingdom Hearts III, which you finished');

        await userEvent.click(within(thursday).getByText('Show all 2'));

        expect(within(thursday).getByRole('link', { name: 'Kingdom Hearts HD 1.5 + 2.5 ReMIX' }))
            .toHaveAttribute('href', '/games/2350');
    });

    it('says so when nothing is due, rather than disappearing (L7)', () => {
        renderLine();

        expect(screen.getByText('Nothing connected to your games is due in the next two weeks.')).toBeInTheDocument();
    });

    it('links to the whole calendar, empty or not (L6)', () => {
        renderLine();

        expect(screen.getByRole('link', { name: 'The whole calendar' })).toHaveAttribute('href', '/calendar');
    });

    it('says it is still looking while the releases load', () => {
        line.releases = { data: null, loading: true, error: null };
        renderLine();

        expect(screen.getByText('Looking up what is coming for your games…')).toBeInTheDocument();
        expect(screen.queryByText(/Nothing connected/)).not.toBeInTheDocument();
    });

    it('lists a sale that is on as on now, marked as what it is and linked to its announcement (L3)', () => {
        line.events.data = calendarEvents({
            curated: [{
                id: 1, kind: 'sale', store: 'steam', name: 'Steam Autumn Sale',
                startsOn: '2026-10-01', endsOn: '2026-10-15', url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
            }],
        });
        renderLine();

        const [sale] = within(screen.getByRole('list', { name: 'The next two weeks' })).getAllByRole('listitem');
        expect(sale).toHaveTextContent('On now');
        expect(sale).toHaveTextContent('until Thu, Oct 15');
        expect(sale).toHaveTextContent('Sale · Steam');
        expect(sale).toHaveTextContent('Oct 1 – 15, 2026');

        const link = within(sale).getByRole('link', { name: 'Steam Autumn Sale (opens in a new tab)' });
        expect(link).toHaveAttribute('href', 'https://partner.steamgames.com/doc/marketing/upcoming_events');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');

        // And across its days on the ruler, from the line's first, since it began before the line does.
        const bar = document.querySelector('.release-ruler-bar') as HTMLElement;
        expect(bar.style.gridColumn).toBe('1 / 11');
    });

    it('lists a showcase on its day at its time, unlinked when IGDB has no stream', () => {
        line.events.data = calendarEvents({
            showcases: [{
                id: 1050, name: 'Summer Game Fest 2026',
                startsAt: new Date(2026, 9, 9, 21).toISOString(), endsAt: null, url: null,
            }],
        });
        renderLine();

        const [showcase] = within(screen.getByRole('list', { name: 'The next two weeks' })).getAllByRole('listitem');
        expect(showcase).toHaveTextContent('Fri, Oct 9');
        expect(showcase).toHaveTextContent('Showcase');
        expect(showcase).toHaveTextContent('Summer Game Fest 2026');
        expect(showcase).toHaveTextContent('Friday, October 9');
        expect(within(showcase).queryByRole('link')).not.toBeInTheDocument();
    });

    it('lists a day’s events before its releases', () => {
        line.releases.data = [RESIDENT_EVIL_2];
        line.events.data = calendarEvents({
            curated: [{ id: 2, kind: 'fest', store: null, name: 'Autumn Game Fest', startsOn: '2026-10-16', endsOn: '2026-10-18', url: 'https://example.com/autumn-game-fest' }],
        });
        renderLine();

        const items = within(screen.getByRole('list', { name: 'The next two weeks' })).getAllByRole('listitem');
        expect(items[0]).toHaveTextContent('Autumn Game Fest');
        expect(items[1]).toHaveTextContent('Resident Evil 2');
    });

    it('keeps the sales when the releases could not be loaded, and says what is missing', () => {
        line.releases = { data: null, loading: false, error: 'What is coming for your games could not be loaded (502).' };
        line.events.data = calendarEvents({
            curated: [{
                id: 1, kind: 'fest', store: 'steam', name: 'Steam Next Fest',
                startsOn: '2026-10-19', endsOn: '2026-10-26', url: 'https://partner.steamgames.com/',
            }],
        });
        renderLine();

        expect(screen.getByText('What is coming for your games could not be loaded just now.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Steam Next Fest (opens in a new tab)' })).toBeInTheDocument();
        expect(screen.queryByText(/Nothing connected/)).not.toBeInTheDocument();
    });

    it('says the showcases are missing when IGDB was, rather than letting them read as none', () => {
        line.events.data = calendarEvents({ degraded: true });
        renderLine();

        expect(screen.getByText('The showcases could not be loaded just now.')).toBeInTheDocument();
    });

    it('says the showcases and sales are missing when the events could not be read at all', () => {
        line.events = { data: null, loading: false, error: 'Failed to fetch' };
        renderLine();

        expect(screen.getByText('The showcases and sales could not be loaded just now.')).toBeInTheDocument();
    });
});

describe('ReleaseLine, adding a release to the Backlog', () => {
    const SEPARATE_WAYS = releaseEntry('2026-10-16', [connectedRelease({
        gameId: 245411,
        title: 'Resident Evil 4: Separate Ways',
        kind: 'dlc',
        coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/sw.jpg',
        platforms: [SWITCH_2],
        reason: { relation: 'child', gameId: 132181, title: 'Resident Evil 4', membership: 'list', list: 'finished' },
    })]);

    it('offers it for a release in no list, and adds what the line knows of it', async () => {
        line.releases.data = [SEPARATE_WAYS];
        lists.addToList = vi.fn(async (_list: ListId, game: { id: number }) => {
            listed.set(game.id, 'backlog');
        });
        renderLine();

        await userEvent.click(screen.getByRole('button', { name: 'Add to Backlog: Resident Evil 4: Separate Ways' }));

        expect(lists.addToList).toHaveBeenCalledWith('backlog', expect.objectContaining({
            id: 245411,
            title: 'Resident Evil 4: Separate Ways',
            coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/sw.jpg',
            platforms: [SWITCH_2],
            releaseDate: null,
        }));
        expect(screen.getByText('In Backlog')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Add to Backlog/ })).not.toBeInTheDocument();
    });

    it('offers nothing until the lists have loaded, when every game looks as though it were in none', () => {
        // A click then would move a finished game to the Backlog.
        line.releases.data = [SEPARATE_WAYS];
        lists.loading = true;
        renderLine();

        expect(screen.queryByRole('button', { name: /Add to Backlog/ })).not.toBeInTheDocument();
    });

    it('offers nothing for a game already in a list, since adding it would move it', () => {
        line.releases.data = [SEPARATE_WAYS, RESIDENT_EVIL_2];
        listed.set(245411, 'dropped');
        listed.set(19686, 'finished');
        renderLine();

        expect(screen.queryByRole('button', { name: /Add to Backlog/ })).not.toBeInTheDocument();
        // Said of a connected release; of the game itself, its reason already says where it is.
        expect(screen.getByText('In Dropped')).toBeInTheDocument();
        expect(screen.queryByText('In Finished')).not.toBeInTheDocument();
    });

    it('calls the Backlog what the user calls it', () => {
        line.releases.data = [SEPARATE_WAYS];
        lists.nameFor = (id: ListId) => (id === 'backlog' ? 'Up Next' : LIST_NAMES[id]);
        renderLine();

        expect(screen.getByRole('button', { name: 'Add to Up Next: Resident Evil 4: Separate Ways' }))
            .toHaveAttribute('title', 'Add to Up Next');
    });

    it('says so where the message stays put when the add did not stick', async () => {
        // The provider rolled it back: asked, no longer pending, and still in no list.
        line.releases.data = [SEPARATE_WAYS];
        renderLine();

        await userEvent.click(screen.getByRole('button', { name: /Add to Backlog/ }));

        expect(screen.getByRole('alert')).toHaveTextContent('Could not add it to Backlog.');
    });

    it('offers it beside each release in a group, for that release alone', async () => {
        line.releases.data = [KINGDOM_HEARTS];
        listed.set(19560, 'finished');
        renderLine();

        await userEvent.click(screen.getByText('Show all 2'));
        await userEvent.click(screen.getByRole('button', { name: 'Add to Backlog: Kingdom Hearts HD 1.5 + 2.5 ReMIX' }));

        expect(lists.addToList).toHaveBeenCalledWith('backlog', expect.objectContaining({ id: 2350 }));
        expect(screen.queryByRole('button', { name: 'Add to Backlog: Kingdom Hearts III' })).not.toBeInTheDocument();
    });
});

describe('ReleaseLine, the wishlist', () => {
    it('puts a release on the wishlist from the line, whatever list it is in', async () => {
        line.releases.data = [RESIDENT_EVIL_2];
        listed.set(19686, 'finished');
        renderLine();

        const toggle = screen.getByRole('button', { name: 'Wishlist Resident Evil 2' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await userEvent.click(toggle);

        expect(wishlist.add).toHaveBeenCalledWith(expect.objectContaining({ id: 19686, title: 'Resident Evil 2' }));
    });

    it('shows a wishlisted release as one, and takes it back off', async () => {
        line.releases.data = [RESIDENT_EVIL_2];
        wishlisted.add(19686);
        renderLine();

        const toggle = screen.getByRole('button', { name: 'Wishlist Resident Evil 2' });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(toggle);

        expect(wishlist.remove).toHaveBeenCalledWith(19686);
    });

    it('says so in the card when the change did not stick', async () => {
        line.releases.data = [RESIDENT_EVIL_2];
        Object.assign(wishlist, { add: vi.fn(async () => false) });
        renderLine();

        await userEvent.click(screen.getByRole('button', { name: 'Wishlist Resident Evil 2' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not update your wishlist.');
    });

    it('offers it and the Backlog beside each release in a group', async () => {
        line.releases.data = [KINGDOM_HEARTS];
        listed.set(19560, 'finished');
        renderLine();

        await userEvent.click(screen.getByText('Show all 2'));
        expect(screen.getByRole('button', { name: 'Add to Backlog: Kingdom Hearts HD 1.5 + 2.5 ReMIX' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Wishlist Kingdom Hearts HD 1.5 + 2.5 ReMIX' }));

        expect(wishlist.add).toHaveBeenCalledWith(expect.objectContaining({ id: 2350 }));
    });
});

describe('ReleaseLine, favourites', () => {
    it('marks a favourite after its name, and offers no way to change it there', () => {
        // A favourite is made on the game's page (ADR 0029 §4); a view of what is coming shows it.
        line.releases.data = [RESIDENT_EVIL_2];
        favoured.add(19686);
        renderLine();

        expect(screen.getByRole('img', { name: 'One of your favourites' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /favourite/i })).not.toBeInTheDocument();
    });
});
