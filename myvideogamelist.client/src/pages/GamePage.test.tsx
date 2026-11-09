import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { RouterContextProvider, createRoutesStub, Link, Outlet, type LoaderFunction, type MetaDescriptor } from 'react-router';
import { ErrorBoundary, GamePage, headers, loader, meta } from '@/pages/GamePage';
import GameOverviewPage, { headers as overviewHeaders } from '@/pages/GameOverviewPage';
import GameYoursPage from '@/pages/GameYoursPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { AuthDialogContextValue } from '@/contexts/AuthDialogContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import { GameEntryContext, type GameEntryContextValue } from '@/contexts/GameEntryContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import { useGameEntry } from '@/hooks/useGameEntry';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { MIN_MEMBER_SCORES, MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import type { UserProfile } from '@/types/auth';
import type { CommunityScores } from '@/types/community';
import { LIST_NAMES, type ListId } from '@/types/list';
import { communityScores, communityTimes, game, gameDetails, listPending, platform, userProfile } from '@/test/factories';
import type { GameDetailsDto, GameDto, RelatedGameDto, RelatedGamesDto } from '@/types/game';
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
    updateLook: vi.fn(async () => {}),
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

/** The sign-in dialog, which every control of the hero's row opens for a reader who is signed out. */
const authDialog: AuthDialogContextValue = { open: vi.fn() };

vi.mock('@/hooks/useAuthDialog', () => ({ useAuthDialog: () => authDialog }));

/**
 * The lists and the wishlist, as far as the hero's row and the related games' cards read them: nothing
 * in any list or on the wishlist, every list under its own name, and nothing pending. Hoisted, as above.
 */
const lists = {
    loading: false,
    error: null,
    nameFor: (listId: ListId) => LIST_NAMES[listId],
    getListFor: () => null,
    pending: listPending(),
    addToList: vi.fn(async () => {}),
} as unknown as ListsContextValue;

vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));

const wishlist = {
    isWishlisted: () => false,
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
} as unknown as WishlistContextValue;

vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

const CELESTE = game({ id: 1, title: 'Celeste' });

/**
 * The reader's entry, as the hero's row reads it: in no list, unscored, nothing recorded, and its own
 * read answered. Handed back whole, as above.
 */
const entry = {
    game: CELESTE,
    profileVisibility: 'private',
    entryStatus: 'ready',
    ready: true,
    retryEntry: vi.fn(),
    pending: false,
    hasData: false,
    currentList: null,
    moveTo: vi.fn(async () => {}),
    takeOut: vi.fn(async () => {}),
    listError: null,
    score: null,
    changeScore: vi.fn(async () => {}),
    scoreError: null,
    wishlisted: false,
    wishlistPending: false,
    toggleWishlist: vi.fn(async () => {}),
    wishlistError: null,
    favourite: false,
    favouritePending: false,
    toggleFavourite: vi.fn(async () => {}),
    favouritesFailed: false,
    reloadFavourites: vi.fn(),
    favouriteError: null,
    notes: null,
    playthroughs: [],
    review: null,
} as Partial<GameEntryContextValue> as GameEntryContextValue;

// What this suite is about is what the page draws in each of auth's states, what it hands its two tabs,
// and what the hero says. The reader's entry is real in `GamePage.panel.test.tsx`; here it is reduced to
// the entry above, inside a region that says where the page mounted it, and a button standing in for
// every write it reports. The Your game tab, which has suites of its own, says only whether it was
// handed an entry. The sections that render nothing until their fetch answers are left out.
vi.mock('@/contexts/GameEntryProvider', () => ({
    GameEntryProvider: ({ onCommunityChange, children }: { onCommunityChange: () => void; children: ReactNode }) => (
        <GameEntryContext.Provider value={entry}>
            <div role="region" aria-label="The reader's entry">
                {children}
                <button type="button" onClick={onCommunityChange}>Save my score</button>
            </div>
        </GameEntryContext.Provider>
    ),
}));
vi.mock('@/components/GameYours', () => ({
    GameYours: () => <h2>{useGameEntry() === null ? 'Your game, with no entry' : 'Your game, from your entry'}</h2>,
}));
vi.mock('@/components/CompletionTimes', () => ({ CompletionTimes: () => null }));
vi.mock('@/components/GameNewsPanel', () => ({ GameNewsPanel: () => null }));

// The members' section has a suite of its own. Here it says only whose scores the page handed it,
// once it would show anything at all, so that the page's choice between the loader's and the
// browser's can be read off the section as well as off the hero.
vi.mock('@/components/GameCommunity', () => ({
    GameCommunity: ({ community: shown }: { community: UseGameCommunityResult }) =>
        shown.settled && shown.scores ? <p>{`The section's ${shown.scores.scored} scores`}</p> : null,
}));

/**
 * The API's answer to a request for the members' figures, which the loader reads beside the game
 * (ADR 0069): nobody has scored or timed it yet. Null for any other request, which is the game's.
 */
function figuresFor(url: string): Response | null {
    if (url.endsWith('/community-scores')) return Response.json(communityScores());
    if (url.endsWith('/community-times')) return Response.json(communityTimes());
    return null;
}

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

type StubRoute = Parameters<typeof createRoutesStub>[0][number];

/**
 * The game page and its two tabs as `routes.ts` has them, under the id typegen gives the page — which is
 * where the Your game tab's `meta` looks for the game.
 */
function gameRoute(extra: { loader?: LoaderFunction; ErrorBoundary?: StubRoute['ErrorBoundary'] } = {}): StubRoute {
    return {
        id: 'pages/GamePage',
        path: '/games/:id',
        Component: GamePage,
        ...extra,
        children: [
            { index: true, Component: GameOverviewPage },
            { path: 'yours', Component: GameYoursPage },
        ],
    };
}

/** The game page with its loader's answer already in hand, as it is on the server. */
const hydrated = (loaderData: Record<string, unknown>) => ({ loaderData: { 'pages/GamePage': loaderData } });

/**
 * The route with its loader's answer already in hand, at the Overview unless a test says otherwise. The
 * loader answers the same, so that the page keeps its data when a tab is followed: a route with no loader
 * keeps none past a navigation.
 */
function renderPage(loaded: GameDto = CELESTE, path = '/games/1') {
    const Stub = createRoutesStub([gameRoute({ loader: () => ({ game: loaded }) })]);
    return render(<Stub initialEntries={[path]} hydrationData={hydrated({ game: loaded })} />);
}

/**
 * The page under a shell holding a link to Hades, so that the page stays mounted when it is followed, as
 * it does when a similar game is followed. The page's loader answers with `next`.
 */
function renderWithNextGame(first: Record<string, unknown>, next: Record<string, unknown>) {
    const Stub = createRoutesStub([{
        Component: () => <><Link to="/games/2">Next game</Link><Outlet /></>,
        children: [gameRoute({ loader: () => next })],
    }]);
    return render(<Stub initialEntries={['/games/1']} hydrationData={hydrated(first)} />);
}

/** The hero's text block: the title, the badges under it, and the reader's row under them. */
const hero = () => screen.getByRole('heading', { level: 1, name: 'Celeste' }).parentElement!;

/** The facts beside the Overview's reading column. */
const facts = () => screen.getByRole('complementary', { name: 'The details' });

beforeEach(() => {
    auth.user = null;
    auth.loading = true;
    community.settled = false;
    community.scores = null;
    favoured.clear();
    vi.mocked(authDialog.open).mockClear();
    vi.mocked(community.reload).mockClear();
});

describe("GamePage hero's row before auth has answered", () => {
    it('draws every control, disabled, with nothing under them: no sign-in prompt, no spinner', () => {
        // Every server render is in this state — the page is shared-cached, so it cannot know who
        // is asking — and so is the first client render. It is what every visitor sees first, and
        // what the edge keeps: the same row a reader gets, so that nothing moves when auth answers.
        renderPage();

        const row = within(hero());
        expect(row.getByRole('button', { name: 'Add to Backlog' })).toBeDisabled();
        expect(row.getByRole('combobox', { name: 'Add to another list' })).toBeDisabled();
        expect(row.getByRole('group', { name: 'Your score for Celeste' })).toBeDisabled();
        expect(row.getByRole('button', { name: 'Add to wishlist' })).toBeDisabled();
        expect(row.getByRole('button', { name: 'Add to favourites' })).toBeDisabled();

        expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
        expect(screen.queryByText(/to keep this game in your lists/)).not.toBeInTheDocument();
        expect(screen.queryByText(/No playthroughs or review yet/)).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});

describe('GamePage release date', () => {
    it('names the day IGDB gives, and its year, west of Greenwich too', () => {
        // The suite runs west of Greenwich, where 1 January read as UTC midnight is New Year's Eve.
        renderPage(game({ id: 1, title: 'Celeste', releaseDate: '2027-01-01' }));

        const title = screen.getByRole('heading', { level: 1 });
        expect(within(title).getByText('(2027)')).toBeInTheDocument();
        // Under the title, and again in the Overview's facts.
        expect(within(title.parentElement!).getByText('January 1, 2027')).toBeInTheDocument();
        expect(within(facts()).getByText('January 1, 2027')).toBeInTheDocument();
    });
});

describe("GamePage hero's row once auth has answered", () => {
    it('asks a signed-out visitor to sign in, from the line under the row and from each control', async () => {
        // The same controls, live, so that the row is the size it will be once they sign in.
        const actor = userEvent.setup();
        authAnswered(null);
        renderPage();

        const row = within(hero());
        expect(row.getByText(/to keep this game in your lists, score it and wish for it\./)).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: "The reader's entry" })).not.toBeInTheDocument();

        await actor.click(row.getByRole('button', { name: 'Sign in' }));
        await actor.click(row.getByRole('button', { name: 'Add to Backlog' }));
        await actor.click(row.getByRole('button', { name: 'Add to wishlist' }));
        await actor.click(row.getByRole('button', { name: 'Add to favourites' }));

        expect(vi.mocked(authDialog.open).mock.calls).toEqual([['login'], ['login'], ['login'], ['login']]);
    });

    it("gives a signed-in reader their own entry, and the way to the rest of it", () => {
        authAnswered(userProfile());
        renderPage();

        const row = within(hero());
        expect(row.getByRole('group', { name: 'Your score for Celeste' })).toBeEnabled();
        expect(row.getByText(/No playthroughs or review yet/)).toBeInTheDocument();
        expect(row.getByRole('link', { name: 'Your game' })).toHaveAttribute('href', '/games/1/yours');
        expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    });

    it('draws the hero, the tabs and the Your game tab from that entry, and the Overview outside it', async () => {
        // Outside, so that a signed-in reader's arrival after hydration remounts the hero and nothing on
        // the Overview that would have to fetch again (ADR 0084 §4).
        authAnswered(userProfile());
        renderPage();

        const own = within(screen.getByRole('region', { name: "The reader's entry" }));
        expect(own.getByRole('heading', { level: 1, name: 'Celeste' })).toBeInTheDocument();
        expect(own.getByRole('navigation', { name: 'This game' })).toBeInTheDocument();
        expect(own.queryByRole('complementary', { name: 'The details' })).not.toBeInTheDocument();
        expect(facts()).toBeInTheDocument();

        const tabs = within(own.getByRole('navigation', { name: 'This game' }));
        await userEvent.setup().click(tabs.getByRole('link', { name: 'Your game' }));

        expect(await own.findByRole('heading', { level: 2, name: 'Your game, from your entry' })).toBeInTheDocument();
        // On the tab itself the line under the row does not link to it.
        expect(within(hero()).queryByRole('link', { name: 'Your game' })).not.toBeInTheDocument();
        expect(within(hero()).getByText(/No playthroughs or review yet/)).toBeInTheDocument();
    });
});

describe('GamePage tabs', () => {
    const tabs = () => within(screen.getByRole('navigation', { name: 'This game' }));

    it('offers the Overview and Your game, each an address of its own, and marks the Overview at the bare one', () => {
        renderPage();

        expect(tabs().getAllByRole('link').map(link => link.textContent)).toEqual(['Overview', 'Your game']);
        expect(tabs().getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/games/1');
        expect(tabs().getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
        expect(tabs().getByRole('link', { name: 'Your game' })).toHaveAttribute('href', '/games/1/yours');
        expect(tabs().getByRole('link', { name: 'Your game' })).not.toHaveAttribute('aria-current');
    });

    it("marks Your game, and only it, at the Your game tab's address", () => {
        // The Overview's address is the first part of this one, so it is active only on its own.
        renderPage(CELESTE, '/games/1/yours');

        expect(tabs().getByRole('link', { name: 'Your game' })).toHaveAttribute('aria-current', 'page');
        expect(tabs().getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('heading', { level: 2, name: 'Your game, with no entry' })).toBeInTheDocument();
        expect(screen.queryByRole('complementary', { name: 'The details' })).not.toBeInTheDocument();
    });

    it('swaps what is under the tabs and keeps the hero above them, going either way', async () => {
        const actor = userEvent.setup();
        authAnswered(null);
        renderPage();
        const title = screen.getByRole('heading', { level: 1, name: 'Celeste' });

        await actor.click(tabs().getByRole('link', { name: 'Your game' }));
        expect(await screen.findByRole('heading', { level: 2, name: 'Your game, with no entry' })).toBeInTheDocument();
        expect(screen.queryByRole('complementary', { name: 'The details' })).not.toBeInTheDocument();

        await actor.click(tabs().getByRole('link', { name: 'Overview' }));
        expect(await screen.findByRole('complementary', { name: 'The details' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /^Your game, / })).not.toBeInTheDocument();
        // The same element, so the hero was not drawn again from nothing either way.
        expect(screen.getByRole('heading', { level: 1, name: 'Celeste' })).toBe(title);
    });
});

/** A scores document: how many members scored the game, averaging `mean` on the 1–10 scale. */
function memberScores(members: number, mean = 8.4): CommunityScores {
    return communityScores({ scored: members, mean, distribution: [0, 0, 0, 0, 0, 0, 0, members, 0, 0], tracked: members });
}

/** The route, with the scores the loader read beside the game already in hand. */
function withLoaded(scores: CommunityScores | null) {
    const Stub = createRoutesStub([gameRoute()]);
    return <Stub initialEntries={['/games/1']} hydrationData={hydrated({ game: CELESTE, scores })} />;
}

describe("GamePage hero's member score", () => {
    /** The browser's own request for the members' scores has come back. */
    function scored(members: number, mean?: number) {
        community.settled = true;
        community.scores = memberScores(members, mean);
    }

    it("sits beside IGDB's aggregates, out of 100 and with its count", () => {
        // Ours is an average of other people like theirs, so it wears the same badge on the same
        // scale — never stars, which mean the reader's own score (ADR 0021).
        scored(23);
        renderPage();

        expect(within(hero()).getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
    });

    it('is in the server render, from the scores the loader read', () => {
        // Rendered to a string, as the server renders it: before the browser's own request could have
        // answered, the one number on the page that is ours is in the HTML a crawler indexes, in the
        // hero and with its count in words in the Overview's facts (ADR 0069). A badge that waited for
        // hydration, or for an effect to copy the loader's scores, would be missing from this.
        const html = renderToString(withLoaded(memberScores(23)));

        expect(html).toContain('Celeste');
        // The hero's badge and the facts', each in its tooltip and in its accessible name.
        expect(html.match(/Member score: 84 out of 100, from 23 scores/g)).toHaveLength(4);
        // React marks where the count was put into the sentence with an empty comment.
        expect(html).toMatch(/from (?:<!-- -->)?23(?:<!-- -->)? scores<\/span>/);
    });

    it("gives way to the browser's own answer, which is fresher", () => {
        scored(30, 9);
        render(withLoaded(memberScores(23)));

        expect(within(hero()).queryByText('Member score: 84 out of 100, from 23 scores')).not.toBeInTheDocument();
        expect(within(hero()).getByText('Member score: 90 out of 100, from 30 scores')).toBeInTheDocument();
    });

    it("keeps the loader's when the browser's own request failed", () => {
        // Settled with nothing: the loader's figure is older, but it is what the page already showed,
        // and taking it away would read as the score having gone.
        community.settled = true;
        render(withLoaded(memberScores(23)));

        expect(within(hero()).getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
    });

    it('is absent until enough members have scored the game', () => {
        // A mean over a handful of members is a handful of opinions presented as a verdict.
        scored(MIN_MEMBER_SCORES - 1);
        render(withLoaded(memberScores(MIN_MEMBER_SCORES - 1, 10)));

        expect(hero()).toBeInTheDocument();
        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
        expect(screen.queryByText('Member Score')).not.toBeInTheDocument();
    });

    it('is absent when neither the loader nor the browser has scores', () => {
        renderPage();

        expect(hero()).toBeInTheDocument();
        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
    });

    it("follows the game when a link goes to another, never keeping the last one's", async () => {
        // The page stays mounted from one game to the next, as it does when a similar game is
        // followed. The loader's data and the hook change together; neither may carry the last
        // game's score onto the next one's page.
        renderWithNextGame({ game: CELESTE, scores: memberScores(23) }, { game: game({ id: 2, title: 'Hades' }), scores: null });
        expect(within(hero()).getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole('link', { name: 'Next game' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Hades' })).toBeInTheDocument();
        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
    });
});

describe("GamePage facts' member score", () => {
    it('says how many scores it is from, in words, like the critic score above it', () => {
        render(withLoaded(memberScores(23)));

        const rail = within(facts());
        expect(rail.getByText('Member Score')).toBeInTheDocument();
        expect(rail.getByText('from 23 scores')).toBeInTheDocument();
        expect(rail.getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
    });
});

describe("GamePage facts", () => {
    it('lists what the game is and who made it as rows of the facts, not as sections of the column', () => {
        // They suit scanning, and six short sections of them pushed the reading column down (ADR 0084 §5).
        renderPage(game({
            id: 1,
            title: 'Celeste',
            genres: [{ id: 8, name: 'Platform', description: null }],
            platforms: [platform(6, 'PC (Microsoft Windows)', 'PC')],
            developers: [{ id: 1, name: 'Maddy Makes Games', country: null, foundedYear: null, website: null, logoUrl: null, description: null }],
            publishers: [{ id: 2, name: 'Matt Makes Games', country: null, foundedYear: null, website: null, logoUrl: null, description: null }],
            details: gameDetails({ themes: ['Action'], gameModes: ['Single player'] }),
        }));

        const rail = within(facts());
        for (const [label, value] of [
            ['Developer', 'Maddy Makes Games'],
            ['Publisher', 'Matt Makes Games'],
            ['Genres', 'Platform'],
            ['Themes', 'Action'],
            ['Platforms', 'PC (Microsoft Windows)'],
            ['How to play', 'Single player'],
        ]) {
            expect(rail.getByText(label), label).toBeInTheDocument();
            expect(rail.getByText(value), label).toBeInTheDocument();
            expect(screen.queryByRole('heading', { name: label }), label).not.toBeInTheDocument();
        }
    });
});

describe("GamePage members' section", () => {
    it('is handed the scores the hero shows', () => {
        // The browser's request answered for the reviews but not the scores: the section shows the
        // loader's, as the hero does, rather than disagreeing with the badge above it.
        community.settled = true;
        render(withLoaded(memberScores(23)));

        expect(screen.getByText("The section's 23 scores")).toBeInTheDocument();
    });

    it("is handed the browser's own answer once there is one", () => {
        community.settled = true;
        community.scores = memberScores(30);
        render(withLoaded(memberScores(23)));

        expect(screen.getByText("The section's 30 scores")).toBeInTheDocument();
    });
});

describe("GamePage reader's own writes", () => {
    it("asks for the members' figures again after the reader's entry writes", async () => {
        // The entry reports a saved score, review or deletion, and the page hands that to the hook's
        // reload — so the badge and the section show the write rather than reading as though it had
        // failed (ADR 0028 §6). Reading the score in the loader as well must not have cut that wire.
        authAnswered(userProfile());
        renderPage();

        await userEvent.setup().click(screen.getByRole('button', { name: 'Save my score' }));

        expect(community.reload).toHaveBeenCalledTimes(1);
    });
});

describe('GamePage trailer', () => {
    it('waits for its own press on the next game, after the last one played', async () => {
        const actor = userEvent.setup();
        const celeste = game({ id: 1, title: 'Celeste', trailerUrl: 'https://www.youtube.com/watch?v=celeste' });
        const hades = game({ id: 2, title: 'Hades', trailerUrl: 'https://www.youtube.com/watch?v=hades' });
        renderWithNextGame({ game: celeste }, { game: hades });

        await actor.click(screen.getByRole('button', { name: /Play trailer/ }));
        expect(screen.getByTitle('Celeste trailer')).toBeInTheDocument();

        await actor.click(screen.getByRole('link', { name: 'Next game' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Hades' })).toBeInTheDocument();
        expect(screen.queryByTitle('Hades trailer')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Play trailer/ })).toBeInTheDocument();
    });

    it('says that the trailer and the official site open in a new tab', () => {
        // A trailer YouTube cannot embed is a link out, as the official site is.
        renderPage(game({ id: 1, title: 'Celeste', trailerUrl: 'https://vimeo.com/celeste', website: 'https://www.celestegame.com' }));

        expect(screen.getByRole('link', { name: 'Watch Trailer (opens in a new tab)' })).toHaveAttribute('target', '_blank');
        expect(screen.getByRole('link', { name: 'Official Site (opens in a new tab)' })).toHaveAttribute('target', '_blank');
    });
});

/**
 * The rosette drawn on a cover. By its class, the one exception to querying by role: the mark is
 * deliberately outside the accessibility tree, and what it says is asserted through the words instead.
 */
const coverMarks = (root: HTMLElement) => root.querySelectorAll('.favourite-mark-cover');

describe('GamePage similar games and add-ons', () => {
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

describe("GamePage related games", () => {
    const related = (overrides: Partial<RelatedGameDto> & Pick<RelatedGameDto, 'id' | 'name'>): RelatedGameDto =>
        ({ coverImageUrl: null, releaseYear: null, kind: 'game', ...overrides });

    const SERIES: RelatedGamesDto = {
        anchorId: 1,
        games: [
            related({ id: 3, name: 'Celeste Classic', releaseYear: 2015 }),
            related({ id: 1, name: 'Celeste', releaseYear: 2018 }),
            related({ id: 5, name: 'Celeste 64', releaseYear: 2024 }),
        ],
        editions: [related({ id: 7, name: 'Celeste - Collector’s Edition', releaseYear: 2019, kind: 'edition' })],
    };

    const withRelated = (value: RelatedGamesDto | null | undefined) =>
        game({ id: 1, title: 'Celeste', details: gameDetails({ collections: ['Celeste'], related: value }) });

    it('opens the Overview with the series IGDB answered, in its order, this game marked and not linked', () => {
        favoured.add(5);
        renderPage(withRelated(SERIES));

        const rail = screen.getByRole('list', { name: 'The Celeste series' });
        expect(within(rail).getAllByRole('listitem')).toHaveLength(3);
        // The other two are links, the second in the reader's favourites; this game is where it falls.
        expect(within(rail).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
            ['Celeste Classic', '/games/3'],
            ['Celeste 64, one of your favourites', '/games/5'],
        ]);
        expect(within(rail).getByText('This game')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Collector’s Edition' })).toHaveAttribute('href', '/games/7');

        // First under the tabs, ahead of the reading column and the facts beside it.
        const tabs = screen.getByRole('navigation', { name: 'This game' });
        expect(tabs.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(rail.compareDocumentPosition(facts()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("opens the next game's series where its own opens, whatever was pressed on the last one", async () => {
        // The Overview stays mounted from one game to the next, so a rail that outlived its game would
        // carry what was pressed on it — the earlier games shown, or an "Add these to Backlog?" — onto
        // the next game's series.
        const longSeries = (anchorId: number, title: string): GameDto => {
            const games = Array.from({ length: 12 }, (_, index) =>
                related({ id: anchorId - 9 + index, name: `${title} ${index + 1}`, releaseYear: 2000 + index }));
            return game({ id: anchorId, title, details: gameDetails({ collections: [title], related: { anchorId, games, editions: [] } }) });
        };
        renderWithNextGame({ game: longSeries(1, 'Celeste') }, { game: longSeries(2, 'Hades') });

        // Nine games before this one, so the rail opens three before it, with six a press away.
        await userEvent.click(screen.getByRole('button', { name: '6 earlier games' }));
        expect(screen.queryByRole('button', { name: '6 earlier games' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('link', { name: 'Next game' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Hades' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '6 earlier games' })).toBeInTheDocument();
    });

    it('has no rail, and does not fail, when IGDB was not asked or the API is older than the rail', () => {
        // A null is IGDB failing, which the loader keeps off the edge; a missing one is a copy made by
        // the build before this one, which a client can still be handed for up to a day.
        for (const [what, value] of [['failed', null], ['missing', undefined]] as const) {
            const { unmount } = renderPage(withRelated(value));

            expect(screen.getByRole('heading', { level: 1, name: 'Celeste' }), what).toBeInTheDocument();
            expect(screen.queryByRole('list', { name: 'The Celeste series' }), what).not.toBeInTheDocument();
            unmount();
        }
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
        renderPage(game({
            id: 1,
            title: 'Celeste',
            coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co3byy.jpg',
        }));

        const cover = screen.getByRole('img', { name: 'Celeste cover' });
        expect(cover).not.toHaveAttribute('loading', 'lazy');
        expect(cover).not.toHaveAttribute('decoding', 'async');
        expect(cover.getAttribute('srcset')).toContain('/t_cover_small_2x/co3byy.jpg 180w');
        expect(cover).toHaveAttribute('sizes', '(min-width: 640px) 180px, 140px');
    });
});

describe('GamePage when there is no game to show', () => {
    afterEach(() => vi.unstubAllGlobals());

    /**
     * Answers the game request with each of these in turn, repeating the last. `'held'` is not answered
     * until the test calls the release it returns, which keeps a retry in flight. The members' figures
     * the loader asks for beside it are answered apart (`figuresFor`), so what this returns counts the
     * game's requests alone.
     */
    function stubGameApi(...answers: Array<number | 'unreachable' | 'held'>) {
        let call = 0;
        let release: (() => void) | null = null;
        const gameRequests = vi.fn(async () => {
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
        vi.stubGlobal('fetch', vi.fn(async (url: string) => figuresFor(url) ?? gameRequests()));
        return Object.assign(gameRequests, { release: () => release?.() });
    }

    /** The route as it runs: its own loader, and its own boundary for whatever the loader throws. */
    function renderRoute(path = '/games/1') {
        const Stub = createRoutesStub([gameRoute({ ErrorBoundary, loader: loader as unknown as LoaderFunction })]);
        return render(<Stub initialEntries={[path]} />);
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

    it('says the same at the Your game tab, whose page is the same game', async () => {
        stubGameApi(404);
        renderRoute('/games/1/yours');

        expect(await screen.findByRole('heading', { level: 1, name: 'There is no game at this address' })).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'This game' })).not.toBeInTheDocument();
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
        // With the members' figures beside the game and the related games in it, without either of
        // which the page is not shared (ADR 0069, ADR 0084).
        const whole = game({ id: 1, title: 'Celeste', details: gameDetails({ related: { anchorId: 1, games: [], editions: [] } }) });
        vi.stubGlobal('fetch', vi.fn(async (url: string) =>
            figuresFor(url) ?? new Response(JSON.stringify(whole), { status: 200 })));

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

    it("goes out under the Overview with the game page's own policy, and fails closed without one", () => {
        // The Overview states its own, which is the game page's handed on (ADR 0013, ADR 0084).
        const overviewPolicyOf = (init: { parentHeaders?: HeadersInit; errorHeaders?: HeadersInit }) => overviewHeaders({
            loaderHeaders: new Headers(),
            parentHeaders: new Headers(init.parentHeaders),
            actionHeaders: new Headers(),
            errorHeaders: init.errorHeaders === undefined ? undefined : new Headers(init.errorHeaders),
        } as unknown as Parameters<typeof overviewHeaders>[0])['Cache-Control'];

        expect(overviewPolicyOf({ parentHeaders: { 'Cache-Control': CACHE_GAME } })).toBe(CACHE_GAME);
        expect(overviewPolicyOf({ parentHeaders: { 'Cache-Control': PRIVATE_NO_STORE } })).toBe(PRIVATE_NO_STORE);
        expect(overviewPolicyOf({ errorHeaders: { 'Cache-Control': CACHE_NOT_FOUND } })).toBe(CACHE_NOT_FOUND);
        expect(overviewPolicyOf({})).toBe(PRIVATE_NO_STORE);
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

    it("names the year it came out in its title, a game out on New Year's Day included", () => {
        // `meta` runs in the browser as well as on the server, and `new Date('2017-01-01')` is the
        // last day of 2016 west of Greenwich: the title changed when the page hydrated. The suite
        // runs west of Greenwich, so the slip would show here.
        expect(tagsFor({ releaseDate: '2017-01-01' }).find(tag => tag.title)?.title)
            .toBe('Celeste (2017) - MyVideoGameList');
        expect(tagsFor({ releaseDate: null }).find(tag => tag.title)?.title).toBe('Celeste - MyVideoGameList');
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

    it("shares the site's default image when IGDB has neither", () => {
        const tags = tagsFor({ backgroundImageUrl: null, coverImageUrl: null });

        expect(content(tags, 'og:image')).toMatch(/^https:\/\/myvideogamelist\.net\/.*share.*\.png(\?.*)?$/);
        expect(content(tags, 'twitter:card')).toBe('summary_large_image');
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

describe('GamePage meta, from what members have recorded', () => {
    const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };
    const WITCHER = game({
        id: 1942,
        title: 'The Witcher 3: Wild Hunt',
        description: 'You are Geralt of Rivia, a monster slayer for hire. The war rages on.',
        releaseDate: '2015-05-19',
    });

    type Tag = MetaDescriptor & Partial<Record<'name' | 'property' | 'content', string>>;

    const tagsFor = (loaderData: Record<string, unknown>) =>
        meta({ loaderData: { game: WITCHER, site: SITE, ...loaderData } } as unknown as Route.MetaArgs) as Tag[];

    const content = (tags: Tag[], key: string) =>
        tags.find(tag => tag.property === key || tag.name === key)?.content;

    /** The page's `VideoGame` as `<Meta>` would write it, through JSON. */
    const videoGame = (tags: Tag[]) => tags
        .filter((tag): tag is Tag & { 'script:ld+json': Record<string, unknown> } => 'script:ld+json' in tag)
        .map(tag => JSON.parse(JSON.stringify(tag['script:ld+json'])) as Record<string, unknown>)
        .find(block => block['@type'] === 'VideoGame');

    it('leads the description with what members have recorded, and shares the same words', () => {
        const tags = tagsFor({ scores: memberScores(9, 8.44), times: null, today: '2026-10-17' });

        const description = content(tags, 'description');
        expect(description).toBe('Tracked by 9 members. Member score 84/100 from 9 scores. You are Geralt of Rivia, a monster slayer for hire.');
        expect(content(tags, 'og:description')).toBe(description);
    });

    it('leads with the members’ time too, when the times came', () => {
        const tags = tagsFor({
            scores: null,
            times: communityTimes({ normally: { samples: MIN_PLAYTHROUGH_SAMPLES, medianMinutes: 52 * 60 } }),
            today: '2026-10-17',
        });

        expect(content(tags, 'description'))
            .toBe('Members normally beat it in 52h (median of 3 playthroughs). You are Geralt of Rivia, a monster slayer for hire.');
    });

    it('rates the game in its structured data by its members only, once enough have scored it', () => {
        const rated = videoGame(tagsFor({ scores: memberScores(MIN_MEMBER_SCORES), times: null, today: '2026-10-17' }));
        const under = videoGame(tagsFor({ scores: memberScores(MIN_MEMBER_SCORES - 1), times: null, today: '2026-10-17' }));

        expect(rated?.aggregateRating).toMatchObject({ ratingValue: 84, ratingCount: MIN_MEMBER_SCORES, bestRating: 100 });
        expect(under).toBeDefined();
        expect(under).not.toHaveProperty('aggregateRating');
    });

    it('names the page by its canonical address, and dates the game by the day the loader ran', () => {
        const tags = tagsFor({ scores: null, times: null, today: '2026-10-17' });

        const canonical = (tags as Array<Tag & { rel?: string; href?: string }>).find(tag => tag.rel === 'canonical')?.href;
        expect(canonical).toBe('https://myvideogamelist.net/games/1942');
        expect(videoGame(tags)).toMatchObject({ url: canonical, datePublished: '2015-05-19' });
        // Before the day, there is no date to publish.
        expect(videoGame(tagsFor({ scores: null, times: null, today: '2015-05-18' }))).not.toHaveProperty('datePublished');
    });

    it('still describes a game from data written before this build, which had no figures of ours', () => {
        // A game page's data is shared-cached, so in a deploy's first minutes a copy without scores,
        // times or the day can reach the browser's `meta`.
        const tags = tagsFor({});

        expect(content(tags, 'description')).toBe('You are Geralt of Rivia, a monster slayer for hire.');
        expect(videoGame(tags)).toMatchObject({ '@type': 'VideoGame', name: 'The Witcher 3: Wild Hunt' });
        expect(videoGame(tags)).not.toHaveProperty('aggregateRating');
        expect(videoGame(tags)).not.toHaveProperty('datePublished');
    });
});
