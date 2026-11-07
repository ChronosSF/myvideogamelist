import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RelatedGamesRail } from '@/components/RelatedGamesRail';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import type { GameDto, RelatedGameDto, RelatedGameKind, RelatedGamesDto } from '@/types/game';
import { LIST_NAMES, type ListId } from '@/types/list';
import { quickActor } from '@/test/actor';
import { userProfile } from '@/test/factories';

/**
 * The game page's related games (issue 450, ADR 0084): what the rail draws from what it is handed, and
 * the bulk add to the Backlog. The providers are mocked as far as the rail and its cards read them, each
 * one module-level object handed back on every call — a fresh literal per render re-runs any effect that
 * depends on it.
 */

/** Which list each game is in. The mocked add puts it there, as the provider's optimistic change does. */
const listed = new Map<number, ListId>();
const lists = {
    loading: false,
    error: null as string | null,
    getListFor: (gameId: number) => listed.get(gameId) ?? null,
    isPending: () => false,
    nameFor: (id: ListId) => LIST_NAMES[id],
    addToList: vi.fn(),
} as unknown as ListsContextValue;

vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));

const auth = { user: userProfile({ id: 'user-1' }), loading: false } as unknown as AuthContextValue;

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const favourites = { isFavourite: () => false } as unknown as FavouritesContextValue;

vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

const wishlist = {
    isWishlisted: () => false,
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
} as unknown as WishlistContextValue;

vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

/** An add the provider keeps, as nearly every add is. */
const keepsEveryAdd = async (listId: ListId, game: GameDto) => {
    listed.set(game.id, listId);
    return true;
};

beforeEach(() => {
    listed.clear();
    Object.assign(lists, {
        loading: false,
        error: null,
        nameFor: (id: ListId) => LIST_NAMES[id],
        addToList: vi.fn(keepsEveryAdd),
    });
    Object.assign(auth, { user: userProfile({ id: 'user-1' }) });
    favourites.isFavourite = () => false;
});

function related(id: number, name: string, releaseYear: number | null, kind: RelatedGameKind = 'game'): RelatedGameDto {
    return { id, name, coverImageUrl: null, releaseYear, kind };
}

const WITCHER_3 = related(30, 'The Witcher 3: Wild Hunt', 2015);

/** A series of four with the page's game third, and three releases of it besides. */
const WITCHER: RelatedGamesDto = {
    anchorId: 30,
    games: [
        related(10, 'The Witcher', 2007),
        related(20, 'The Witcher 2: Assassins of Kings', 2011),
        WITCHER_3,
        related(40, 'The Witcher Remake', null, 'remake'),
    ],
    editions: [
        related(31, 'The Witcher 3: Wild Hunt - Game of the Year Edition', 2016, 'edition'),
        related(32, 'The Witcher 3: Wild Hunt: Complete Edition', 2022, 'edition'),
        related(33, 'Witcher Trilogy Pack', null, 'bundle'),
    ],
};

/** A series of `count` games, the anchor at `anchorAt`, with no editions. */
function series(count: number, anchorAt: number): RelatedGamesDto {
    const games = Array.from({ length: count }, (_, index) => related(100 + index, `Game ${index + 1}`, 2000 + index));
    return { anchorId: games[anchorAt].id, games, editions: [] };
}

function renderRail(props: {
    related?: RelatedGamesDto;
    gameId?: number;
    seriesNames?: string[];
} = {}) {
    const rail = props.related ?? WITCHER;
    return render(
        <MemoryRouter>
            <RelatedGamesRail
                related={rail}
                gameId={props.gameId ?? rail.anchorId}
                seriesNames={props.seriesNames ?? ['The Witcher']}
            />
        </MemoryRouter>,
    );
}

const rail = (name = 'The Witcher series') => screen.getByRole('list', { name });
const cards = (name?: string) => within(rail(name)).getAllByRole('listitem');

describe('RelatedGamesRail', () => {
    it('draws nothing for a game that is alone, with no series, remakes or editions', () => {
        const { container } = renderRail({ related: { anchorId: 30, games: [WITCHER_3], editions: [] } });

        expect(container).toBeEmptyDOMElement();
    });

    it('is named for the series, without doubling a series name that starts with "The"', () => {
        renderRail({ seriesNames: ['The Witcher'] });

        expect(screen.getByRole('heading', { level: 2, name: 'The Witcher series' })).toBeInTheDocument();
        expect(rail('The Witcher series')).toBeInTheDocument();
    });

    it('puts "The" in front of a series name that has none', () => {
        renderRail({ seriesNames: ['Mass Effect'] });

        expect(screen.getByRole('heading', { level: 2, name: 'The Mass Effect series' })).toBeInTheDocument();
    });

    it('is called related games when there is no one series to name it after', () => {
        const { unmount } = renderRail({ seriesNames: [] });
        expect(screen.getByRole('heading', { level: 2, name: 'Related games' })).toBeInTheDocument();
        unmount();

        renderRail({ seriesNames: ['The Witcher', 'CD Projekt RED games'] });
        expect(screen.getByRole('heading', { level: 2, name: 'Related games' })).toBeInTheDocument();
        expect(rail('Related games')).toBeInTheDocument();
    });

    it('says how many games there are, in release order', () => {
        renderRail();

        expect(screen.getByText('4 games, in release order')).toBeInTheDocument();
    });

    it('counts one game as one, for a game with only editions besides', () => {
        renderRail({ related: { ...WITCHER, games: [WITCHER_3] } });

        expect(screen.getByText('1 game, in release order')).toBeInTheDocument();
    });

    it('shows a card for each game in order, this one marked and not linked to the page it is on', () => {
        renderRail();

        const items = cards();
        expect(items).toHaveLength(4);
        expect(within(rail()).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
            ['The Witcher', '/games/10'],
            ['The Witcher 2: Assassins of Kings', '/games/20'],
            ['The Witcher Remake', '/games/40'],
        ]);

        const self = items[2];
        expect(self).toHaveTextContent('The Witcher 3: Wild Hunt');
        expect(self).toHaveTextContent('This game');
        expect(within(self).queryByRole('link')).not.toBeInTheDocument();
        // The hero above offers it all, so the anchor offers nothing.
        expect(within(self).queryByRole('button')).not.toBeInTheDocument();
    });

    it('marks the anchor as the original, and links it, on the page of one of its editions', () => {
        renderRail({ gameId: 31 });

        const original = cards()[2];
        expect(original).toHaveTextContent('Its original');
        expect(original).not.toHaveTextContent('This game');
        expect(within(original).getByRole('link', { name: 'The Witcher 3: Wild Hunt' })).toHaveAttribute('href', '/games/30');
    });

    it("says which list the original is in on an edition's page, where the hero above offers the edition", () => {
        listed.set(30, 'playing');
        renderRail({ gameId: 31 });

        const original = cards()[2];
        expect(original).toHaveTextContent('Its original');
        expect(original).toHaveTextContent(LIST_NAMES.playing);
    });

    it("offers the original what any card offers on an edition's page", async () => {
        const actor = quickActor();
        renderRail({ gameId: 31 });

        await actor.click(within(cards()[2]).getByRole('button', { name: 'Add to Backlog: The Witcher 3: Wild Hunt' }));

        expect(lists.addToList).toHaveBeenCalledWith('backlog', expect.objectContaining({ id: 30 }));
    });

    it("leaves the original out of the bulk add on an edition's page, being the game the edition is", async () => {
        const actor = quickActor();
        renderRail({ gameId: 31 });

        await actor.click(screen.getByRole('button', { name: "Add the 3 you don't track to Backlog" }));

        expect(vi.mocked(lists.addToList).mock.calls.map(([, game]) => game.id)).toEqual([10, 20, 40]);
    });

    it("draws an edition's original even when it stands alone, since it is the way there", () => {
        renderRail({ related: { anchorId: 30, games: [WITCHER_3], editions: [] }, gameId: 31, seriesNames: [] });

        const original = cards('Related games')[0];
        expect(original).toHaveTextContent('Its original');
        expect(within(original).getByRole('link', { name: 'The Witcher 3: Wild Hunt' })).toHaveAttribute('href', '/games/30');
    });

    it('gives each card its year, or says there is none yet, and what it is when it is not a game in its own right', () => {
        renderRail();

        const [first, , , remake] = cards();
        expect(first).toHaveTextContent('2007');
        expect(first).not.toHaveTextContent('·');
        expect(remake).toHaveTextContent('No date yet · Remake');
    });

    it('has a word for each kind of release that is not a game of its own', () => {
        const kinds: RelatedGameKind[] = ['remake', 'remaster', 'expanded', 'port', 'standalone', 'game'];
        renderRail({
            related: {
                anchorId: 1,
                games: kinds.map((kind, index) => related(index + 1, `Release ${index + 1}`, 2020, kind)),
                editions: [],
            },
        });

        expect(cards().map(card => card.textContent)).toEqual([
            expect.stringContaining('2020 · Remake'),
            expect.stringContaining('2020 · Remaster'),
            expect.stringContaining('2020 · Expanded'),
            expect.stringContaining('2020 · Port'),
            expect.stringContaining('2020 · Standalone'),
            expect.not.stringContaining('·'),
        ]);
    });

    it('says which of the reader\'s lists a game is in, by the reader\'s name for it, and offers nothing else', () => {
        listed.set(10, 'finished');
        lists.nameFor = (id: ListId) => (id === 'finished' ? 'Beaten' : LIST_NAMES[id]);
        renderRail();

        const first = cards()[0];
        expect(first).toHaveTextContent('Beaten');
        expect(within(first).queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers the wishlist and the Backlog for a game in none of the reader\'s lists', async () => {
        const actor = quickActor();
        renderRail();

        const second = cards()[1];
        await actor.click(within(second).getByRole('button', { name: 'Wishlist The Witcher 2: Assassins of Kings' }));
        await actor.click(within(second).getByRole('button', { name: 'Add to Backlog: The Witcher 2: Assassins of Kings' }));

        expect(wishlist.add).toHaveBeenCalledWith(expect.objectContaining({ id: 20 }));
        expect(lists.addToList).toHaveBeenCalledWith('backlog', expect.objectContaining({ id: 20, title: 'The Witcher 2: Assassins of Kings' }));
    });

    it('offers nothing to somebody signed out', () => {
        auth.user = null;
        renderRail();

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('marks the reader\'s favourites, in the card\'s name too', () => {
        favourites.isFavourite = gameId => gameId === 20;
        renderRail();

        expect(within(rail()).getByRole('link', { name: 'The Witcher 2: Assassins of Kings, one of your favourites' }))
            .toHaveAttribute('href', '/games/20');
        expect(within(rail()).getByRole('link', { name: 'The Witcher' })).toBeInTheDocument();
    });

    it('lists the game\'s other releases under the rail, each without the name of the game in front', () => {
        renderRail();

        const line = screen.getByText(/^Other releases of this game:/);
        expect(within(line).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
            ['Game of the Year Edition', '/games/31'],
            ['Complete Edition', '/games/32'],
            // Not so prefixed, so whole.
            ['Witcher Trilogy Pack', '/games/33'],
        ]);
        expect(line).toHaveTextContent('Game of the Year Edition 2016 · Complete Edition 2022 · Witcher Trilogy Pack');
    });

    it('has no line of other releases for a game with none', () => {
        renderRail({ related: { ...WITCHER, editions: [] } });

        expect(screen.queryByText(/Other releases of this game/)).not.toBeInTheDocument();
    });
});

describe('RelatedGamesRail, a long series', () => {
    it('opens a few games before this one once it would be past the first screen, with the earlier ones a press away', async () => {
        const actor = quickActor();
        renderRail({ related: series(10, 8), gameId: 108, seriesNames: ['Long'] });

        // Opened three before the anchor, with the five before those behind a button.
        const items = cards('The Long series');
        expect(items).toHaveLength(1 + 5);
        expect(items[1]).toHaveTextContent('Game 6');
        expect(items[4]).toHaveTextContent('This game');

        await actor.click(screen.getByRole('button', { name: '5 earlier games' }));

        const all = cards('The Long series');
        expect(all).toHaveLength(10);
        expect(all[0]).toHaveTextContent('Game 1');
        expect(screen.queryByRole('button', { name: /earlier game/ })).not.toBeInTheDocument();
    });

    it('opens at the start while this game is still in the first seven', () => {
        renderRail({ related: series(10, 6), gameId: 106, seriesNames: ['Long'] });

        const items = cards('The Long series');
        expect(items).toHaveLength(10);
        expect(items[0]).toHaveTextContent('Game 1');
        expect(screen.queryByRole('button', { name: /earlier game/ })).not.toBeInTheDocument();
    });
});

describe('RelatedGamesRail, adding the rest to the Backlog', () => {
    it('adds every game the reader does not track, one after another, and says so once done', async () => {
        const actor = quickActor();
        listed.set(20, 'playing');
        renderRail();

        await actor.click(screen.getByRole('button', { name: "Add the 2 you don't track to Backlog" }));

        expect(await screen.findByText('Added 2 to Backlog.')).toHaveAttribute('role', 'status');
        expect(vi.mocked(lists.addToList).mock.calls.map(([listId, game]) => [listId, game.id, game.title])).toEqual([
            ['backlog', 10, 'The Witcher'],
            ['backlog', 40, 'The Witcher Remake'],
        ]);
        // Nothing left that it does not track, so nothing more to offer.
        expect(screen.queryByRole('button', { name: /you don't track/ })).not.toBeInTheDocument();
    });

    it('says "the one" for a single game', () => {
        listed.set(10, 'finished');
        listed.set(20, 'finished');
        renderRail();

        expect(screen.getByRole('button', { name: "Add the one you don't track to Backlog" })).toBeInTheDocument();
    });

    it('calls the Backlog what the reader calls it', async () => {
        const actor = quickActor();
        lists.nameFor = (id: ListId) => (id === 'backlog' ? 'Up Next' : LIST_NAMES[id]);
        renderRail();

        await actor.click(screen.getByRole('button', { name: "Add the 3 you don't track to Up Next" }));

        expect(await screen.findByText('Added 3 to Up Next.')).toBeInTheDocument();
    });

    it('asks first before adding more than five', async () => {
        const actor = quickActor();
        renderRail({ related: series(8, 0), gameId: 100, seriesNames: ['Long'] });

        await actor.click(screen.getByRole('button', { name: "Add the 7 you don't track to Backlog" }));

        const asking = screen.getByRole('group', { name: 'Add 7 games to Backlog?' });
        expect(lists.addToList).not.toHaveBeenCalled();

        await actor.click(within(asking).getByRole('button', { name: 'Add 7' }));

        expect(await screen.findByText('Added 7 to Backlog.')).toBeInTheDocument();
        expect(lists.addToList).toHaveBeenCalledTimes(7);
        expect(screen.queryByRole('group', { name: /games to Backlog\?/ })).not.toBeInTheDocument();
    });

    it('adds nothing when the reader thinks better of it', async () => {
        const actor = quickActor();
        renderRail({ related: series(8, 0), gameId: 100, seriesNames: ['Long'] });

        await actor.click(screen.getByRole('button', { name: "Add the 7 you don't track to Backlog" }));
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(lists.addToList).not.toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Add 7 games to Backlog?' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: "Add the 7 you don't track to Backlog" })).toBeInTheDocument();
    });

    it('says how many could not be added, when the provider took any back', async () => {
        const actor = quickActor();
        // The add for one game is rolled back, and says so. As in the provider, the game is placed at once
        // and taken back later, so the lists still show it placed when the rail reads the add's answer.
        lists.addToList = vi.fn(async (listId: ListId, game: GameDto) => {
            listed.set(game.id, listId);
            if (game.id !== 40) return true;
            setTimeout(() => listed.delete(game.id));
            return false;
        });
        renderRail();

        await actor.click(screen.getByRole('button', { name: "Add the 3 you don't track to Backlog" }));

        expect(await screen.findByText('Added 2 to Backlog; 1 could not be added. Please try again.')).toBeInTheDocument();
    });

    it('is not offered until the lists are known, when every game would look untracked', () => {
        lists.loading = true;
        const { unmount } = renderRail();
        expect(screen.queryByRole('button', { name: /you don't track/ })).not.toBeInTheDocument();
        unmount();

        Object.assign(lists, { loading: false, error: 'Your lists could not be loaded.' });
        renderRail();
        expect(screen.queryByRole('button', { name: /you don't track/ })).not.toBeInTheDocument();
    });

    it('is not offered to somebody signed out', () => {
        auth.user = null;
        renderRail();

        expect(screen.queryByRole('button', { name: /you don't track/ })).not.toBeInTheDocument();
    });
});
