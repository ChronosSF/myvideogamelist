import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterContextProvider, createRoutesStub, Link, Outlet, type LoaderFunction } from 'react-router';
import { ErrorBoundary, GamePage, headers, loader, meta } from '@/pages/GamePage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { MIN_MEMBER_SCORES } from '@/lib/score';
import type { UserProfile } from '@/types/auth';
import { game, gameDetails, userProfile } from '@/test/factories';
import type { GameDetailsDto, GameDto } from '@/types/game';
import type { Route } from './+types/GamePage';

/**
 * Auth, mocked rather than provided: the real provider fetches, and the page only reads `user` and
 * `loading`.
 *
 * One module-level object handed back on every call and never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure. Each test sets the fields for the moment it is about.
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

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

/**
 * The members' view of the game, mocked for the same reason and held to the same rule as `auth`.
 * The page reads it for one thing of its own — the badge in the hero — and hands the rest to a
 * section that has a suite of its own.
 */
const community: UseGameCommunityResult = {
    settled: false,
    scores: null,
    reviews: [],
    total: null,
    hasMore: false,
    loadingMore: false,
    moreFailed: false,
    reloading: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
};

vi.mock('@/hooks/useGameCommunity', () => ({ useGameCommunity: () => community }));

/** The reader's favourites, as far as the rosette reads them. Hoisted and handed back whole, as above. */
const favoured = new Set<number>();
const favourites = {
    isFavourite: (gameId: number) => favoured.has(gameId),
} as unknown as FavouritesContextValue;

vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

// All four fetch for themselves after hydration. What this suite is about is which of three things
// the sidebar shows and what the hero says, so the panel — which has a suite of its own — is
// reduced to the heading a reader knows it by, and the sections that render nothing until their
// fetch answers are left out.
vi.mock('@/components/GameUserPanel', () => ({ GameUserPanel: () => <h2>Your copy</h2> }));
vi.mock('@/components/CompletionTimes', () => ({ CompletionTimes: () => null }));
vi.mock('@/components/GameNewsPanel', () => ({ GameNewsPanel: () => null }));
vi.mock('@/components/GameCommunity', () => ({ GameCommunity: () => null }));

const CELESTE = game({ id: 1, title: 'Celeste' });

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

/** The route with its loader's answer already in hand, as it is on the server. */
function renderPage(loaded: GameDto = CELESTE) {
    const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
    return render(
        <Stub
            initialEntries={['/games/1']}
            hydrationData={{ loaderData: { game: { game: loaded } } }}
        />,
    );
}

beforeEach(() => {
    auth.user = null;
    auth.loading = true;
    community.settled = false;
    community.scores = null;
    favoured.clear();
});

describe('GamePage sidebar before auth has answered', () => {
    it('holds the slot without the panel, a sign-in prompt or a spinner', () => {
        // Every server render is in this state — the page is shared-cached, so it cannot know who
        // is asking — and so is the first client render. It is what every visitor sees first, and
        // what the edge keeps.
        renderPage();

        expect(screen.getByRole('heading', { level: 1, name: 'Celeste' })).toBeInTheDocument();

        const sidebar = screen.getByRole('complementary');
        expect(within(sidebar).queryByRole('heading', { name: 'Your copy' })).not.toBeInTheDocument();
        expect(within(sidebar).queryByText(/sign in to track this game/i)).not.toBeInTheDocument();
        expect(within(sidebar).queryByRole('status')).not.toBeInTheDocument();
    });
});

describe('GamePage release date', () => {
    it('names the day IGDB gives, and its year, west of Greenwich too', () => {
        // The suite runs west of Greenwich, where 1 January read as UTC midnight is New Year's Eve.
        const celeste = game({ id: 1, title: 'Celeste', releaseDate: '2027-01-01' });
        const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
        render(<Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: celeste } } }} />);

        expect(within(screen.getByRole('heading', { level: 1 })).getByText('(2027)')).toBeInTheDocument();
        // Under the title, and again in the sidebar's details.
        expect(screen.getAllByText('January 1, 2027')).toHaveLength(2);
    });
});

describe('GamePage sidebar once auth has answered', () => {
    it('asks a signed-out visitor to sign in', () => {
        authAnswered(null);
        renderPage();

        expect(screen.getByText(/sign in to track this game/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Your copy' })).not.toBeInTheDocument();
    });

    it('shows a signed-in user their panel', () => {
        authAnswered(userProfile());
        renderPage();

        expect(screen.getByRole('heading', { name: 'Your copy' })).toBeInTheDocument();
        expect(screen.queryByText(/sign in to track this game/i)).not.toBeInTheDocument();
    });
});

describe("GamePage hero's member score", () => {
    /** The members' scores have come back, for a given number of members averaging 8.4. */
    function scored(members: number) {
        community.settled = true;
        community.scores = { scored: members, mean: 8.4, distribution: [0, 0, 0, 0, 0, 0, 0, members, 0, 0] };
    }

    it("sits beside IGDB's aggregates, out of 100 and with its count", () => {
        // Ours is an average of other people like theirs, so it wears the same badge on the same
        // scale — never stars, which mean the reader's own score (ADR 0021).
        scored(23);
        renderPage();

        expect(screen.getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
    });

    it('is absent until enough members have scored the game', () => {
        // A mean over a handful of members is a handful of opinions presented as a verdict.
        scored(MIN_MEMBER_SCORES - 1);
        renderPage();

        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
    });

    it('is absent before the scores have answered, which is every server render', () => {
        renderPage();

        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
    });
});

describe('GamePage trailer', () => {
    it('waits for its own press on the next game, after the last one played', async () => {
        const actor = userEvent.setup();
        const celeste = game({ id: 1, title: 'Celeste', trailerUrl: 'https://www.youtube.com/watch?v=celeste' });
        const hades = game({ id: 2, title: 'Hades', trailerUrl: 'https://www.youtube.com/watch?v=hades' });
        // The link sits outside the page, which so stays mounted from one game to the next, as it
        // does when a similar game is followed.
        const Stub = createRoutesStub([{
            Component: () => <><Link to="/games/2">Next game</Link><Outlet /></>,
            children: [{ id: 'game', path: '/games/:id', Component: GamePage, loader: () => ({ game: hades }) }],
        }]);
        render(<Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: celeste } } }} />);

        await actor.click(screen.getByRole('button', { name: /Play trailer/ }));
        expect(screen.getByTitle('Celeste trailer')).toBeInTheDocument();

        await actor.click(screen.getByRole('link', { name: 'Next game' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Hades' })).toBeInTheDocument();
        expect(screen.queryByTitle('Hades trailer')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Play trailer/ })).toBeInTheDocument();
    });

    it('says that the trailer and the official site open in a new tab', () => {
        // A trailer YouTube cannot embed is a link out, as the official site is.
        const celeste = game({ id: 1, title: 'Celeste', trailerUrl: 'https://vimeo.com/celeste', website: 'https://www.celestegame.com' });
        const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
        render(<Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: celeste } } }} />);

        expect(screen.getByRole('link', { name: 'Watch Trailer (opens in a new tab)' })).toHaveAttribute('target', '_blank');
        expect(screen.getByRole('link', { name: 'Official Site (opens in a new tab)' })).toHaveAttribute('target', '_blank');
    });
});

/**
 * The rosette drawn on a cover. By its class, the one exception to querying by role: the mark is
 * deliberately outside the accessibility tree, and what it says is asserted through the words instead.
 */
const coverMarks = (root: HTMLElement) => root.querySelectorAll('.favourite-mark-cover');

describe('GamePage related games', () => {
    const TUNIC = { id: 2, name: 'Tunic', coverImageUrl: null };
    const HADES = { id: 3, name: 'Hades', coverImageUrl: null };
    const FAREWELL = { id: 4, name: 'Farewell', coverImageUrl: null };

    function renderWithDetails(details: GameDetailsDto) {
        authAnswered(userProfile());
        renderPage(game({ id: 1, title: 'Celeste', details }));
    }

    it("marks the reader's favourites among the similar games, in the names of their links", () => {
        favoured.add(TUNIC.id);
        renderWithDetails(gameDetails({ similarGames: [TUNIC, HADES] }));

        const rail = screen.getByRole('list', { name: 'Games similar to Celeste' });
        expect(within(rail).getAllByRole('link').map(link => link.textContent))
            .toEqual(['Tunic, one of your favourites', 'Hades']);
        expect(coverMarks(within(rail).getByRole('link', { name: /Tunic/ }))).toHaveLength(1);
        expect(coverMarks(rail)).toHaveLength(1);
    });

    it("marks the reader's favourites among the expansions and DLC too", () => {
        favoured.add(FAREWELL.id);
        renderWithDetails(gameDetails({ expansions: [FAREWELL], dlcs: [HADES] }));

        const rail = screen.getByRole('list', { name: 'Expansions and DLC for Celeste' });
        expect(within(rail).getAllByRole('link').map(link => link.textContent))
            .toEqual(['Farewell, one of your favourites', 'Hades']);
        expect(coverMarks(rail)).toHaveLength(1);
    });
});

describe('GamePage where to play', () => {
    it('lists the stores the API named, in the server render', () => {
        // In the loader's data, so a crawler and a reader without JavaScript get the row as well.
        renderPage(game({
            id: 1,
            title: 'Celeste',
            details: gameDetails({
                stores: [
                    { store: 'Steam', url: 'https://store.steampowered.com/app/504230' },
                    { store: 'itch.io', url: 'https://mattmakesgames.itch.io/celeste' },
                ],
            }),
        }));

        const row = screen.getByRole('list', { name: 'Where to play' });
        expect(within(row).getByRole('link', { name: /^Steam/ }))
            .toHaveAttribute('href', 'https://store.steampowered.com/app/504230');
        expect(within(row).getByRole('link', { name: /^itch\.io/ }))
            .toHaveAttribute('href', 'https://mattmakesgames.itch.io/celeste');
    });

    it('has no row for a game IGDB names no store for', () => {
        renderPage(game({ id: 1, title: 'Celeste', details: gameDetails() }));

        expect(screen.queryByRole('heading', { name: 'Where to play' })).not.toBeInTheDocument();
    });

    it('has no row, and does not fail, when the details lack the stores', () => {
        // A game page's data is shared-cached for an hour and served stale for up to a day after, so a
        // copy made before the stores existed can reach a client that expects them.
        const { stores: _, ...older } = gameDetails();
        renderPage(game({ id: 1, title: 'Celeste', details: older as GameDetailsDto }));

        expect(screen.getByRole('heading', { level: 1, name: 'Celeste' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Where to play' })).not.toBeInTheDocument();
    });
});

describe("GamePage hero's cover", () => {
    it('loads with the page, never lazily, at the size the hero draws it', () => {
        // With the key art behind it, it is what this page paints largest first.
        const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
        const celeste = game({
            id: 1,
            title: 'Celeste',
            coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co3byy.jpg',
        });
        render(<Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: celeste } } }} />);

        const cover = screen.getByRole('img', { name: 'Celeste cover' });
        expect(cover).not.toHaveAttribute('loading', 'lazy');
        expect(cover).not.toHaveAttribute('decoding', 'async');
        expect(cover.getAttribute('srcset')).toContain('/t_cover_small_2x/co3byy.jpg 180w');
        expect(cover).toHaveAttribute('sizes', '(min-width: 640px) 176px, 136px');
    });
});

describe('GamePage when there is no game to show', () => {
    afterEach(() => vi.unstubAllGlobals());

    /**
     * Answers the game request with each of these in turn, repeating the last. `'held'` is not answered
     * until the test calls the release it returns, which keeps a retry in flight.
     */
    function stubGameApi(...answers: Array<number | 'unreachable' | 'held'>) {
        let call = 0;
        let release: (() => void) | null = null;
        const fetchMock = vi.fn(async () => {
            const answer = answers[Math.min(call++, answers.length - 1)];
            if (answer === 'unreachable') throw new TypeError('Failed to fetch');
            if (answer === 'held') {
                await new Promise<void>(resolve => { release = resolve; });
                return new Response(JSON.stringify(CELESTE), { status: 200 });
            }
            return answer === 200
                ? new Response(JSON.stringify(CELESTE), { status: 200 })
                : new Response('nope', { status: answer });
        });
        vi.stubGlobal('fetch', fetchMock);
        return Object.assign(fetchMock, { release: () => release?.() });
    }

    /** The route as it runs: its own loader, and its own boundary for whatever the loader throws. */
    function renderRoute() {
        const Stub = createRoutesStub([{
            id: 'game',
            path: '/games/:id',
            Component: GamePage,
            ErrorBoundary,
            loader: loader as unknown as LoaderFunction,
        }]);
        return render(<Stub initialEntries={['/games/1']} />);
    }

    it('says IGDB is not answering and what still works, as the lists page says a failure', async () => {
        stubGameApi(502);
        renderRoute();

        expect(await screen.findByRole('heading', { level: 1, name: 'Failed to load this game' })).toBeInTheDocument();
        expect(screen.getByText(
            'Game details come from IGDB, which is not answering just now. Lists and profiles keep working without it.',
        )).toBeInTheDocument();
    });

    it('asks again when told to, and shows the game the moment it answers', async () => {
        const fetchMock = stubGameApi(502, 200);
        renderRoute();

        await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Celeste' })).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('is announced, since it replaces a whole page that a client-side navigation was opening', async () => {
        stubGameApi(502);
        renderRoute();

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load this game');
    });

    it('says it is trying again while the loader is out, and does not ask twice', async () => {
        const fetchMock = stubGameApi(502, 'held');
        renderRoute();

        await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
        const trying = await screen.findByRole('button', { name: 'Trying again…' });
        expect(trying).toHaveAttribute('aria-disabled', 'true');
        // Marked rather than disabled, so the reader who pressed it keeps their place.
        expect(trying).toHaveFocus();

        await userEvent.click(trying);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        fetchMock.release();
        expect(await screen.findByRole('heading', { level: 1, name: 'Celeste' })).toBeInTheDocument();
    });

    it('blames nobody else for a failure that is its own, and still offers to ask again', async () => {
        stubGameApi('unreachable');
        renderRoute();

        expect(await screen.findByText('Something went wrong on our side, so this game could not be loaded just now.')).toBeInTheDocument();
        expect(screen.queryByText(/IGDB/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it("blames nobody else for the API's own fault, which is a 500 and never IGDB's", async () => {
        stubGameApi(500);
        renderRoute();

        expect(await screen.findByText('Something went wrong on our side, so this game could not be loaded just now.')).toBeInTheDocument();
        expect(screen.queryByText(/IGDB/)).not.toBeInTheDocument();
    });

    it("says the API's throttle is busy in the API's own words, and that lists are unaffected", async () => {
        // A 503 is our own limit on calls to IGDB, not IGDB failing (ADR 0034).
        stubGameApi(503);
        renderRoute();

        expect(await screen.findByText(
            'Too many people are browsing games at once. Try again in a moment; lists and profiles are unaffected.',
        )).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('says there is no game at this address and offers browsing, because asking again will not help', async () => {
        stubGameApi(404);
        renderRoute();

        expect(await screen.findByRole('heading', { level: 1, name: 'There is no game at this address' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Browse games' })).toHaveAttribute('href', '/games');
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});

describe('GamePage caching', () => {
    afterEach(() => vi.unstubAllGlobals());

    // With a context, which the loader's calls are traced through (ADR 0059).
    const args = { params: { id: '1' }, context: new RouterContextProvider() } as unknown as Route.LoaderArgs;

    const policyOf = (init: { loaderHeaders?: HeadersInit; errorHeaders?: HeadersInit }) => headers({
        loaderHeaders: new Headers(init.loaderHeaders),
        errorHeaders: init.errorHeaders === undefined ? undefined : new Headers(init.errorHeaders),
        parentHeaders: new Headers(),
        actionHeaders: new Headers(),
    } as Route.HeadersArgs)['Cache-Control'];

    it("puts the game's own policy on the page it answered with", async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(CELESTE), { status: 200 })));

        const answer = await loader(args) as unknown as { init: ResponseInit };

        expect(new Headers(answer.init.headers).get('Cache-Control')).toBe(CACHE_GAME);
        expect(policyOf({ loaderHeaders: { 'Cache-Control': CACHE_GAME } })).toBe(CACHE_GAME);
    });

    it("hands on what the loader's thrown Response says, which used to go out as the game's hour", async () => {
        // This route is the boundary for its own failures, and a client-side navigation's `.data`
        // request reaches this function whichever route renders the error. React Router passes the
        // thrown Response's headers as both.
        const policyFor = async (status: number) => {
            vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status })));
            const thrown = await loader(args).catch((error: unknown) => error) as Response;
            expect(thrown.status).toBe(status);
            return policyOf({ errorHeaders: thrown.headers, loaderHeaders: thrown.headers });
        };

        expect(await policyFor(404)).toBe(CACHE_NOT_FOUND);
        expect(await policyFor(502)).toBe(PRIVATE_NO_STORE);
        expect(await policyFor(503)).toBe(PRIVATE_NO_STORE);
    });

    it('lets nothing store a failure that was not a Response at all', () => {
        expect(policyOf({})).toBe(PRIVATE_NO_STORE);
    });
});

describe('GamePage meta', () => {
    type Tag = Partial<Record<'title' | 'name' | 'property' | 'content' | 'rel' | 'href', string>>;

    const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

    const tagsFor = (overrides: Parameters<typeof game>[0]) =>
        meta({ loaderData: { game: game({ id: 26226, title: 'Celeste', ...overrides }), site: SITE } } as unknown as Route.MetaArgs) as Tag[];

    const content = (tags: Tag[], key: string) =>
        tags.find(tag => tag.property === key || tag.name === key)?.content;

    it('calls itself by its id, whatever address it was reached at', () => {
        // `/games/026226` and `/games/26226?ref=x` both render this page. The canonical URL comes
        // from the game the API answered with, so both say they are the same one.
        const tags = tagsFor({});

        expect(tags.find(tag => tag.rel === 'canonical')?.href).toBe('https://myvideogamelist.net/games/26226');
        expect(content(tags, 'og:url')).toBe('https://myvideogamelist.net/games/26226');
    });

    it('shares key art on a large card when IGDB has any', () => {
        const tags = tagsFor({ backgroundImageUrl: 'https://images.igdb.com/art.jpg', coverImageUrl: 'https://images.igdb.com/cover.jpg' });

        expect(content(tags, 'og:image')).toBe('https://images.igdb.com/art.jpg');
        expect(content(tags, 'twitter:card')).toBe('summary_large_image');
    });

    it('falls back to the cover on a small card, which is the crop a portrait survives', () => {
        const tags = tagsFor({ backgroundImageUrl: null, coverImageUrl: 'https://images.igdb.com/cover.jpg' });

        expect(content(tags, 'og:image')).toBe('https://images.igdb.com/cover.jpg');
        expect(content(tags, 'twitter:card')).toBe('summary');
    });

    it('shares no image rather than a broken one when IGDB has neither', () => {
        const tags = tagsFor({ backgroundImageUrl: null, coverImageUrl: null });

        expect(content(tags, 'og:image')).toBeUndefined();
        expect(content(tags, 'twitter:card')).toBe('summary');
    });

    it('does not call a game missing when it could not be loaded', () => {
        const titleFor = (status: number) => (meta({
            loaderData: undefined,
            error: { status, statusText: '', internal: false, data: '' },
        } as unknown as Route.MetaArgs) as Tag[])[0].title;

        expect(titleFor(404)).toBe('Game not found - MyVideoGameList');
        expect(titleFor(502)).toBe('Game unavailable - MyVideoGameList');
    });
});
