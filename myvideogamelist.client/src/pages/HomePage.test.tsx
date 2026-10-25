import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, RouterContextProvider } from 'react-router';
import { HomePage, headers, loader, meta } from '@/pages/HomePage';
import { AuthDialogProvider } from '@/contexts/AuthDialogProvider';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { WishlistContextValue } from '@/contexts/WishlistContext';
import { CACHE_HOME, PRIVATE_NO_STORE } from '@/lib/cache';
import { calendarEvents, userProfile } from '@/test/factories';
import { LIST_NAMES, type ListId } from '@/types/list';
import type { HomeResponse, NewsItemDto } from '@/types/news';
import type { CalendarCuratedEvent, CalendarEvents, ComingSoonGame, JustOutGame } from '@/types/releases';
import type { Route } from './+types/HomePage';

const authActions = {
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

/**
 * A visitor nobody has signed in as, once `/api/auth/me` has said so. Module-level objects handed back
 * on every call, never a fresh literal — a new object per render re-runs any effect depending on it,
 * which ends in a heap crash rather than an assertion failure.
 */
const SIGNED_OUT: AuthContextValue = { user: null, loading: false, ...authActions };

/** Before `/api/auth/me` has answered — which is every server render, and the render that hydrates it. */
const UNKNOWN: AuthContextValue = { user: null, loading: true, ...authActions };

const SIGNED_IN: AuthContextValue = { user: userProfile({ userName: 'bob' }), loading: false, ...authActions };

/** Which of the three the page is told; each test that needs another sets it. */
const auth = vi.hoisted(() => ({ current: null as AuthContextValue | null }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.current }));

// The signed-in hero's own sections read the user's data, and are not what these tests are about. The
// line stands in as a landmark, so that a test can see it is the line that is there.
vi.mock('@/components/HomeStatsStrip', () => ({ HomeStatsStrip: () => null }));
vi.mock('@/components/ContinuePlayingRail', () => ({ ContinuePlayingRail: () => null }));
vi.mock('@/components/PlayNextPicker', () => ({ PlayNextPicker: () => null }));
vi.mock('@/components/ReleaseLine', () => ({
    ReleaseLine: () => <section aria-label="Coming up" />,
}));

/** Nobody's favourites: the visitor here is signed out. Hoisted and handed back whole, as above. */
const favourites = { isFavourite: () => false } as unknown as FavouritesContextValue;

vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

/** Which list each of the reader's games is in; a test that needs one sets it. */
const inList = new Map<number, ListId>();

const lists = {
    getListFor: (gameId: number) => inList.get(gameId) ?? null,
    nameFor: (listId: ListId) => LIST_NAMES[listId],
} as unknown as ListsContextValue;

vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));

/** A wishlist that has loaded with nothing on it, and saves whatever it is asked to unless told otherwise. */
const wishlist = {
    isWishlisted: () => false,
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
} as unknown as WishlistContextValue;

vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

const NEWS: NewsItemDto = {
    id: 'gid-1',
    gameId: 1,
    gameTitle: 'Hades',
    gameCoverUrl: null,
    title: 'Patch 1.1',
    url: 'https://example.test/1',
    source: 'Steam',
    excerpt: null,
    publishedAt: '2026-09-01T12:00:00+00:00',
};

/** Steam's Next Fest, as the admin page holds it: on the 19th to the 26th. */
const NEXT_FEST: CalendarCuratedEvent = {
    id: 2,
    kind: 'fest',
    store: 'steam',
    name: 'Steam Next Fest',
    startsOn: '2026-10-19',
    endsOn: '2026-10-26',
    url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
};

/** Two of the Coming soon panel's games of 2026-10-25: one known to the day, one only to a quarter. */
const COMING_SOON: ComingSoonGame[] = [
    {
        gameId: 52189,
        title: 'Grand Theft Auto VI',
        coverImageUrl: null,
        precision: 'day',
        starts: '2026-11-19',
        platforms: [
            { id: 167, name: 'PlayStation 5', abbreviation: 'PS5', logoUrl: null, manufacturer: null },
            { id: 169, name: 'Xbox Series X|S', abbreviation: 'Series X|S', logoUrl: null, manufacturer: null },
        ],
    },
    { gameId: 347645, title: 'Out of Words', coverImageUrl: null, precision: 'quarter', starts: '2027-01-01', platforms: [] },
];

/**
 * Two of the Just out panel's games: Enshrouded as it was on 2026-10-25, and one out last year, which the
 * panel's ninety days could only hold in a payload built before the new year.
 */
const JUST_OUT: JustOutGame[] = [
    {
        gameId: 248643,
        title: 'Enshrouded',
        coverImageUrl: null,
        released: '2026-10-15',
        platforms: [
            { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC', logoUrl: null, manufacturer: null },
            { id: 167, name: 'PlayStation 5', abbreviation: 'PS5', logoUrl: null, manufacturer: null },
        ],
    },
    { gameId: 2, title: 'Out last year', coverImageUrl: null, released: '2025-09-24', platforms: [] },
];

/** The day the tests' loader runs on, in UTC, and the reader's own once hydrated. */
const TODAY = '2026-10-17';

/** The showcases and sales of an answer that brought none. */
const NO_EVENTS: CalendarEvents = { curated: [], showcases: [], degraded: true };

/** What is left of the page when the API gave the loader nothing to build it from. */
const NOTHING: HomeResponse = { news: [], events: NO_EVENTS, comingSoon: [], justOut: [], degraded: true };

/** `/api/home` answering with `body` — a 200 unless told otherwise, which is what it sends even with IGDB down. */
function stubHome(body: unknown, status = 200) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

/** What React Router hands the loader: the context is where the request's trace lives. */
const loaderArgs = (cookie?: string) => ({
    context: new RouterContextProvider(),
    request: new Request(SITE.siteUrl, { headers: cookie === undefined ? {} : { Cookie: cookie } }),
}) as unknown as Route.LoaderArgs;

/** The policy a loader attached through `data()`. */
const policyOf = (result: Awaited<ReturnType<typeof loader>>) =>
    new Headers(result.init?.headers).get('Cache-Control');

/** The page, given what the loader would have handed it. */
function renderHome(home: HomeResponse, { signedInFlag = false } = {}) {
    const props = { loaderData: { ...home, site: SITE, today: TODAY, signedInFlag } } as unknown as Route.ComponentProps;
    return render(<MemoryRouter><AuthDialogProvider><HomePage {...props} /></AuthDialogProvider></MemoryRouter>);
}

beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE.siteUrl);
    vi.stubEnv('SITE_INDEXABLE', 'true');
    auth.current = SIGNED_OUT;
    inList.clear();
    vi.mocked(wishlist.add).mockClear().mockResolvedValue(true);

    // Midday on the 17th in UTC, which is when the loader runs; the reader's own day is the 17th too
    // everywhere but the few timezones past +11, where it is the 18th and the panel's fest is still on.
    // Only the date is faked, so nothing waiting on a timer stalls.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('HomePage loader', () => {
    it('shares an answer the API says is whole', async () => {
        const home: HomeResponse = {
            news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: [], justOut: [], degraded: false,
        };
        stubHome(home);

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(CACHE_HOME);
        expect(result.data).toEqual({ ...home, site: SITE, today: TODAY, signedInFlag: false });
    });

    it('hands the page the day it ran on in UTC, which is not always the reader’s', async () => {
        // Half past eleven at night in New York is already the next day in UTC. The page counts from this
        // until it hydrates, and from the reader's own day after.
        vi.setSystemTime(new Date('2026-10-17T23:30:00-04:00'));
        stubHome({ news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false });

        const result = await loader(loaderArgs());

        expect(result.data.today).toBe('2026-10-18');
    });

    it('reads the signed-in flag from the request, and nothing else from its cookies', async () => {
        // The one cookie the edge lets through to this page, and the one it keeps a copy of it for (ADR 0074).
        stubHome({ news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false });

        const flagged = await loader(loaderArgs('theme=dark; mvgl_signed_in=1'));
        const visitor = await loader(loaderArgs('theme=dark'));

        expect(flagged.data.signedInFlag).toBe(true);
        expect(visitor.data.signedInFlag).toBe(false);
        // Both copies may be shared: neither holds anything of anybody's.
        expect(policyOf(flagged)).toBe(CACHE_HOME);
        expect(policyOf(visitor)).toBe(CACHE_HOME);
    });

    it('does not let a degraded 200 be cached', async () => {
        // IGDB down with the API up. The status is a 200 and the body is a well-formed payload, so
        // nothing but the flag separates this from a healthy answer — and read as one, an empty
        // home page was pinned at the edge for five minutes and served stale for ten more.
        stubHome({ news: [], events: calendarEvents(), comingSoon: [], justOut: [], degraded: true });

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
    });

    it('still renders what a degraded answer has, with the site beside it', async () => {
        // The news failed and the panels did not. The page shows the panels; it is just not kept.
        // `meta` reads `site` whichever way the loader went, so it rides along here too.
        const home: HomeResponse = { news: [], events: calendarEvents(), comingSoon: [], justOut: [], degraded: true };
        stubHome(home);

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data).toEqual({ ...home, site: SITE, today: TODAY, signedInFlag: false });
    });

    it('does not let an answer missing its showcases be cached, and keeps the sales it has', async () => {
        // IGDB could not be asked for the showcases. The API says so twice: in the events, for the panel,
        // and in the composite's own flag, which is the one the policy is chosen by.
        const events = calendarEvents({ curated: [NEXT_FEST], degraded: true });
        stubHome({ news: [NEWS], events, comingSoon: [], justOut: [], degraded: true });

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data.events).toEqual(events);
    });

    it('fails closed on an answer that does not say, however whole it looks', async () => {
        // An API older than this build, in the middle of a deploy. Its news is there, which is
        // exactly why this is not judged from what is there.
        stubHome({ news: [NEWS], events: calendarEvents() });

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data.news).toHaveLength(1);

        // Recorded as degraded, not merely treated as it. The flag is typed a boolean, so passing
        // the payload on as it arrived would hand the page an undefined under that name and leave
        // anything reading it later to repeat the rule the header was chosen by.
        expect(result.data.degraded).toBe(true);
    });

    it('fails closed on an answer with no showcases and sales, though it says it is whole', async () => {
        // An API from before the panel, mid-deploy, says it is whole because as far as it knows it is.
        // Kept at the edge, its page would go on lacking the panel after the API caught up.
        stubHome({ news: [NEWS], degraded: false });

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data.degraded).toBe(true);
        expect(result.data.events).toEqual(NO_EVENTS);
    });

    it('fails closed on an answer with no Coming soon panel, though it says it is whole', async () => {
        // An API from before the panel, mid-deploy, for the reason the showcases and sales give.
        stubHome({ news: [NEWS], events: calendarEvents(), degraded: false });

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data.degraded).toBe(true);
        expect(result.data.comingSoon).toEqual([]);
    });

    it('fails closed on an answer with no Just out panel, though it says it is whole', async () => {
        // An API from before Trending made way for the panel, mid-deploy, for the same reason again.
        stubHome({ news: [NEWS], events: calendarEvents(), comingSoon: COMING_SOON, degraded: false });

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data.degraded).toBe(true);
        expect(result.data.justOut).toEqual([]);
    });

    it('leaves out what an older API still sends, the trending games and the hero', async () => {
        const home: HomeResponse = { news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false };
        stubHome({ ...home, spotlight: null, popular: [] });

        const result = await loader(loaderArgs());

        expect(result.data).toEqual({ ...home, site: SITE, today: TODAY, signedInFlag: false });
    });

    it('degrades, uncached, when the API answers with an error', async () => {
        stubHome({ title: 'Bad Gateway', status: 502 }, 502);

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data).toEqual({ ...NOTHING, site: SITE, today: TODAY, signedInFlag: false });
    });

    it('degrades, uncached, when the API cannot be reached', async () => {
        // fetch rejects rather than returning !ok, and a rejection here must not become a 500.
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

        const result = await loader(loaderArgs());

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
        expect(result.data).toEqual({ ...NOTHING, site: SITE, today: TODAY, signedInFlag: false });
    });
});

describe('HomePage for a signed-out visitor', () => {
    it('welcomes a visitor with what the site is for and the two ways in', () => {
        renderHome({
            news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false,
        });

        expect(screen.getByRole('heading', { level: 1, name: "Every game you've played, in one list" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
        expect(screen.getByRole('dialog', { name: 'Create Account' })).toBeInTheDocument();
    });

    it('opens the sign-in dialog the navbar opens, from the panel', () => {
        renderHome({
            news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

        expect(screen.getByRole('dialog', { name: 'Sign In' })).toBeInTheDocument();
    });

    it('asks the API for nothing from the browser', () => {
        // Everything a visitor sees arrives through the loader, cached once for everybody. What is
        // coming for somebody's games is asked for by the two-week line, which only a signed-in user
        // sees — the Releasing soon rail before it learned that fetching at the page requested the
        // releases for every visitor and showed them to none. The showcases and sales are in the
        // loader's answer for the same reason.
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            throw new Error(`unexpected fetch: ${String(input)}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderHome({
            news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: [], justOut: [], degraded: false,
        });

        expect(screen.getByRole('heading', { name: 'Latest news' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Showcases and sales' })).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows the showcases and sales first among the shared sections, where the line would be', () => {
        renderHome({
            news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: [], justOut: [], degraded: false,
        });

        const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
        expect(headings).toEqual(['Showcases and sales', 'Latest news']);
        expect(screen.getByRole('link', { name: /Steam Next Fest/ })).toBeInTheDocument();
    });

    it('shows what is coming soon, then what is just out, then the news, each game with when and on what', () => {
        renderHome({
            news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: COMING_SOON, justOut: JUST_OUT, degraded: false,
        });

        const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
        expect(headings).toEqual(['Showcases and sales', 'Coming soon', 'Just out', 'Latest news']);

        const comingSoon = screen.getByRole('list', { name: 'Coming soon' });
        expect(within(comingSoon).getByRole('link', { name: /Grand Theft Auto VI/ })).toHaveAttribute('href', '/games/52189');
        expect(within(comingSoon).getByText('Nov 19')).toHaveAttribute('datetime', '2026-11-19');
        expect(within(comingSoon).getByText('PS5, Series X|S')).toBeInTheDocument();
        expect(within(comingSoon).getByText('Q1 2027')).toBeInTheDocument();

        const justOut = screen.getByRole('list', { name: 'Just out' });
        expect(within(justOut).getByRole('link', { name: /Enshrouded/ })).toHaveAttribute('href', '/games/248643');
        expect(within(justOut).getByText('Oct 15')).toHaveAttribute('datetime', '2026-10-15');
        expect(within(justOut).getByText('PC, PS5')).toBeInTheDocument();
        // Last year's day carries its year, as Coming soon's next year's does.
        expect(within(justOut).getByText('Sep 24, 2025')).toHaveAttribute('datetime', '2025-09-24');
    });

    it('draws no Just out section when nothing passes its rules', () => {
        renderHome({ news: [NEWS], events: calendarEvents(), comingSoon: COMING_SOON, justOut: [], degraded: false });

        expect(screen.queryByRole('heading', { name: 'Just out' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();
    });

    it('draws no Coming soon section when nothing passes its rules', () => {
        renderHome({ news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false });

        expect(screen.queryByRole('heading', { name: 'Coming soon' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Latest news' })).toBeInTheDocument();
    });

    it('draws no panel when nothing is on', () => {
        renderHome({ news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false });

        expect(screen.queryByRole('heading', { name: 'Showcases and sales' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Latest news' })).toBeInTheDocument();
    });

    it('renders data from the build before this one, which has no showcases and sales, without them', () => {
        // A navigation inside the app in a deploy's first minutes, answered from the edge with a payload
        // the previous build wrote. It has no `events`, and must cost the panel rather than the page.
        const { events: _missing, ...older } = {
            news: [NEWS], events: calendarEvents(), comingSoon: [], justOut: [], degraded: false,
        } satisfies HomeResponse;
        const props = { loaderData: { ...older, site: SITE } } as unknown as Route.ComponentProps;

        render(<MemoryRouter><AuthDialogProvider><HomePage {...props} /></AuthDialogProvider></MemoryRouter>);

        expect(screen.getByRole('heading', { name: 'Latest news' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Showcases and sales' })).toBeNull();
    });

    it('shows the panel while nobody knows yet who is reading, as the server render does', () => {
        auth.current = UNKNOWN;

        renderHome({
            news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: [], justOut: [], degraded: false,
        });

        expect(screen.getByRole('heading', { name: 'Showcases and sales' })).toBeInTheDocument();
    });

    it('draws the welcome when the flag is left over from a session that has ended', () => {
        // `me` has answered nobody, which outranks the flag; the API clears it on the same answer.
        renderHome(
            { news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: [], justOut: [], degraded: false },
            { signedInFlag: true });

        expect(screen.getByRole('heading', { level: 1, name: "Every game you've played, in one list" })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Showcases and sales' })).toBeInTheDocument();
    });
});

describe('HomePage for a browser that carries the signed-in flag, before anybody knows who', () => {
    it('draws the signed-in top section, naming nobody, with each of the reader’s parts as its skeleton', () => {
        // Every server render of the flagged copy, and the render that hydrates it (ADR 0074).
        auth.current = UNKNOWN;

        renderHome(
            { news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: [], justOut: [], degraded: false },
            { signedInFlag: true });

        expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create an account' })).toBeNull();
        expect(screen.getAllByRole('status').map(status => status.textContent)).toEqual([
            'Loading your numbers…',
            'Loading the games you are playing…',
            'Loading a pick from your backlog…',
        ]);
        expect(screen.getByRole('heading', { name: 'Coming up' })).toBeInTheDocument();
        expect(screen.getByText('Looking up what is coming for your games…')).toBeInTheDocument();
        // The line's place, so the showcases and sales give way to it as they do once it is drawn.
        expect(screen.queryByRole('heading', { name: 'Showcases and sales' })).toBeNull();
        // Shown once auth has answered, as the navbar's link to the same page is.
        expect(screen.queryByRole('link', { name: 'News for your games' })).toBeNull();
    });
});

describe('HomePage for somebody signed in', () => {
    it('leaves the showcases and sales to the two-week line, rather than showing every one twice', () => {
        auth.current = SIGNED_IN;

        renderHome({
            news: [NEWS], events: calendarEvents({ curated: [NEXT_FEST] }), comingSoon: [], justOut: [], degraded: false,
        });

        expect(screen.getByRole('heading', { name: 'Welcome back, bob' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Coming up' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Showcases and sales' })).toBeNull();
        expect(screen.queryByRole('link', { name: /Steam Next Fest/ })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Latest news' })).toBeInTheDocument();
    });

    it('says which of the panels’ games are in the reader’s lists', () => {
        auth.current = SIGNED_IN;
        inList.set(52189, 'backlog');

        renderHome({ news: [NEWS], events: calendarEvents(), comingSoon: COMING_SOON, justOut: JUST_OUT, degraded: false });

        const comingSoon = screen.getByRole('list', { name: 'Coming soon' });
        expect(within(comingSoon).getByText('In Backlog')).toBeInTheDocument();
        expect(within(screen.getByRole('list', { name: 'Just out' })).queryByText(/^In /)).toBeNull();
    });

    it('puts a game on the wishlist from either panel, which is how it reaches the reader’s line', async () => {
        auth.current = SIGNED_IN;

        renderHome({ news: [NEWS], events: calendarEvents(), comingSoon: COMING_SOON, justOut: JUST_OUT, degraded: false });

        const toggle = screen.getByRole('button', { name: 'Wishlist Out of Words' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(toggle);

        await vi.waitFor(() => expect(wishlist.add).toHaveBeenCalledWith(
            expect.objectContaining({ id: 347645, title: 'Out of Words' })));
        expect(screen.getByRole('button', { name: 'Wishlist Enshrouded' })).toBeInTheDocument();
    });

    it('says so on the card when the wishlist did not take the game', async () => {
        auth.current = SIGNED_IN;
        vi.mocked(wishlist.add).mockResolvedValue(false);

        renderHome({ news: [NEWS], events: calendarEvents(), comingSoon: COMING_SOON, justOut: [], degraded: false });

        fireEvent.click(screen.getByRole('button', { name: 'Wishlist Grand Theft Auto VI' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not update your wishlist.');
    });

    it('takes the card’s failure away with the account it was for', async () => {
        // The page outlives a sign-out, and the card with it: what failed for one account is not the
        // visitor's to read, nor the next account's.
        auth.current = SIGNED_IN;
        vi.mocked(wishlist.add).mockResolvedValue(false);
        const home: HomeResponse = { news: [NEWS], events: calendarEvents(), comingSoon: COMING_SOON, justOut: [], degraded: false };
        const page = () => {
            const props = { loaderData: { ...home, site: SITE, today: TODAY } } as unknown as Route.ComponentProps;
            return <MemoryRouter><AuthDialogProvider><HomePage {...props} /></AuthDialogProvider></MemoryRouter>;
        };
        const { rerender } = render(page());

        fireEvent.click(screen.getByRole('button', { name: 'Wishlist Grand Theft Auto VI' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not update your wishlist.');

        auth.current = SIGNED_OUT;
        rerender(page());
        expect(screen.queryByRole('alert')).toBeNull();

        auth.current = { ...SIGNED_IN, user: userProfile({ id: 'user-2', userName: 'carol' }) };
        rerender(page());
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('HomePage’s panels for a visitor', () => {
    it('offer no wishlist, which a visitor has none of', () => {
        renderHome({ news: [NEWS], events: calendarEvents(), comingSoon: COMING_SOON, justOut: JUST_OUT, degraded: false });

        expect(screen.queryByRole('button', { name: /^Wishlist / })).toBeNull();
    });
});

describe('HomePage headers', () => {
    const policyFor = (loaderHeaders: Headers) =>
        headers({ loaderHeaders } as unknown as Route.HeadersArgs)['Cache-Control'];

    it("sends the loader's policy, whichever it chose", () => {
        expect(policyFor(new Headers({ 'Cache-Control': CACHE_HOME }))).toBe(CACHE_HOME);
        expect(policyFor(new Headers({ 'Cache-Control': PRIVATE_NO_STORE }))).toBe(PRIVATE_NO_STORE);
    });

    it('fails closed when the loader stated none', () => {
        // The shared policy is for an answer somebody judged to be whole, and nobody has here.
        expect(policyFor(new Headers())).toBe(PRIVATE_NO_STORE);
    });
});

describe('HomePage meta', () => {
    /** The page's JSON-LD blocks, as `<Meta>` would write them, through JSON. */
    const blocksFor = (site: typeof SITE | { siteUrl: null; indexable: false }) =>
        (meta({ loaderData: { ...NOTHING, site } } as unknown as Route.MetaArgs) as Record<string, unknown>[])
            .filter(tag => 'script:ld+json' in tag)
            .map(tag => JSON.parse(JSON.stringify(tag['script:ld+json'])) as Record<string, unknown>);

    it('names the site, and where a search for a game goes, in structured data', () => {
        // Google reads the name it shows over a result from the home page, and from nowhere else.
        expect(blocksFor(SITE)).toEqual([expect.objectContaining({
            '@type': 'WebSite',
            name: 'MyVideoGameList',
            url: 'https://myvideogamelist.net/',
            potentialAction: expect.objectContaining({
                '@type': 'SearchAction',
                target: expect.objectContaining({ urlTemplate: 'https://myvideogamelist.net/games?search={search_term_string}' }),
            }),
        })]);
    });

    it('says nothing of the kind from a deployment with no public address', () => {
        expect(blocksFor({ siteUrl: null, indexable: false })).toEqual([]);
    });
});
