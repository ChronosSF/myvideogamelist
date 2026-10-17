import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub, Link, Outlet, type MetaDescriptor } from 'react-router';
import { GamePage, headers, loader, meta } from '@/pages/GamePage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import { CACHE_GAME, CACHE_NOT_FOUND, PRIVATE_NO_STORE } from '@/lib/cache';
import { MIN_MEMBER_SCORES, MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import type { UserProfile } from '@/types/auth';
import type { CommunityScores } from '@/types/community';
import type { CommunityTimes } from '@/types/playthrough';
import { game, userProfile } from '@/test/factories';
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
    loadMore: vi.fn(),
    reload: vi.fn(),
};

vi.mock('@/hooks/useGameCommunity', () => ({ useGameCommunity: () => community }));

// All four fetch for themselves after hydration. What this suite is about is which of three things
// the sidebar shows and what the hero says, so the panel — which has a suite of its own — is
// reduced to the heading a reader knows it by, and a button standing in for every write it reports,
// and the sections that render nothing until their fetch answers are left out.
vi.mock('@/components/GameUserPanel', () => ({
    GameUserPanel: ({ onCommunityChange }: { onCommunityChange: () => void }) => (
        <>
            <h2>Your copy</h2>
            <button type="button" onClick={onCommunityChange}>Save my score</button>
        </>
    ),
}));
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
function renderPage() {
    const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
    return render(
        <Stub
            initialEntries={['/games/1']}
            hydrationData={{ loaderData: { game: { game: CELESTE } } }}
        />,
    );
}

beforeEach(() => {
    auth.user = null;
    auth.loading = true;
    community.settled = false;
    community.scores = null;
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

/** A scores document: how many members scored the game, averaging `mean` on the 1–10 scale. */
function memberScores(members: number, mean = 8.4): CommunityScores {
    return { scored: members, mean, distribution: [0, 0, 0, 0, 0, 0, 0, members, 0, 0], tracked: members };
}

describe("GamePage hero's member score", () => {
    /** The browser's own request for the members' scores has come back. */
    function scored(members: number, mean?: number) {
        community.settled = true;
        community.scores = memberScores(members, mean);
    }

    /** The page as the server rendered it, with the scores the loader read beside the game. */
    function renderWithLoaded(scores: CommunityScores | null) {
        const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
        return render(
            <Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: CELESTE, scores } } }} />,
        );
    }

    it("sits beside IGDB's aggregates, out of 100 and with its count", () => {
        // Ours is an average of other people like theirs, so it wears the same badge on the same
        // scale — never stars, which mean the reader's own score (ADR 0021).
        scored(23);
        renderPage();

        expect(screen.getAllByText('Member score: 84 out of 100, from 23 scores')).not.toHaveLength(0);
    });

    it('is in the server render, from the scores the loader read', () => {
        // Before the browser's own request has answered, which is every server render: the one
        // number on the page that is ours is in the HTML a crawler indexes (ADR 0069).
        renderWithLoaded(memberScores(23));

        const hero = screen.getByRole('heading', { level: 1 }).parentElement!;
        expect(within(hero).getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
    });

    it("gives way to the browser's own answer, which is fresher", () => {
        scored(30, 9);
        renderWithLoaded(memberScores(23));

        expect(screen.queryAllByText('Member score: 84 out of 100, from 23 scores')).toHaveLength(0);
        expect(screen.getAllByText('Member score: 90 out of 100, from 30 scores')).not.toHaveLength(0);
    });

    it("keeps the loader's when the browser's own request failed", () => {
        // Settled with nothing: the loader's figure is older, but it is what the page already showed,
        // and taking it away would read as the score having gone.
        community.settled = true;
        renderWithLoaded(memberScores(23));

        expect(screen.getAllByText('Member score: 84 out of 100, from 23 scores')).not.toHaveLength(0);
    });

    it('is absent until enough members have scored the game', () => {
        // A mean over a handful of members is a handful of opinions presented as a verdict.
        scored(MIN_MEMBER_SCORES - 1);
        renderWithLoaded(memberScores(MIN_MEMBER_SCORES - 1, 10));

        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
        expect(screen.queryByText('Member Score')).not.toBeInTheDocument();
    });

    it('is absent when neither the loader nor the browser has scores', () => {
        renderPage();

        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
    });
});

describe("GamePage sidebar's member score", () => {
    it('says how many scores it is from, in words, like the critic score above it', () => {
        const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
        render(<Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: CELESTE, scores: memberScores(23) } } }} />);

        const sidebar = screen.getByRole('complementary');
        expect(within(sidebar).getByText('Member Score')).toBeInTheDocument();
        expect(within(sidebar).getByText('from 23 scores')).toBeInTheDocument();
        expect(within(sidebar).getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
    });
});

describe("GamePage reader's own writes", () => {
    it("asks for the members' figures again after the panel writes", async () => {
        // The panel reports a saved score, review or deletion, and the page hands that to the hook's
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
});

describe('GamePage loader', () => {
    const WITCHER = game({ id: 1942, title: 'The Witcher 3: Wild Hunt' });
    const SCORES = memberScores(23);
    const TIMES: CommunityTimes = {
        buckets: [
            { type: 'rushed', samples: 0, medianMinutes: null },
            { type: 'normally', samples: MIN_PLAYTHROUGH_SAMPLES, medianMinutes: 3120 },
            { type: 'completionist', samples: 0, medianMinutes: null },
        ],
    };

    const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
    const unreachable = (): Response => { throw new TypeError('fetch failed'); };

    /** The API, answering each of the three paths as told. Anything else it is asked fails the test. */
    function stubApi(answers: Partial<Record<'game' | 'scores' | 'times', () => Response>>) {
        const byPath: Record<string, (() => Response) | undefined> = {
            '/api/games/1942': answers.game ?? json(WITCHER),
            '/api/games/1942/community-scores': answers.scores ?? json(SCORES),
            '/api/games/1942/community-times': answers.times ?? json(TIMES),
        };
        const fetchMock = vi.fn(async (url: string) => {
            const answer = byPath[url];
            if (answer === undefined) throw new Error(`Nothing should ask for ${url}`);
            return answer();
        });
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    const run = (id = '1942') => loader({ params: { id } } as unknown as Route.LoaderArgs);

    /** The policy a loader attached through `data()`. */
    const policyOf = (result: Awaited<ReturnType<typeof loader>>) =>
        new Headers(result.init?.headers).get('Cache-Control');

    /** What a loader threw, which for a page that cannot be rendered is a `Response`. */
    async function thrown(promise: Promise<unknown>): Promise<Response> {
        try {
            await promise;
        } catch (error) {
            return error as Response;
        }
        throw new Error('The loader rendered a page it should have refused.');
    }

    beforeEach(() => {
        vi.stubEnv('SITE_URL', 'https://myvideogamelist.net');
        vi.stubEnv('SITE_INDEXABLE', 'true');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("reads the members' score and times beside the game, and shares a render that has them", async () => {
        const fetchMock = stubApi({});

        const result = await run();

        // The aggregate is in the server render's data, so the HTML a crawler indexes carries it.
        expect(result.data.scores).toEqual(SCORES);
        expect(result.data.times).toEqual(TIMES);
        expect(result.data.game).toEqual(WITCHER);
        expect(result.data.site).toEqual({ siteUrl: 'https://myvideogamelist.net', indexable: true });
        expect(result.data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(policyOf(result)).toBe(CACHE_GAME);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('still renders the game, uncached, when the scores did not come', async () => {
        // The page stands without them. Kept at the edge it would go on leaving our score out for an
        // hour after the API recovered, and a day stale after that.
        stubApi({ scores: json({ title: 'Internal Server Error' }, 500) });

        const result = await run();

        expect(result.data.game).toEqual(WITCHER);
        expect(result.data.scores).toBeNull();
        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
    });

    it('still renders the game, uncached, when the times could not be reached', async () => {
        stubApi({ times: unreachable });

        const result = await run();

        expect(result.data.times).toBeNull();
        expect(result.data.scores).toEqual(SCORES);
        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
    });

    it('does not share a render made from an API older than this build', async () => {
        // Mid-deploy: scores with no tracked count. Whole as far as that API knows, and missing the
        // description's lead all the same.
        const { tracked: _, ...older } = SCORES;
        stubApi({ scores: json(older) });

        const result = await run();

        expect(policyOf(result)).toBe(PRIVATE_NO_STORE);
    });

    it('is a briefly cached 404 for a game the API does not know', async () => {
        stubApi({ game: json({ title: 'Not Found' }, 404) });

        const response = await thrown(run());

        expect(response.status).toBe(404);
        expect(response.headers.get('Cache-Control')).toBe(CACHE_NOT_FOUND);
    });

    it('is an uncached 502 when the API cannot be reached for the game, whatever the rest did', async () => {
        stubApi({ game: unreachable });

        const response = await thrown(run());

        expect(response.status).toBe(502);
        expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE);
    });

    it('asks the API nothing for an id that is not one', async () => {
        const fetchMock = stubApi({});

        const response = await thrown(run('witcher'));

        expect(response.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('GamePage headers', () => {
    const headersFor = (loaderHeaders: Headers) => headers({ loaderHeaders } as unknown as Route.HeadersArgs);

    it("sends the loader's policy, whichever it chose", () => {
        for (const policy of [CACHE_GAME, PRIVATE_NO_STORE]) {
            expect(headersFor(new Headers({ 'Cache-Control': policy }))).toEqual({ 'Cache-Control': policy });
        }
    });

    it('fails closed when the loader stated none', () => {
        expect(headersFor(new Headers())).toEqual({ 'Cache-Control': PRIVATE_NO_STORE });
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

    it('rates the game in its structured data by its members only, once enough have scored it', () => {
        const rated = videoGame(tagsFor({ scores: memberScores(MIN_MEMBER_SCORES), times: null, today: '2026-10-17' }));
        const under = videoGame(tagsFor({ scores: memberScores(MIN_MEMBER_SCORES - 1), times: null, today: '2026-10-17' }));

        expect(rated?.aggregateRating).toMatchObject({ ratingValue: 84, ratingCount: MIN_MEMBER_SCORES, bestRating: 100 });
        expect(under).toBeDefined();
        expect(under).not.toHaveProperty('aggregateRating');
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
