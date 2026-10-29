import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ReleaseCalendar } from '@/components/ReleaseCalendar';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import type { UseReleaseCalendarResult } from '@/hooks/useReleaseCalendar';
import { calendarEvents, connectedRelease, platform, releaseEntry, userProfile } from '@/test/factories';
import { LIST_NAMES, type ListId } from '@/types/list';
import type { ReleaseEntry, UndatedEntry } from '@/types/releases';

/**
 * The hook mocked rather than its endpoints: what is tested here is what the calendar draws from what
 * it holds, and the reads are `useReleaseCalendar`'s own tests. One module-level object, handed back
 * on every call — a fresh literal per render re-runs any effect that depends on it.
 */
const calendar: UseReleaseCalendarResult = {
    today: '2026-10-08',
    releases: { data: [], loading: false, error: null, reload: vi.fn() },
    events: { data: calendarEvents(), loading: false, error: null, reload: vi.fn() },
    undated: { data: [], loading: false, error: null, reload: vi.fn() },
};

vi.mock('@/hooks/useReleaseCalendar', () => ({ useReleaseCalendar: () => calendar }));

/** The lists, as far as Add to Backlog reads them. Hoisted and handed back whole, as above. */
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

const PS5 = platform(167, 'PlayStation 5', 'PS5');

const LAUFEY = releaseEntry('2026-10-16', [connectedRelease({
    gameId: 389000,
    title: 'God of War Laufey',
    platforms: [PS5],
    reason: { relation: 'series', gameId: 19560, title: 'God of War', membership: 'list', list: 'finished', series: 'God of War' },
})]);

const SONGS_OF_THE_PAST: ReleaseEntry = {
    ...releaseEntry('2026-10-01', [connectedRelease({
        gameId: 410000,
        title: 'The Witcher 3: Wild Hunt - Songs of the Past',
        kind: 'expansion',
        reason: { relation: 'child', gameId: 1942, title: 'The Witcher 3: Wild Hunt', membership: 'list', list: 'finished' },
    })]),
    precision: 'quarter',
};

const ELDER_SCROLLS_VI: UndatedEntry = {
    groupName: null,
    releases: [connectedRelease({
        gameId: 81249,
        title: 'The Elder Scrolls VI',
        platforms: [platform(6, 'PC (Microsoft Windows)', 'PC')],
        reason: { relation: 'itself', gameId: 81249, title: 'The Elder Scrolls VI', membership: 'wishlist' },
    })],
};

const AUTUMN_SALE = calendarEvents({
    curated: [{
        id: 1, kind: 'sale', store: 'steam', name: 'Steam Autumn Sale',
        startsOn: '2026-10-01', endsOn: '2026-10-15', url: 'https://partner.steamgames.com/',
    }],
});

function renderCalendar(address = '/calendar') {
    return render(
        <MemoryRouter initialEntries={[address]}>
            <ReleaseCalendar userId="user-1" />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    calendar.releases = { data: [], loading: false, error: null, reload: vi.fn() };
    calendar.events = { data: calendarEvents(), loading: false, error: null, reload: vi.fn() };
    calendar.undated = { data: [], loading: false, error: null, reload: vi.fn() };

    listed.clear();
    Object.assign(lists, { loading: false, error: null, addToList: vi.fn(async () => {}) });

    favoured.clear();
    wishlisted.clear();
    Object.assign(wishlist, { add: vi.fn(async () => true), remove: vi.fn(async () => true) });
    Object.assign(auth, { user: userProfile({ id: 'user-1' }) });
});

describe('ReleaseCalendar, the months', () => {
    it("opens on the reader's month, with the year ahead one link each", () => {
        calendar.releases.data = [LAUFEY];
        renderCalendar();

        expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toBeInTheDocument();

        const months = within(screen.getByRole('navigation', { name: 'Months' })).getAllByRole('link');
        expect(months).toHaveLength(13);
        expect(months[0]).toHaveAttribute('href', '/calendar');
        expect(months[0]).toHaveAttribute('aria-current', 'page');
        expect(months[0]).toHaveAccessibleName('Oct 2026, 1 entry');
        expect(months[1]).toHaveAttribute('href', '/calendar?month=2026-11');
        expect(months[1]).toHaveAccessibleName('Nov, nothing on its days');
        expect(months[12]).toHaveAccessibleName('Oct 2027, nothing on its days');
    });

    it('opens the month in the address, and the first for one the calendar does not reach', () => {
        const { unmount } = renderCalendar('/calendar?month=2027-02');
        expect(screen.getByRole('heading', { level: 2, name: 'February 2027' })).toBeInTheDocument();
        unmount();

        renderCalendar('/calendar?month=2030-01');
        expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toBeInTheDocument();
    });

    it('steps a month either way, and not before the first', () => {
        renderCalendar('/calendar?month=2026-11');

        expect(screen.getByRole('link', { name: 'Previous month, October 2026' })).toHaveAttribute('href', '/calendar');
        expect(screen.getByRole('link', { name: 'Next month, December 2026' })).toHaveAttribute('href', '/calendar?month=2026-12');
    });

    it('offers no month before the one it opens on', () => {
        renderCalendar();

        expect(screen.queryByRole('link', { name: /^Previous month/ })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Next month, November 2026' })).toBeInTheDocument();
    });
});

describe('ReleaseCalendar, a month', () => {
    it('puts a release on its day, saying why it is there', () => {
        calendar.releases.data = [LAUFEY];
        renderCalendar();

        const month = within(screen.getByRole('list', { name: 'What is on in October' }));
        const due = month.getByRole('list', { name: 'Due on Friday, October 16' });
        expect(within(due).getByRole('link', { name: 'God of War Laufey' })).toHaveAttribute('href', '/games/389000');
        expect(within(due).getByText('From the God of War series — you finished God of War')).toBeInTheDocument();
        expect(within(due).getByText('PS5')).toBeInTheDocument();
    });

    it("puts what is known only to its quarter in the quarter's band, on no day", () => {
        calendar.releases.data = [SONGS_OF_THE_PAST];
        renderCalendar();

        const band = screen.getByRole('region', { name: 'Sometime in Q4 2026 · October to December' });
        expect(within(band).getByRole('link', { name: 'The Witcher 3: Wild Hunt - Songs of the Past' })).toBeInTheDocument();
        expect(within(band).getByText('Expansion for The Witcher 3: Wild Hunt, which you finished')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'What is on in October' })).not.toBeInTheDocument();
    });

    it("fetches a day's cover and a band's at a row's width", () => {
        // Both are `ReleaseCard` rows, whose cover is the row's fixed column whatever the list's width.
        const covered = (entry: ReleaseEntry): ReleaseEntry => ({
            ...entry,
            releases: entry.releases.map(release => ({
                ...release,
                coverImageUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/co${release.gameId}.jpg`,
            })),
        });
        calendar.releases.data = [covered(LAUFEY), covered(SONGS_OF_THE_PAST)];
        renderCalendar();

        const dayCover = screen.getByRole('list', { name: 'Due on Friday, October 16' }).querySelector('img');
        const bandCover = screen.getByRole('region', { name: 'Sometime in Q4 2026 · October to December' }).querySelector('img');
        expect(dayCover?.getAttribute('sizes')).toContain('calc(3.5rem - 2px)');
        expect(bandCover?.getAttribute('sizes')).toContain('calc(3.5rem - 2px)');
        expect(dayCover).toHaveAttribute('srcset');
        expect(bandCover).toHaveAttribute('srcset');
    });

    it("puts an update known only to its year in the year's band, as an update for the game it updates", () => {
        // Silksong's Sea of Sorrow, which IGDB types an update and knows only to be due in 2026.
        calendar.releases.data = [{
            ...releaseEntry('2026-01-01', [connectedRelease({
                gameId: 381684,
                title: 'Hollow Knight: Silksong - Sea of Sorrow',
                kind: 'update',
                platforms: [platform(508, 'Nintendo Switch 2', 'Switch 2'), platform(6, 'PC (Microsoft Windows)', 'PC'), PS5],
                reason: { relation: 'child', gameId: 115289, title: 'Hollow Knight: Silksong', membership: 'list', list: 'backlog' },
            })]),
            precision: 'year',
        }];
        renderCalendar();

        const band = screen.getByRole('region', { name: 'Sometime in 2026' });
        expect(within(band).getByRole('link', { name: 'Hollow Knight: Silksong - Sea of Sorrow' })).toHaveAttribute('href', '/games/381684');
        expect(within(band).getByText('Update for Hollow Knight: Silksong, which you plan to play')).toBeInTheDocument();
        expect(within(band).getByText('Switch 2, PC, PS5')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'What is on in October' })).not.toBeInTheDocument();
    });

    it('reads out a sale once, with its dates, however many weeks it crosses', () => {
        calendar.events.data = AUTUMN_SALE;
        renderCalendar();

        const sales = within(screen.getByRole('list', { name: 'What is on in October' })).getAllByRole('listitem');
        expect(sales).toHaveLength(1);
        expect(sales[0]).toHaveTextContent('Steam Autumn Sale');
        expect(sales[0]).toHaveTextContent('Oct 1 – 15, 2026');
        expect(within(sales[0]).getByRole('link', { name: 'Steam Autumn Sale (opens in a new tab)' }))
            .toHaveAttribute('href', 'https://partner.steamgames.com/');
    });

    it('says so when a month has nothing on it', () => {
        calendar.releases.data = [LAUFEY];
        renderCalendar('/calendar?month=2027-03');

        expect(screen.getByText('Nothing connected to your games is due in March 2027.')).toBeInTheDocument();
    });

    it('says the releases are missing, keeps the sales, and asks again when told to', async () => {
        calendar.releases = { data: null, loading: false, error: 'boom', reload: vi.fn() };
        calendar.events.data = AUTUMN_SALE;
        const actor = userEvent.setup();
        renderCalendar();

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('What is coming for your games could not be loaded just now.');
        expect(screen.getByRole('list', { name: 'What is on in October' })).toHaveTextContent('Steam Autumn Sale');

        await actor.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(calendar.releases.reload).toHaveBeenCalledTimes(1);
    });

    it('says the showcases are missing rather than that there are none, and asks again when told to', async () => {
        calendar.events.data = calendarEvents({ degraded: true });
        const actor = userEvent.setup();
        renderCalendar();

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('The showcases could not be loaded just now.');

        await actor.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(calendar.events.reload).toHaveBeenCalledTimes(1);
    });
});

describe('ReleaseCalendar, Add to Backlog', () => {
    it('adds a game in no list to the Backlog, under the name the user gave it', async () => {
        calendar.releases.data = [LAUFEY];
        lists.nameFor = (id: ListId) => (id === 'backlog' ? 'Someday' : LIST_NAMES[id]);
        const actor = userEvent.setup();
        renderCalendar();

        await actor.click(screen.getByRole('button', { name: 'Add to Someday: God of War Laufey' }));

        expect(lists.addToList).toHaveBeenCalledWith('backlog', expect.objectContaining({ id: 389000, title: 'God of War Laufey', releaseDate: null }));
        lists.nameFor = (id: ListId) => LIST_NAMES[id];
    });

    it('offers nothing for a game already in a list, and says which', () => {
        calendar.releases.data = [LAUFEY];
        listed.set(389000, 'playing');
        renderCalendar();

        expect(screen.queryByRole('button', { name: /^Add to/ })).not.toBeInTheDocument();
        expect(screen.getByText('In Playing')).toBeInTheDocument();
    });
});

describe('ReleaseCalendar, the wishlist', () => {
    it('puts a release on the wishlist, whatever list it is in', async () => {
        calendar.releases.data = [LAUFEY];
        listed.set(389000, 'finished');
        const actor = userEvent.setup();
        renderCalendar();

        const toggle = screen.getByRole('button', { name: 'Wishlist God of War Laufey' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await actor.click(toggle);

        expect(wishlist.add).toHaveBeenCalledWith(expect.objectContaining({ id: 389000, title: 'God of War Laufey' }));
    });

    it('shows a wishlisted release as one, and takes it back off', async () => {
        calendar.releases.data = [LAUFEY];
        wishlisted.add(389000);
        const actor = userEvent.setup();
        renderCalendar();

        const toggle = screen.getByRole('button', { name: 'Wishlist God of War Laufey' });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await actor.click(toggle);

        expect(wishlist.remove).toHaveBeenCalledWith(389000);
    });

    it('says so in the card when the change did not stick', async () => {
        calendar.releases.data = [LAUFEY];
        Object.assign(wishlist, { add: vi.fn(async () => false) });
        const actor = userEvent.setup();
        renderCalendar();

        await actor.click(screen.getByRole('button', { name: 'Wishlist God of War Laufey' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not update your wishlist.');
    });

    it('offers nothing to whoever is not signed in', () => {
        calendar.releases.data = [LAUFEY];
        Object.assign(auth, { user: null });
        renderCalendar();

        expect(screen.queryByRole('button', { name: /^(Wishlist|Add to) / })).not.toBeInTheDocument();
    });

    it('offers it and the Backlog beside each release in a group', async () => {
        calendar.releases.data = [releaseEntry('2026-10-08', [
            connectedRelease({ gameId: 1, title: 'Kingdom Hearts III' }),
            connectedRelease({ gameId: 2, title: 'Kingdom Hearts 0.2' }),
        ], 'Kingdom Hearts')];
        const actor = userEvent.setup();
        renderCalendar();

        await actor.click(screen.getByText('Show all 2'));
        await actor.click(screen.getByRole('button', { name: 'Wishlist Kingdom Hearts 0.2' }));

        expect(screen.getByRole('button', { name: 'Add to Backlog: Kingdom Hearts 0.2' })).toBeInTheDocument();
        expect(wishlist.add).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    });
});

describe('ReleaseCalendar, announced with no date', () => {
    it('lists what IGDB has no date for, announced for its platforms', () => {
        calendar.undated.data = [ELDER_SCROLLS_VI];
        renderCalendar();

        const section = screen.getByRole('region', { name: 'Announced, no date' });
        expect(within(section).getByRole('link', { name: 'The Elder Scrolls VI' })).toBeInTheDocument();
        expect(within(section).getByText('On your wishlist — announced for PC')).toBeInTheDocument();
    });

    it('is the same in every month', () => {
        calendar.undated.data = [ELDER_SCROLLS_VI];
        renderCalendar('/calendar?month=2027-06');

        expect(within(screen.getByRole('region', { name: 'Announced, no date' })).getByRole('link', { name: 'The Elder Scrolls VI' }))
            .toBeInTheDocument();
    });

    it("bands what is announced by what it is to the user's game", () => {
        calendar.undated.data = [
            ELDER_SCROLLS_VI,
            {
                groupName: null,
                releases: [connectedRelease({
                    gameId: 174982,
                    title: 'Warframe Mobile',
                    kind: 'port',
                    reason: { relation: 'child', gameId: 2903, title: 'Warframe', membership: 'wishlist' },
                })],
            },
            {
                groupName: null,
                releases: [connectedRelease({
                    gameId: 405088,
                    title: 'Persona 6',
                    reason: { relation: 'series', gameId: 114283, title: 'Persona 5 Royal', membership: 'list', list: 'on_hold', series: 'Persona' },
                })],
            },
        ];
        renderCalendar();

        const section = screen.getByRole('region', { name: 'Announced, no date' });
        expect(within(section).getAllByRole('heading', { level: 3 }).map(h => h.textContent))
            .toEqual(['Your games', 'Remakes, remasters and ports', 'From the same series']);

        expect(within(screen.getByRole('region', { name: 'Your games' })).getByRole('link', { name: 'The Elder Scrolls VI' }))
            .toBeInTheDocument();
        const versions = within(screen.getByRole('region', { name: 'Remakes, remasters and ports' }));
        expect(versions.getByRole('link', { name: 'Warframe Mobile' })).toBeInTheDocument();
        expect(versions.getByText('Port of Warframe, on your wishlist')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'From the same series' })).getByRole('link', { name: 'Persona 6' }))
            .toBeInTheDocument();
    });

    it('says when nothing is waiting on a date', () => {
        renderCalendar();

        expect(screen.getByText('Nothing connected to your games is waiting on a date.')).toBeInTheDocument();
    });

    it('shows the first twelve of a band and keeps the rest a click away', async () => {
        calendar.undated.data = Array.from({ length: 14 }, (_, index): UndatedEntry => ({
            groupName: null,
            releases: [connectedRelease({ gameId: index + 1, title: `Game ${index + 1}` })],
        }));
        const actor = userEvent.setup();
        renderCalendar();

        const list = screen.getByRole('list', { name: 'Your games' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(12);

        await actor.click(screen.getByRole('button', { name: 'Show all 14' }));
        expect(within(list).getAllByRole('listitem')).toHaveLength(14);
    });
});
