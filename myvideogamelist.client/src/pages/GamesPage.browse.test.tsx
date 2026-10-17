import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import { createRoutesStub, Outlet, useLocation, useNavigate, useNavigation } from 'react-router';
import { GamesPage, loader } from '@/pages/GamesPage';
import { MIN_CRITIC_REVIEWS } from '@/lib/score';
import type { GameDto, GenreDto, PagedGamesResponse, PlatformDto } from '@/types/game';
import { quickActor } from '@/test/actor';
import { game, platform, userProfile } from '@/test/factories';
import { AppProviders } from '@/test/providers';
import {
    type ApiAnswer,
    type ApiCall,
    type ApiRoutes,
    empty,
    expectSentThroughApiFetch,
    held,
    json,
    settle,
    signedInRoutes,
    stubApi,
    tearDownApi,
} from '@/test/api';

/**
 * The browse page as a reader drives it: the real loader behind a router, the real providers around
 * it, and the API played by the test. Everything the page shows is read from its URL (ADR 0032), so
 * these tests read the address, and the requests the page made, as well as the screen. The loader on
 * its own is `GamesPage.loader.test.ts`.
 *
 * The parameters are the six the page has; a filter added later adds its own steps here. Nothing
 * counts the controls, so one added beside them changes nothing.
 */

const PLATFORMS: PlatformDto[] = [platform(6, 'PC (Windows)', 'PC'), platform(130, 'Nintendo Switch', 'Switch')];
const GENRES: GenreDto[] = [
    { id: 31, name: 'Adventure', description: null },
    { id: 12, name: 'Role-playing (RPG)', description: null },
];

/** A year the select offers whatever year the suite runs in. */
const YEAR = 2001;

/** The API's page size, which is where the next page starts. */
const PAGE_SIZE = 20;

const page = (items: GameDto[], hasMore = false): PagedGamesResponse => ({ items, hasMore });

/** `count` games with ids from `from`, titled by their id so a test can name one. */
function games(count: number, from = 1): GameDto[] {
    return Array.from({ length: count }, (_, i) => game({ id: from + i, title: `Game ${from + i}` }));
}

/**
 * The address bar and the back button, around the page, and whether a navigation is out. The page
 * owns none of them, and the first two are part of what it promises: a filter is a step somebody can
 * go back from, and typing a search is not.
 */
function Browser() {
    const location = useLocation();
    const navigate = useNavigate();
    const navigation = useNavigation();
    return (
        <>
            <p>{`Address: ${location.pathname}${location.search}`}</p>
            <p>{navigation.location ? `Loading ${navigation.location.pathname}` : 'No page is loading'}</p>
            <button type="button" onClick={() => void navigate(-1)}>Back</button>
            <Outlet />
        </>
    );
}

/** What the address bar says. */
const address = () => screen.getByText(/^Address: /).textContent?.replace('Address: ', '');

/** The order and the filters, which an empty listing's own Clear filters sits outside. */
const controls = () => within(screen.getByRole('group', { name: 'Sort and filter games' }));

/** A query string's parameters in a fixed order, for comparing two that may list them differently. */
const sorted = (query: string) => [...new URLSearchParams(query)].sort(([a], [b]) => a.localeCompare(b));

/** The address's parameters, sorted. */
const addressParams = () => sorted(address()?.split('?')[1] ?? '');

/**
 * A game's card. GameCard is the article around its title's link, and nothing else on the page names
 * it, so the card is found from the link rather than by a name of its own.
 */
const card = (title: string) => within(screen.getByRole('link', { name: title }).closest('article')!);

/**
 * The browse page at `url`, after a home page so there is somewhere to go back to, once its first
 * page has loaded. `url` can be a history of several, the last of them open. `gamesAnswer` answers
 * every `GET /api/games` — the loader's first page and every page the page fetches after it.
 */
async function openBrowse(
    url: string | string[],
    gamesAnswer: (call: ApiCall) => ApiAnswer = () => json(page([])),
    routes: ApiRoutes = {},
) {
    const api = stubApi({
        'GET /api/auth/me': () => empty(401),
        'GET /api/genres': () => json(GENRES),
        'GET /api/platforms/active': () => json(PLATFORMS),
        ...routes,
        'GET /api/games': gamesAnswer,
    });

    const gamePage = held();
    const Stub = createRoutesStub([{
        id: 'browser',
        Component: Browser,
        children: [
            { id: 'home', path: '/', Component: () => <h1>Home</h1> },
            { id: 'games', path: '/games', Component: GamesPage, loader, HydrateFallback: () => null },
            // Held open, so that leaving for a game page can be watched mid-navigation.
            { id: 'game', path: '/games/:id', Component: () => <h1>A game</h1>, loader: () => gamePage.answer },
        ],
    }]);

    render(<AppProviders><Stub initialEntries={['/', ...[url].flat()]} /></AppProviders>);
    await screen.findByRole('heading', { name: 'Games' });

    return {
        api,
        /**
         * Every query `/api/games` was sent, in order: the loader's for each first page, and the
         * page's own for each page after one.
         */
        gamesRequests: () => api.callsTo('GET', '/api/games').map(call => call.query.toString()),
    };
}

/** The query `/api/games` is sent for a browse and an offset, built the way `gamesApiPath` builds it. */
const asked = (query: string, offset = 0) => {
    const params = new URLSearchParams(query);
    params.set('offset', String(offset));
    return params.toString();
};

/**
 * The reader's viewport, which jsdom does not lay out, so the observer behind the infinite scroll is
 * played here. The reader is at the foot of the list from `scrollToEnd()` until the list grows past
 * what was on screen then — more games are what push the sentinel back out of view in a browser.
 *
 * Like a browser's, an observer reports what it sees as soon as it starts observing, so one the page
 * creates while the sentinel is in view acts on it at once.
 */
const viewport = {
    /** How many games were listed when the reader reached the end, or null before they have. */
    reachedEndAt: null as number | null,
    observers: new Set<SentinelObserver>(),
};

/** How many games the page lists — counted as layout would see them, so not through a role query. */
const listed = () => document.querySelectorAll('article').length;

class SentinelObserver {
    private readonly targets = new Set<Element>();

    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(target: Element) {
        this.targets.add(target);
        viewport.observers.add(this);
        this.report();
    }

    unobserve(target: Element) {
        this.targets.delete(target);
    }

    disconnect() {
        this.targets.clear();
        viewport.observers.delete(this);
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    report() {
        const isIntersecting = viewport.reachedEndAt !== null && listed() <= viewport.reachedEndAt;
        const entries = [...this.targets].map(target => ({ target, isIntersecting }) as IntersectionObserverEntry);
        if (entries.length > 0) this.callback(entries, this as unknown as IntersectionObserver);
    }
}

/** The reader scrolls to the foot of the list. */
async function scrollToEnd() {
    await act(async () => {
        viewport.reachedEndAt = listed();
        for (const observer of viewport.observers) observer.report();
    });
}

/**
 * The reader scrolls back up, as they have to before choosing a filter: the controls are at the top
 * of the page. Left at the foot, a shorter listing would put the sentinel in view at once.
 */
function scrollToTop() {
    viewport.reachedEndAt = null;
}

beforeEach(() => {
    viewport.reachedEndAt = null;
    viewport.observers.clear();
    vi.stubGlobal('IntersectionObserver', SentinelObserver);
});

afterEach(() => {
    tearDownApi();
    vi.useRealTimers();
});

describe('GamesPage browse URL', () => {
    it('asks the API for what the address says, and shows it in every control', async () => {
        const { gamesRequests } = await openBrowse(`/games?sort=newest&platform=130&genre=12&year=${YEAR}&minScore=80`);

        expect(gamesRequests()).toEqual([asked(`sort=newest&platform=130&genre=12&year=${YEAR}&minScore=80`)]);
        expect(screen.getByLabelText('Order')).toHaveValue('newest');
        expect(screen.getByLabelText('Platform')).toHaveValue('130');
        expect(screen.getByLabelText('Genre')).toHaveValue('12');
        expect(screen.getByLabelText('Released')).toHaveValue(String(YEAR));
        expect(screen.getByLabelText('Critic score')).toHaveValue('80');
    });

    it('carries a search to the API with the filters beside it, and puts it in the box', async () => {
        const { gamesRequests } = await openBrowse(`/games?search=zelda&platform=6&year=${YEAR}`);

        expect(gamesRequests()).toEqual([asked(`search=zelda&platform=6&year=${YEAR}`)]);
        expect(screen.getByRole('searchbox', { name: 'Search games' })).toHaveValue('zelda');
        expect(screen.getByLabelText('Platform')).toHaveValue('6');
    });

    it("writes each control's choice into the address, and asks the API for exactly that", async () => {
        const actor = quickActor();
        const { gamesRequests } = await openBrowse('/games');

        const steps: [label: string, option: string, query: string][] = [
            ['Order', 'Popular', 'sort=popular'],
            ['Platform', 'Nintendo Switch', 'sort=popular&platform=130'],
            ['Genre', 'Role-playing (RPG)', 'sort=popular&platform=130&genre=12'],
            ['Released', String(YEAR), `sort=popular&platform=130&genre=12&year=${YEAR}`],
            ['Critic score', '80 and above', `sort=popular&platform=130&genre=12&year=${YEAR}&minScore=80`],
            ['Released', 'Any year', 'sort=popular&platform=130&genre=12&minScore=80'],
        ];

        for (const [label, option, query] of steps) {
            await actor.selectOptions(screen.getByLabelText(label), option);
            await waitFor(() => expect(address()).toBe(`/games?${query}`));
            expect(gamesRequests().at(-1), `${label}: ${option}`).toBe(asked(query));
        }
    });

    it('leaves the default order out of the address, so the plain catalogue has one', async () => {
        const actor = quickActor();
        const { gamesRequests } = await openBrowse('/games?sort=newest');

        await actor.selectOptions(screen.getByLabelText('Order'), 'Top rated');

        await waitFor(() => expect(address()).toBe('/games'));
        expect(gamesRequests().at(-1)).toBe(asked(''));
    });

    it('drops what it cannot use before the API is asked, and shows the plain catalogue', async () => {
        // A stale or hand-edited link still shows games; the API, which would answer a 400, never
        // sees the bad values.
        const { gamesRequests } = await openBrowse('/games?sort=bogus&platform=abc&genre=0&year=1900&minScore=101');

        expect(gamesRequests()).toEqual([asked('')]);
        expect(screen.getByLabelText('Order')).toHaveValue('rating');
        expect(screen.getByLabelText('Platform')).toHaveValue('');
    });

    it('clears the filters and keeps the order and the search, which are not filters', async () => {
        const actor = quickActor();
        const { gamesRequests } = await openBrowse(`/games?search=zelda&sort=newest&platform=6&genre=12&year=${YEAR}&minScore=80`);

        await actor.click(controls().getByRole('button', { name: 'Clear filters' }));

        await waitFor(() => expect(address()).toBe('/games?search=zelda&sort=newest'));
        expect(gamesRequests().at(-1)).toBe(asked('search=zelda&sort=newest'));
    });

    it('makes each filter a step the reader can go back from', async () => {
        const actor = quickActor();
        await openBrowse('/games');

        await actor.selectOptions(screen.getByLabelText('Platform'), 'PC (Windows)');
        await waitFor(() => expect(address()).toBe('/games?platform=6'));
        await actor.selectOptions(screen.getByLabelText('Genre'), 'Adventure');
        await waitFor(() => expect(address()).toBe('/games?platform=6&genre=31'));

        await actor.click(screen.getByRole('button', { name: 'Back' }));

        await waitFor(() => expect(address()).toBe('/games?platform=6'));
        expect(screen.getByLabelText('Genre')).toHaveValue('');
    });
});

describe('GamesPage search box', () => {
    /*
     * The debounce runs on a fake clock, and only the timeout is faked. Nothing that waits on a
     * timeout of its own may run while it is: Testing Library's `waitFor` and every user-event call
     * finish on a zero-millisecond timeout, which a held clock never reaches. So on it, typing is a
     * change event per character — what the page reads — and a navigation is waited for by
     * `settle`, which lets promises run and time stand still.
     */
    const holdTheClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // A slip would otherwise show as a five-second timeout with nothing to say why.
    let restoreAsyncWrapper: () => void = () => {};
    beforeEach(() => {
        const { asyncWrapper } = getConfig();
        configure({
            asyncWrapper: callback => {
                if (vi.isFakeTimers()) {
                    throw new Error('waitFor, findBy and user-event wait on a timeout the held clock never reaches. Use settle(), or let the clock go first.');
                }
                return asyncWrapper(callback);
            },
        });
        restoreAsyncWrapper = () => configure({ asyncWrapper });
    });
    afterEach(() => restoreAsyncWrapper());

    const searchBox = () => screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search games' });

    /** Types into the search box a character at a time. */
    function typeInto(text: string) {
        for (const character of text) {
            fireEvent.change(searchBox(), { target: { value: searchBox().value + character } });
        }
    }

    /** The pause after typing: the debounce runs out, however long it is. */
    async function pauseTyping() {
        await act(() => vi.runOnlyPendingTimersAsync());
        await settle();
    }

    it('puts a search in the address once typing pauses, replacing the step rather than adding one', async () => {
        const { gamesRequests } = await openBrowse('/games');
        holdTheClock();

        typeInto('zelda');
        await settle();

        // Nothing until the pause: a request per keystroke is a loader run per keystroke.
        expect(address()).toBe('/games');
        expect(gamesRequests()).toEqual([asked('')]);

        await pauseTyping();

        expect(address()).toBe('/games?search=zelda');
        expect(gamesRequests()).toEqual([asked(''), asked('search=zelda')]);

        // Typing replaced the entry, so the step back leaves the page rather than untyping it.
        vi.useRealTimers();
        await quickActor().click(screen.getByRole('button', { name: 'Back' }));
        expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    });

    it('keeps the filters when a search is typed over them', async () => {
        // A search keeps the filters (ADR 0032). The order it sets aside is the API's to drop, and
        // the order control's to show as Best match; below.
        const { gamesRequests } = await openBrowse(`/games?platform=6&year=${YEAR}`);
        holdTheClock();

        typeInto('zelda');
        await pauseTyping();

        expect(addressParams()).toEqual(sorted(`platform=6&year=${YEAR}&search=zelda`));
        expect(gamesRequests().at(-1)).toBe(asked(`search=zelda&platform=6&year=${YEAR}`));
        expect(screen.getByLabelText('Platform')).toHaveValue('6');
    });

    it('takes the term typed so far with a filter chosen before the pause, in one request', async () => {
        const { gamesRequests } = await openBrowse('/games');
        holdTheClock();

        typeInto('zel');
        fireEvent.change(screen.getByLabelText('Platform'), { target: { value: '6' } });
        await settle();

        expect(address()).toBe('/games?search=zel&platform=6');

        // The debounce finds the term already on its way, and does not send it a second time — which
        // would also have gone out without the platform.
        await pauseTyping();
        expect(address()).toBe('/games?search=zel&platform=6');
        expect(gamesRequests()).toEqual([asked(''), asked('search=zel&platform=6')]);
    });

    // #285: the debounce builds its URL from the page that landed, not the one on its way.
    it.skip('keeps a filter whose page is still loading when a search is typed after it (#285)', async () => {
        // Fixed, both navigations carry the platform and both loaders get this answer, so each takes
        // a copy: a response's body can be read once.
        const platformPage = held();
        await openBrowse('/games', call => call.query.has('platform')
            ? platformPage.answer.then(response => response.clone())
            : json(page([])));
        holdTheClock();

        fireEvent.change(screen.getByLabelText('Platform'), { target: { value: '6' } });
        typeInto('zelda');
        await pauseTyping();
        await act(async () => platformPage.release(json(page([]))));
        await settle();

        expect(addressParams()).toEqual(sorted('platform=6&search=zelda'));
    });

    it('takes the search out of the address when the box is emptied, and keeps the filters', async () => {
        await openBrowse('/games?search=zelda&platform=6');
        holdTheClock();

        fireEvent.change(searchBox(), { target: { value: '' } });
        await pauseTyping();

        expect(address()).toBe('/games?platform=6');
    });

    it('keeps what is still being typed when the search before it lands late', async () => {
        // The page for "zel" arrives after "da" was added. Taken for a search from elsewhere, it
        // would put "zel" back in the box under the reader's fingers.
        const zel = held();
        const { gamesRequests } = await openBrowse('/games', call =>
            call.query.get('search') === 'zel' ? zel.answer : json(page([])));
        holdTheClock();

        typeInto('zel');
        await pauseTyping();
        typeInto('da');
        await act(async () => zel.release(json(page([]))));
        await settle();

        expect(address()).toBe('/games?search=zel');
        expect(searchBox()).toHaveValue('zelda');

        await pauseTyping();

        expect(address()).toBe('/games?search=zelda');
        expect(gamesRequests()).toEqual([asked(''), asked('search=zel'), asked('search=zelda')]);
    });

    it('puts a search the reader went back to in the box', async () => {
        const actor = quickActor();
        await openBrowse(['/games?search=mario', '/games?search=zelda']);
        expect(searchBox()).toHaveValue('zelda');

        await actor.click(screen.getByRole('button', { name: 'Back' }));

        await waitFor(() => expect(searchBox()).toHaveValue('mario'));
    });
});

describe('GamesPage orders and their floors', () => {
    it('says under the order what each order lists', async () => {
        // Every order lists only games over a floor of its own (ADR 0032 §4), and a floor the reader
        // cannot see makes the catalogue look smaller than it is. Popular's line describes its
        // ranking rather than its floor of ten ratings, which the top of that ranking never nears.
        const actor = quickActor();
        await openBrowse('/games');
        const order = () => screen.getByLabelText('Order');

        expect(order()).toHaveAccessibleDescription(/at least eight critic reviews/i);

        // Each line read once its order's page has landed, and each pattern one only its own line
        // matches, so no step can pass on the line of the order before it.
        const lines: [option: string, sort: string, line: RegExp][] = [
            ['Popular', 'popular', /^Most ratings on IGDB/],
            ['Newest', 'newest', /^Released games that have drawn some ratings and a critic review/],
            ['A to Z', 'name', /some ratings and a critic review, by title/],
        ];
        for (const [option, sort, line] of lines) {
            await actor.selectOptions(order(), option);
            await waitFor(() => expect(address()).toBe(`/games?sort=${sort}`));
            expect(order(), option).toHaveAccessibleDescription(line);
        }
    });

    it('drops the order while searching, says so, and keeps the filters on', async () => {
        // IGDB orders a search itself, and answers one that asks for an order with a 406.
        await openBrowse('/games?search=zelda&sort=newest&platform=6');

        const order = screen.getByLabelText('Order');
        expect(order).toBeDisabled();
        expect(order).toHaveDisplayValue('Best match');
        expect(order).toHaveAccessibleDescription(/how well they match\. The filters still apply/i);
        expect(screen.getByLabelText('Platform')).toBeEnabled();
    });

    it('explains an empty Top rated listing by its floor, and points to the orders that reach further', async () => {
        // Top rated filtered to a recent year is empty by construction, since recent games rarely
        // have eight critic reviews — the one empty page the reader cannot explain from what they
        // chose. The API answers nothing here; which filter left it empty does not matter.
        await openBrowse(`/games?year=${YEAR}`);

        expect(screen.getByText('No games match these filters.')).toBeInTheDocument();
        expect(screen.getByText(/only ranks games with at least eight critic reviews/i)).toBeInTheDocument();
        expect(screen.getByText(/popular or newest reach further/i)).toBeInTheDocument();
    });

    it("does not blame Top rated's floor for an empty listing in another order", async () => {
        await openBrowse(`/games?sort=popular&year=${YEAR}`);

        expect(screen.getByText('No games match these filters.')).toBeInTheDocument();
        expect(screen.queryByText(/only ranks games/i)).not.toBeInTheDocument();
    });

    it("does not blame Top rated's floor for an empty search, which has no floor", async () => {
        await openBrowse(`/games?search=qwertyuiop&year=${YEAR}`);

        expect(screen.getByText('No games match your search.')).toBeInTheDocument();
        expect(screen.queryByText(/only ranks games/i)).not.toBeInTheDocument();
    });
});

describe('GamesPage listings', () => {
    it('lists what the API answered, each game linked to its page, with no list controls for a visitor', async () => {
        // Every first render is a signed-out one: the page is cached at the edge for everybody.
        await openBrowse('/games', () => json(page(games(3))));

        expect(screen.getAllByRole('article')).toHaveLength(3);
        expect(screen.getByRole('link', { name: 'Game 2' })).toHaveAttribute('href', '/games/2');
        expect(screen.getByText('3 games loaded')).toBeInTheDocument();
        expect(card('Game 2').queryByRole('button', { name: 'Backlog' })).not.toBeInTheDocument();
    });

    it('says the catalogue is empty, with nothing to clear', async () => {
        await openBrowse('/games');

        expect(screen.getByText('No games found.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
        expect(screen.getByText('0 games loaded')).toBeInTheDocument();
    });

    it('offers to clear the filters that left nothing, from the empty page itself, keeping the order', async () => {
        const actor = quickActor();
        await openBrowse('/games?sort=newest&platform=6');
        expect(screen.getByText('No games match these filters.')).toBeInTheDocument();

        // The Clear filters that is not among the controls is the empty page's.
        const group = screen.getByRole('group', { name: 'Sort and filter games' });
        const onTheEmptyPage = screen.getAllByRole('button', { name: 'Clear filters' })
            .find(button => !group.contains(button));
        await actor.click(onTheEmptyPage!);

        await waitFor(() => expect(address()).toBe('/games?sort=newest'));
    });

    it('leaves out of the page a filter whose options could not be loaded', async () => {
        await openBrowse('/games', () => json(page([])), { 'GET /api/genres': () => empty(503) });

        expect(screen.queryByLabelText('Genre')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Platform')).toBeInTheDocument();
    });
});

describe('GamesPage critic badges', () => {
    it('shows a critic score only once enough critics are behind it', async () => {
        // IGDB averages with no floor, so one perfect review would otherwise sit on the cover as a
        // green 100 (ADR 0016).
        await openBrowse('/games', () => json(page([
            game({ id: 1, title: 'Thin', criticScore: 100, criticScoreCount: MIN_CRITIC_REVIEWS - 1 }),
            game({ id: 2, title: 'Backed', criticScore: 88, criticScoreCount: MIN_CRITIC_REVIEWS }),
            game({ id: 3, title: 'Uncounted', criticScore: 95, criticScoreCount: null }),
        ])));

        expect(card('Backed').getByText(`Critic score: 88 out of 100, from ${MIN_CRITIC_REVIEWS} reviews`)).toBeInTheDocument();
        expect(card('Thin').queryByText(/^Critic score/)).not.toBeInTheDocument();
        expect(card('Uncounted').queryByText(/^Critic score/)).not.toBeInTheDocument();
    });

    it('shows a player rating out of 100, with how many ratings it averages', async () => {
        await openBrowse('/games', () => json(page([game({ id: 1, title: 'Rated', rating: 8.24, ratingCount: 1234 })])));

        expect(card('Rated').getByText('Player rating: 82 out of 100, from 1,234 ratings')).toBeInTheDocument();
    });
});

describe('GamesPage pagination', () => {
    /** A full first page with more to come, and `next` for every page after it. */
    const pages = (next: (call: ApiCall) => ApiAnswer) => (call: ApiCall) =>
        call.query.get('offset') === '0' ? json(page(games(PAGE_SIZE), true)) : next(call);

    it('asks for the next page of the same browse when the end of the list comes into view', async () => {
        const { gamesRequests } = await openBrowse('/games?platform=6',
            pages(() => json(page(games(PAGE_SIZE, PAGE_SIZE + 1), true))));
        expect(screen.getByText(`${PAGE_SIZE} games loaded so far`)).toBeInTheDocument();

        await scrollToEnd();

        expect(await screen.findByText(`Game ${PAGE_SIZE * 2}`)).toBeInTheDocument();
        expect(screen.getAllByRole('article')).toHaveLength(PAGE_SIZE * 2);
        expect(gamesRequests()).toEqual([asked('platform=6'), asked('platform=6', PAGE_SIZE)]);
        expect(screen.getByText(`${PAGE_SIZE * 2} games loaded so far`)).toBeInTheDocument();
    });

    it('shows a game once when two pages both return it', async () => {
        // An order with ties can hand the same game back on neighbouring pages (ADR 0032).
        await openBrowse('/games', pages(() => json(page([...games(1, PAGE_SIZE), ...games(1, PAGE_SIZE + 1)]))));

        await scrollToEnd();

        await screen.findByText(`Game ${PAGE_SIZE + 1}`);
        expect(screen.getAllByText(`Game ${PAGE_SIZE}`)).toHaveLength(1);
        expect(screen.getAllByRole('article')).toHaveLength(PAGE_SIZE + 1);
    });

    it('stops asking once the API says there is no more', async () => {
        const { gamesRequests } = await openBrowse('/games', pages(() => json(page(games(5, PAGE_SIZE + 1)))));

        await scrollToEnd();
        await screen.findByText(`${PAGE_SIZE + 5} games loaded`);
        await scrollToEnd();

        expect(gamesRequests()).toHaveLength(2);
    });

    it('asks once while a page is on its way, and says it is coming', async () => {
        const next = held();
        const { gamesRequests } = await openBrowse('/games', pages(() => next.answer));

        await scrollToEnd();
        await scrollToEnd();

        expect(screen.getByText('Loading more games…')).toBeInTheDocument();
        expect(gamesRequests()).toHaveLength(2);

        await act(async () => next.release(json(page(games(5, PAGE_SIZE + 1)))));
        await screen.findByText(`${PAGE_SIZE + 5} games loaded`);
        expect(screen.queryByText('Loading more games…')).not.toBeInTheDocument();
    });

    it('drops a page of the previous browse that arrives after a filter changed', async () => {
        const actor = quickActor();
        const late = held();
        await openBrowse('/games', call => {
            if (call.query.get('platform') === '6') return json(page(games(2, 500)));
            return call.query.get('offset') === '0' ? json(page(games(PAGE_SIZE), true)) : late.answer;
        });

        await scrollToEnd();
        scrollToTop();
        await actor.selectOptions(screen.getByLabelText('Platform'), 'PC (Windows)');
        await screen.findByText('Game 500');
        // The new browse's effects have run, which is what cancels the page still out (see #333).
        await settle();

        await act(async () => late.release(json(page(games(PAGE_SIZE, PAGE_SIZE + 1), true))));

        expect(screen.getAllByRole('article')).toHaveLength(2);
        expect(screen.queryByText(`Game ${PAGE_SIZE + 1}`)).not.toBeInTheDocument();
    });

    // #333: the page still out is cancelled from an effect, which runs only after the commit.
    it.skip('drops a page of the previous browse that lands as the next one renders (#333)', async () => {
        // The page still out is cancelled from an effect, which runs after the commit, so for that
        // moment it can still land, and be added to the new listing.
        const actor = quickActor();
        const late = held();
        await openBrowse('/games', call => {
            if (call.query.get('platform') === '6') return json(page(games(2, 500)));
            return call.query.get('offset') === '0' ? json(page(games(PAGE_SIZE), true)) : late.answer;
        });
        await scrollToEnd();
        scrollToTop();

        // Released the moment the new listing is in the document, before React has run its effects.
        const watcher = new MutationObserver(() => {
            if (document.body.textContent?.includes('Game 500')) {
                watcher.disconnect();
                late.release(json(page(games(PAGE_SIZE, PAGE_SIZE + 1), true)));
            }
        });
        watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
        await actor.selectOptions(screen.getByLabelText('Platform'), 'PC (Windows)');
        await screen.findByText('Game 500');
        await settle();

        expect(screen.getAllByRole('article')).toHaveLength(2);
    });

    it("starts a new browse's paging at its second page, not where the last one stopped", async () => {
        const actor = quickActor();
        const { gamesRequests } = await openBrowse('/games', call =>
            json(page(games(PAGE_SIZE, Number(call.query.get('offset')) + (call.query.has('genre') ? 1000 : 1)), true)));

        await scrollToEnd();
        await screen.findByText(`Game ${PAGE_SIZE * 2}`);
        scrollToTop();
        await actor.selectOptions(screen.getByLabelText('Genre'), 'Adventure');
        await screen.findByText('Game 1000');
        await settle();
        expect(screen.getAllByRole('article')).toHaveLength(PAGE_SIZE);

        await scrollToEnd();

        await waitFor(() => expect(gamesRequests().at(-1)).toBe(asked('genre=31', PAGE_SIZE)));
    });

    /**
     * The second page fails, and anything asked for after it is held open — so a page that asks
     * again stops at one more request rather than looping for the rest of the test.
     */
    const secondPageFails = () => {
        const answers = [empty(500)];
        return pages(() => answers.shift() ?? held().answer);
    };

    // #313: a failed page sets the error the whole listing renders from, and the grid goes with it.
    it.skip('keeps the games it has when the next page fails (#313)', async () => {
        // What is listed already is perfectly good; only the page after it failed.
        const { gamesRequests } = await openBrowse('/games', secondPageFails());

        await scrollToEnd();
        await settle();

        expect(gamesRequests()).toContain(asked('', PAGE_SIZE));
        expect(screen.getAllByRole('article')).toHaveLength(PAGE_SIZE);
    });

    // #313: the observer the page starts after a failure sees the sentinel and asks again, and again.
    it.skip('does not ask again on its own for a page that failed (#313)', async () => {
        // The reader is still at the foot of the list, so every observer the page starts sees the
        // sentinel in view. Asking again from there asks a failing API as fast as it can answer.
        const { gamesRequests } = await openBrowse('/games', secondPageFails());

        await scrollToEnd();
        await settle();

        expect(gamesRequests().filter(query => query === asked('', PAGE_SIZE))).toHaveLength(1);
    });
});

describe('GamesPage while a listing loads', () => {
    it('gives the list over to a spinner while another browse loads', async () => {
        const actor = quickActor();
        const next = held();
        await openBrowse('/games', call => call.query.has('platform') ? next.answer : json(page(games(3))));

        await actor.selectOptions(screen.getByLabelText('Platform'), 'PC (Windows)');

        expect(await screen.findByText('Loading games…')).toBeInTheDocument();
        expect(screen.queryAllByRole('article')).toHaveLength(0);
        expect(screen.getByText('Loading…')).toBeInTheDocument();

        await act(async () => next.release(json(page(games(1, 50)))));
        expect(await screen.findByText('Game 50')).toBeInTheDocument();
    });

    // #285: the selects render the browse that landed, so a choice snaps back until its page does.
    it.skip('shows the choice just made while its page loads (#285)', async () => {
        const actor = quickActor();
        const next = held();
        await openBrowse('/games', call => call.query.has('platform') ? next.answer : json(page(games(3))));

        await actor.selectOptions(screen.getByLabelText('Platform'), 'PC (Windows)');
        await screen.findByText('Loading games…');

        expect(screen.getByLabelText('Platform')).toHaveValue('6');
    });

    it('keeps the list on screen while leaving for a game page', async () => {
        // The spinner is for a different result set. Leaving for a game is a navigation too, and
        // the list blanking out under the click would read as the page breaking. The game page's
        // loader is held, so the navigation is still out when this looks.
        const actor = quickActor();
        await openBrowse('/games', () => json(page(games(3))));

        await actor.click(screen.getByRole('link', { name: 'Game 2' }));

        expect(await screen.findByText('Loading /games/2')).toBeInTheDocument();
        expect(address()).toBe('/games');
        expect(screen.queryByText('Loading games…')).not.toBeInTheDocument();
        expect(screen.getAllByRole('article')).toHaveLength(3);
    });
});

describe('GamesPage for a signed-in reader', () => {
    it('puts a game in a list from its card at once, through the write guard', async () => {
        // The page is shared-cached and signed-out first; the card's list controls arrive with the account.
        const actor = quickActor();
        const move = held();
        const { api } = await openBrowse('/games', () => json(page(games(2))), {
            ...signedInRoutes(userProfile()),
            'PUT /api/lists/1': () => move.answer,
        });

        await actor.click(await screen.findByRole('button', { name: 'Open list options for Game 1' }));
        await actor.click(card('Game 1').getByRole('button', { name: 'Backlog' }));

        expect(card('Game 1').getByRole('button', { name: 'Backlog' })).toHaveAttribute('aria-pressed', 'true');
        const [put] = api.callsTo('PUT', '/api/lists/1');
        expect(put.body).toEqual({ status: 'backlog' });
        expectSentThroughApiFetch(put);

        // Held while the move is out, and kept once the API agrees.
        expect(card('Game 1').getByRole('button', { name: 'Playing' })).toBeDisabled();
        await act(async () => move.release(empty()));
        await waitFor(() => expect(card('Game 1').getByRole('button', { name: 'Playing' })).toBeEnabled());
        expect(card('Game 1').getByRole('button', { name: 'Backlog' })).toHaveAttribute('aria-pressed', 'true');
    });
});
