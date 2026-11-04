import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub, Outlet } from 'react-router';
import GameYoursPage, { headers, meta } from '@/pages/GameYoursPage';
import type { AuthDialogContextValue } from '@/contexts/AuthDialogContext';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import type { GamePageOutlet } from '@/lib/gamePage';
import { game } from '@/test/factories';
import type { GameDto } from '@/types/game';
import type { Route } from './+types/GameYoursPage';

/**
 * The game page's Your game tab as a route of its own (ADR 0084): what it tells a crawler, what it lets
 * be kept, and what it draws from what the game page hands it. Inside the page, with the reader's entry
 * real, it is `GamePage.panel.test.tsx`'s; the tab's own controls are `GameYours`'s.
 */

/** The sign-in dialog, as far as the tab opens it. One object, handed back on every call. */
const authDialog: AuthDialogContextValue = { open: vi.fn() };

vi.mock('@/hooks/useAuthDialog', () => ({ useAuthDialog: () => authDialog }));

const CELESTE = game({ id: 1, title: 'Celeste', releaseDate: '2018-01-25' });

beforeEach(() => {
    vi.mocked(authDialog.open).mockClear();
});

describe('GameYoursPage meta', () => {
    type Tag = Partial<Record<'title' | 'name' | 'property' | 'content' | 'rel' | 'href', string>>;

    /** The tab's tags, with the game page's loader data where React Router puts it: on the parent's match. */
    const tagsFor = (loaded: GameDto | null) => meta({
        matches: [
            { id: 'root', loaderData: undefined },
            { id: 'pages/GamePage', loaderData: loaded === null ? undefined : { game: loaded, site: { siteUrl: 'https://myvideogamelist.net', indexable: true } } },
            { id: 'pages/GameYoursPage', loaderData: undefined },
        ],
    } as unknown as Route.MetaArgs) as Tag[];

    it("names the game, and its year, as the reader's own page of it", () => {
        expect(tagsFor(CELESTE).find(tag => tag.title)?.title).toBe('Your game: Celeste (2018) - MyVideoGameList');
    });

    it("dates a game out on New Year's Day by the year the API names, west of Greenwich too", () => {
        // `meta` runs in the browser as well, where `new Date('2017-01-01')` is the last day of 2016 here.
        const tags = tagsFor(game({ id: 1, title: 'Celeste', releaseDate: '2017-01-01' }));

        expect(tags.find(tag => tag.title)?.title).toBe('Your game: Celeste (2017) - MyVideoGameList');
    });

    it('keeps itself out of a search index, and so names no canonical address', () => {
        // A crawler would find the game's page again under a second address with nothing of its own, and
        // a page marked `noindex` that names a canonical URL is telling the crawler two things (ADR 0036).
        const tags = tagsFor(CELESTE);

        expect(tags).toContainEqual({ name: 'robots', content: 'noindex' });
        expect(tags.find(tag => tag.rel === 'canonical')).toBeUndefined();
        expect(tags.find(tag => tag.property === 'og:url')).toBeUndefined();
    });

    it("still names itself, and still says noindex, when the game page's data is not there", () => {
        const tags = tagsFor(null);

        expect(tags.find(tag => tag.title)?.title).toBe('Your game - MyVideoGameList');
        expect(tags).toContainEqual({ name: 'robots', content: 'noindex' });
    });
});

describe('GameYoursPage headers', () => {
    const policyOf = (init: { errorHeaders?: HeadersInit; parentHeaders?: HeadersInit }) => headers({
        loaderHeaders: new Headers(),
        parentHeaders: new Headers(init.parentHeaders),
        actionHeaders: new Headers(),
        errorHeaders: init.errorHeaders === undefined ? undefined : new Headers(init.errorHeaders),
    } as Route.HeadersArgs)['Cache-Control'];

    it("lets nothing share the reader's own address, even where the game's page is shared", () => {
        // The deepest route's headers are the response's, so the game page's hour would reach this
        // address if this function handed on its parent's.
        expect(policyOf({})).toBe(PRIVATE_NO_STORE);
        expect(policyOf({ parentHeaders: { 'Cache-Control': CACHE_GAME } })).toBe(PRIVATE_NO_STORE);
    });

    it("hands on the policy of a failure the game page's loader threw", () => {
        // A missing game is briefly shared as a 404 at either address; a failure never is.
        expect(policyOf({ errorHeaders: { 'Cache-Control': CACHE_NOT_FOUND } })).toBe(CACHE_NOT_FOUND);
        expect(policyOf({ errorHeaders: { 'Cache-Control': PRIVATE_NO_STORE } })).toBe(PRIVATE_NO_STORE);
    });

    it('fails closed on a failure that stated no policy', () => {
        expect(policyOf({ errorHeaders: {} })).toBe(PRIVATE_NO_STORE);
    });
});

describe('GameYoursPage', () => {
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

    /**
     * The tab under a stand-in for the game page, handing it what the page hands it. Outside the reader's
     * entry, as the page renders it before auth answers and for a reader who is signed out.
     */
    function renderTab(authLoading: boolean) {
        const outlet: GamePageOutlet = {
            game: CELESTE,
            memberScores: null,
            community,
            viewer: null,
            authLoading,
            isFavourite: () => false,
        };
        const Stub = createRoutesStub([{
            id: 'pages/GamePage',
            path: '/games/:id',
            Component: () => <Outlet context={outlet} />,
            children: [{ path: 'yours', Component: GameYoursPage }],
        }]);
        return render(<Stub initialEntries={['/games/1/yours']} />);
    }

    it("holds the reader's record's place while auth has not answered, asking nobody to sign in", async () => {
        // The server render and the first in the browser cannot know who is reading.
        renderTab(true);

        expect(await screen.findByRole('status')).toHaveTextContent('Loading your record of this game…');
        expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    });

    it('asks a reader who is signed out to sign in, and opens the dialog when they say yes', async () => {
        renderTab(false);

        const tab = (await screen.findByRole('heading', { level: 2, name: 'Your game' })).closest('section')!;
        await userEvent.setup().click(within(tab).getByRole('button', { name: 'Sign in' }));

        expect(authDialog.open).toHaveBeenCalledExactlyOnceWith('login');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
