import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, createRoutesStub, type LoaderFunction } from 'react-router';
import { ErrorBoundary, ProfilePage, headers, loader, meta } from '@/pages/ProfilePage';
import { CACHE_NOT_FOUND, CACHE_PROFILE, PRIVATE_NO_STORE } from '@/lib/cache';
import type { PublicActivity, PublicProfile } from '@/types/profile';
import type { Route } from './+types/ProfilePage';

type Tag = Partial<Record<'title' | 'name' | 'property' | 'content' | 'rel' | 'href', string>>;

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

/**
 * The tags for a profile, given only the figures `meta` reads. The rest of the document is the
 * component's business and is left out, which is what the cast is for.
 */
function tagsFor({ userName = 'AliceInChains', page = 1, recorded = 12, favourites = 0 } = {}): Tag[] {
    const profile = {
        userName,
        favourites,
        library: { tracked: recorded, recorded, byStatus: { finished: 3 } },
    };

    return meta({ loaderData: { profile, page, site: SITE } } as unknown as Route.MetaArgs) as Tag[];
}

const canonical = (tags: Tag[]) => tags.find(tag => tag.rel === 'canonical')?.href;
const noindex = (tags: Tag[]) => tags.some(tag => tag.name === 'robots' && tag.content?.includes('noindex'));

describe('ProfilePage meta', () => {
    it('calls itself by the name as its owner wrote it, not as the URL was typed', () => {
        // The lookup ignores case, so `/u/aliceinchains` and `/u/ALICEINCHAINS` both render. The
        // name here is the API's answer, and it is the spelling the sitemap lists too.
        expect(canonical(tagsFor())).toBe('https://myvideogamelist.net/u/AliceInChains');
    });

    it('gives each page of reviews its own canonical URL, and the first page none of the query', () => {
        expect(canonical(tagsFor({ page: 3 }))).toBe('https://myvideogamelist.net/u/AliceInChains?page=3');
        expect(canonical(tagsFor({ page: 1 }))).toBe('https://myvideogamelist.net/u/AliceInChains');
    });

    it('says whose profile it is in Open Graph terms', () => {
        const tags = tagsFor();

        expect(tags).toContainEqual({ property: 'og:type', content: 'profile' });
        expect(tags).toContainEqual({ property: 'profile:username', content: 'AliceInChains' });
    });

    it('keeps a published profile with nothing on it out of the index', () => {
        // The same test `SitemapService.ListedProfiles` applies on the server. A page listed in the
        // sitemap and marked noindex is reported as an error, so the two must not disagree.
        const empty = tagsFor({ recorded: 0, favourites: 0 });

        expect(noindex(empty)).toBe(true);
        expect(canonical(empty)).toBeUndefined();
    });

    it('indexes a profile whose only content is a shelf of favourites', () => {
        // A favourite needs no entry (ADR 0029), so nothing recorded is not the same as nothing here.
        expect(noindex(tagsFor({ recorded: 0, favourites: 4 }))).toBe(false);
    });
});

/**
 * A published profile whose library came by import and has never been moved here: games on every
 * shelf, a chart drawn from the dates on their playthroughs, and no status change at all — so no
 * `trackingSince`. Each test narrows it to what it is about.
 */
function importedProfile(activity: Partial<PublicActivity> = {}, recorded = 606): PublicProfile {
    return {
        userName: 'ChronosSF',
        activity: {
            trackingSince: null,
            months: [{ month: '2026-09', started: 2, finished: 2, dropped: 0 }],
            currentStreakMonths: 5,
            longestStreakMonths: 8,
            ...activity,
        },
        library: {
            tracked: recorded,
            recorded,
            wishlisted: 0,
            byStatus: { backlog: 0, playing: 0, on_hold: 0, finished: recorded, dropped: 0 },
            completionRate: recorded === 0 ? null : 1,
        },
        scores: { scored: 0, mean: null, distribution: Array(10).fill(0) },
        playtime: { playthroughs: 0, totalMinutes: 0, withHours: 0 },
        reviews: 0,
        favourites: 0,
    };
}

function renderProfile(profile: PublicProfile) {
    const loaderData = { profile, reviews: null, favourites: null, page: 1, site: SITE };
    return render(
        <MemoryRouter>
            <ProfilePage {...({ loaderData } as unknown as Route.ComponentProps)} />
        </MemoryRouter>,
    );
}

describe('ProfilePage header', () => {
    it('dates the tracking from the first status change', () => {
        renderProfile(importedProfile({ trackingSince: '2026-08-25T14:16:17+00:00' }));

        expect(screen.getByText('Tracking games here since 25 August 2026.')).toBeInTheDocument();
    });

    it('gives no date for an imported library with no status change, and does not call it empty', () => {
        // An import writes no events (ADR 0026 §2) and an imported date is not when tracking began
        // here (ADR 0047), so there is no date to give — and with 606 games on the page,
        // "has not tracked anything here yet" would be untrue.
        renderProfile(importedProfile());

        expect(screen.queryByText(/tracking games here since/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/has not tracked anything here yet/i)).not.toBeInTheDocument();
        // The chart below still shows what the dates say.
        expect(screen.getByText('2026-09: started 2, finished 2, dropped 0')).toBeInTheDocument();
    });

    it('says once that there is nothing yet, and what will be here, when there is nothing at all', () => {
        // A page of dashes and empty bars says the same thing less clearly, as the owner's own
        // profile already judges.
        renderProfile(importedProfile({ months: [], currentStreakMonths: 0, longestStreakMonths: 0 }, 0));

        expect(screen.getByText('ChronosSF has not tracked anything here yet.')).toBeInTheDocument();
        expect(screen.getByText(
            'Once they add games to their lists, this page will show what they play and finish, how they '
                + 'score games, and the reviews they publish.',
        )).toBeInTheDocument();
        expect(screen.queryByText('Has not tracked anything here yet.')).not.toBeInTheDocument();
        expect(screen.queryByText('games tracked')).not.toBeInTheDocument();
    });

    it('keeps its sections for a profile whose only content is a wishlist, which they report', () => {
        const wishing = importedProfile({ months: [], currentStreakMonths: 0, longestStreakMonths: 0 }, 0);
        renderProfile({ ...wishing, library: { ...wishing.library, wishlisted: 3 } });

        expect(screen.getByText('Has not tracked anything here yet.')).toBeInTheDocument();
        expect(screen.getByText(/^Plus 3 on their wishlist/)).toBeInTheDocument();
    });

    it('keeps its sections for a profile whose only content is a shelf of favourites', () => {
        // A favourite needs no entry (ADR 0029), and `meta` indexes such a profile, so it must not
        // read as one with nothing on it.
        const choosing = importedProfile({ months: [], currentStreakMonths: 0, longestStreakMonths: 0 }, 0);
        renderProfile({ ...choosing, favourites: 2 });

        expect(screen.queryByText('ChronosSF has not tracked anything here yet.')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Favourites' })).toBeInTheDocument();
    });

    it('keeps its sections for a profile whose only record is a month of activity', () => {
        renderProfile(importedProfile({}, 0));

        expect(screen.queryByText('ChronosSF has not tracked anything here yet.')).not.toBeInTheDocument();
        expect(screen.getByText('2026-09: started 2, finished 2, dropped 0')).toBeInTheDocument();
    });
});

describe('ProfilePage empty sections', () => {
    /** Something recorded, so the sections are drawn, and nothing in any of them. */
    const quiet = () => {
        const profile = importedProfile({ months: [], currentStreakMonths: 0, longestStreakMonths: 0 }, 0);
        return { ...profile, library: { ...profile.library, wishlisted: 1 } };
    };

    it('say what will fill them, without asking a visitor to do anything', () => {
        // The reader is usually not the owner, so each says what goes there and never "rate a game".
        renderProfile(quiet());

        expect(screen.getByText(
            'No status changes or playthrough dates recorded yet. The games they start, finish and drop will show here, month by month.',
        )).toBeInTheDocument();
        expect(screen.getByText(
            'ChronosSF has not scored anything yet. Their scores will show here, from 1 to 10, as they rate games.',
        )).toBeInTheDocument();
        expect(screen.getByText('ChronosSF has not published any reviews yet. Reviews they publish will show here.'))
            .toBeInTheDocument();
        expect(screen.queryByText(/rate a game/i)).not.toBeInTheDocument();
    });
});

/** A profile document's three requests, answered from a table of how each should go. */
function stubProfileApi(answers: { profile: Array<number | 'unreachable'>; reviews?: number; total?: number }) {
    let call = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/reviews')) {
            return new Response(
                JSON.stringify({ userName: 'ChronosSF', reviews: [], total: answers.total ?? 0, page: 1, pageSize: 20 }),
                { status: answers.reviews ?? 200 },
            );
        }
        if (url.includes('/favourites')) {
            return new Response(JSON.stringify({ userName: 'ChronosSF', games: [] }), { status: 200 });
        }
        // The profile itself, answered in turn with each of these, repeating the last.
        const answer = answers.profile[Math.min(call++, answers.profile.length - 1)];
        if (answer === 'unreachable') throw new TypeError('Failed to fetch');
        return answer === 200
            ? new Response(JSON.stringify(importedProfile()), { status: 200 })
            : new Response('nope', { status: answer });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('ProfilePage when there is no profile to show', () => {
    afterEach(() => vi.unstubAllGlobals());

    function renderRoute(path = '/u/ChronosSF') {
        const Stub = createRoutesStub([{
            id: 'profile',
            path: '/u/:userName',
            Component: ProfilePage as unknown as React.ComponentType,
            ErrorBoundary,
            loader: loader as unknown as LoaderFunction,
        }]);
        render(<Stub initialEntries={[path]} />);
    }

    it('says what would put one here, in words that fit a private profile and an unclaimed name alike', async () => {
        // The two are one 404 on purpose (ADR 0027 §7), so nothing here may tell them apart.
        stubProfileApi({ profile: [404] });
        renderRoute();

        expect(await screen.findByRole('heading', { level: 1, name: 'There is no profile to show here' })).toBeInTheDocument();
        expect(screen.getByText(
            'A profile shows here once its owner makes it public, and only under the username they have now.',
        )).toBeInTheDocument();
        expect(screen.queryByText(/private profile|no such user|does not exist/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('says a page of reviews past the last is not there, and offers the first', async () => {
        // The profile has already answered as public, so saying so gives nothing away.
        stubProfileApi({ profile: [200], total: 3 });
        renderRoute('/u/ChronosSF?page=7');

        expect(await screen.findByRole('heading', { level: 1, name: 'There is no such page of reviews' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute('href', '/u/ChronosSF');
    });

    it('says the same of a page that is not a number, before the profile is asked about at all', async () => {
        const fetchMock = stubProfileApi({ profile: [200] });
        renderRoute('/u/ChronosSF?page=two');

        expect(await screen.findByRole('heading', { level: 1, name: 'There is no such page of reviews' })).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('says a failure as the lists page does, and asks again when told to', async () => {
        stubProfileApi({ profile: [502, 200] });
        renderRoute();

        expect(await screen.findByRole('heading', { level: 1, name: 'Failed to load this profile' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'ChronosSF' })).toBeInTheDocument();
    });
});

describe('ProfilePage caching', () => {
    afterEach(() => vi.unstubAllGlobals());

    const args = (search = '') => ({
        params: { userName: 'ChronosSF' },
        request: new Request(`https://myvideogamelist.net/u/ChronosSF${search}`),
    }) as unknown as Route.LoaderArgs;

    const policyOf = (init: { loaderHeaders?: HeadersInit; errorHeaders?: HeadersInit }) => headers({
        loaderHeaders: new Headers(init.loaderHeaders),
        errorHeaders: init.errorHeaders === undefined ? undefined : new Headers(init.errorHeaders),
        parentHeaders: new Headers(),
        actionHeaders: new Headers(),
    } as Route.HeadersArgs)['Cache-Control'];

    /** What the loader's answer, or the Response it threw, says about caching. */
    async function policyFor(search = '') {
        const outcome = await loader(args(search)).catch((error: unknown) => error);
        if (outcome instanceof Response) {
            return policyOf({ errorHeaders: outcome.headers, loaderHeaders: outcome.headers });
        }
        return policyOf({ loaderHeaders: (outcome as { init: ResponseInit }).init.headers });
    }

    it('shares a whole page, and nothing that degraded', async () => {
        stubProfileApi({ profile: [200] });
        expect(await policyFor()).toBe(CACHE_PROFILE);

        stubProfileApi({ profile: [200], reviews: 500 });
        expect(await policyFor()).toBe(PRIVATE_NO_STORE);
    });

    it("hands on a 404's short policy and a failure's refusal", async () => {
        stubProfileApi({ profile: [404] });
        expect(await policyFor()).toBe(CACHE_NOT_FOUND);

        stubProfileApi({ profile: [200] });
        expect(await policyFor('?page=two')).toBe(CACHE_NOT_FOUND);

        stubProfileApi({ profile: ['unreachable'] });
        expect(await policyFor()).toBe(PRIVATE_NO_STORE);
    });

    it('lets nothing store a failure that was not a Response, now that this route is its own boundary', () => {
        expect(policyOf({})).toBe(PRIVATE_NO_STORE);
    });

    it('does not call a profile missing when it could not be loaded', () => {
        const titleFor = (status: number) => (meta({
            loaderData: undefined,
            error: { status, statusText: '', internal: false, data: '' },
        } as unknown as Route.MetaArgs) as Tag[])[0].title;

        expect(titleFor(404)).toBe('Profile not found - MyVideoGameList');
        expect(titleFor(502)).toBe('Profile unavailable - MyVideoGameList');
    });
});
