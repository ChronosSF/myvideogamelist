import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { createRoutesStub, Link, Outlet, type MetaDescriptor } from 'react-router';
import { GamePage, meta } from '@/pages/GamePage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import { MIN_MEMBER_SCORES, MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import type { UserProfile } from '@/types/auth';
import type { CommunityScores } from '@/types/community';
import { communityScores, communityTimes, game, gameDetails, userProfile } from '@/test/factories';
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

// The members' section has a suite of its own. Here it says only whose scores the page handed it,
// once it would show anything at all, so that the page's choice between the loader's and the
// browser's can be read off the section as well as off the hero.
vi.mock('@/components/GameCommunity', () => ({
    GameCommunity: ({ community: shown }: { community: UseGameCommunityResult }) =>
        shown.settled && shown.scores ? <p>{`The section's ${shown.scores.scored} scores`}</p> : null,
}));

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
    return communityScores({ scored: members, mean, distribution: [0, 0, 0, 0, 0, 0, 0, members, 0, 0], tracked: members });
}

/** The route, with the scores the loader read beside the game already in hand. */
function withLoaded(scores: CommunityScores | null) {
    const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
    return <Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: CELESTE, scores } } }} />;
}

/** The hero's text block: the title and the badges under it. */
const hero = () => screen.getByRole('heading', { level: 1, name: 'Celeste' }).parentElement!;

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
        // hero and with its count in words in the sidebar (ADR 0069). A badge that waited for
        // hydration, or for an effect to copy the loader's scores, would be missing from this.
        const html = renderToString(withLoaded(memberScores(23)));

        expect(html).toContain('Celeste');
        // The hero's badge and the sidebar's, each in its tooltip and in its accessible name.
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
        const hades = game({ id: 2, title: 'Hades' });
        const Stub = createRoutesStub([{
            Component: () => <><Link to="/games/2">Next game</Link><Outlet /></>,
            children: [{
                id: 'game',
                path: '/games/:id',
                Component: GamePage,
                loader: () => ({ game: hades, scores: null }),
            }],
        }]);
        render(<Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: CELESTE, scores: memberScores(23) } } }} />);
        expect(within(hero()).getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole('link', { name: 'Next game' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Hades' })).toBeInTheDocument();
        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
    });
});

describe("GamePage sidebar's member score", () => {
    it('says how many scores it is from, in words, like the critic score above it', () => {
        render(withLoaded(memberScores(23)));

        const sidebar = screen.getByRole('complementary');
        expect(within(sidebar).getByText('Member Score')).toBeInTheDocument();
        expect(within(sidebar).getByText('from 23 scores')).toBeInTheDocument();
        expect(within(sidebar).getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
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
