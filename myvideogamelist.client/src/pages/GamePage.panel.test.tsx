import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { createRoutesStub, Link, Outlet } from 'react-router';
import { AuthDialogProvider } from '@/contexts/AuthDialogProvider';
import { GamePage } from '@/pages/GamePage';
import GameOverviewPage from '@/pages/GameOverviewPage';
import GameYoursPage from '@/pages/GameYoursPage';
import { MIN_MEMBER_SCORES, ratingPercent } from '@/lib/score';
import type { CommunityScores, GameReviews } from '@/types/community';
import type { GameDto } from '@/types/game';
import type { ReviewDto, ReviewInputDto } from '@/types/playthrough';
import { type Actor, quickActor } from '@/test/actor';
import { entryDetail, game, review, userProfile } from '@/test/factories';
import { AppProviders } from '@/test/providers';
import { type ApiCall, type ApiRoutes, empty, held, json, settle, signedInRoutes, stubApi, tearDownApi } from '@/test/api';

/**
 * The game page around the reader's own entry, with the entry, the hero's row, the Your game tab, the
 * members' section and the providers all real, and the API played by a small model of the server: the
 * members' score counts the reader's own, and the reviews list theirs once it is for anyone on a public
 * profile.
 *
 * The page fetches the members' view once, after hydration, and never caches it (ADR 0028). So a
 * reader's own score or review shows on the page only if the page asks again once it has saved, or the
 * section goes on showing the game as it was, which reads as the write having failed. The entry's suite
 * asserts that it calls back; this asserts that the page is listening — across its two tabs, since the
 * score is set in the hero, the review and the delete on the Your game tab, and the members' reviews are
 * read on the Overview (ADR 0084).
 */

const ALEX = userProfile({ userName: 'alex', profileVisibility: 'public' });
const CELESTE = game({ id: 1, title: 'Celeste' });
const HADES = game({ id: 2, title: 'Hades' });

/** Everybody else's scores: one short of the floor, so the reader's own decides whether there is a figure. */
const OTHERS: number[] = Array(MIN_MEMBER_SCORES - 1).fill(8);

/** The parts of the API the page and its panel talk to, over one reader's entry for Celeste. */
function theApi(): ApiRoutes {
    let score: number | null = null;
    let own: ReviewDto | null = null;

    const scores = (): CommunityScores => {
        const all = score === null ? OTHERS : [...OTHERS, score];
        return {
            scored: all.length,
            mean: all.reduce((sum, each) => sum + each, 0) / all.length,
            distribution: Array.from({ length: 10 }, (_, i) => all.filter(each => each === i + 1).length),
            tracked: all.length,
        };
    };

    const reviews = (): GameReviews => {
        const published = own !== null && own.visibility === 'public' && ALEX.profileVisibility === 'public';
        return {
            reviews: published && own !== null
                ? [{ userName: ALEX.userName, displayName: ALEX.displayName, avatarUrl: ALEX.avatarUrl, body: own.body, hasSpoilers: own.hasSpoilers, score, createdAt: own.createdAt, updatedAt: own.updatedAt }]
                : [],
            total: published ? 1 : 0,
            next: null,
        };
    };

    return {
        ...signedInRoutes(ALEX),
        'GET /api/entries/1': () => json(entryDetail({ entry: { game: CELESTE, score }, review: own })),
        'PUT /api/entries/1/score': (call: ApiCall) => {
            score = (call.body as { score: number | null }).score;
            return empty();
        },
        'PUT /api/entries/1/review': (call: ApiCall) => {
            own = review({ id: 3, ...(call.body as ReviewInputDto) });
            return json(own);
        },
        'DELETE /api/entries/1': () => {
            score = null;
            own = null;
            return empty();
        },
        'PUT /api/lists/1': () => empty(),
        'GET /api/games/1/community-scores': () => json(scores()),
        'GET /api/games/1/reviews': () => json(reviews()),
    };
}

/** Where the page opens: the Overview, at the game's own address, or the Your game tab under it. */
type Tab = '' | '/yours';

/**
 * The page for `first` at `tab`, its loader's answer in hand as on the server, with a link to Hades's
 * same tab outside it — so the page stays mounted when it is followed, as it does from one game's page
 * to the next — once the reader's entry can take a write and the members' view has answered. The page
 * and its two tabs are as `routes.ts` has them, and the sign-in dialog is the root's.
 */
async function openGamePage(routes: ApiRoutes = theApi(), { first = CELESTE, tab = '' }: { first?: GameDto; tab?: Tab } = {}) {
    const api = stubApi(routes);
    const Stub = createRoutesStub([{
        id: 'shell',
        Component: () => <><Link to={`/games/2${tab}`}>Next game</Link><Outlet /></>,
        children: [{
            id: 'pages/GamePage',
            path: '/games/:id',
            Component: GamePage,
            loader: ({ params }) => ({ game: params.id === '2' ? HADES : CELESTE }),
            children: [
                { index: true, Component: GameOverviewPage },
                { path: 'yours', Component: GameYoursPage },
            ],
        }],
    }]);
    render(
        <AppProviders>
            <AuthDialogProvider>
                <Stub initialEntries={[`/games/${first.id}${tab}`]} hydrationData={{ loaderData: { 'pages/GamePage': { game: first } } }} />
            </AuthDialogProvider>
        </AppProviders>,
    );

    await waitFor(() => expect(screen.getByLabelText(`Your score for ${first.title}`)).toBeEnabled());
    // Both halves of the members' view are asked for together; this lets both answers land.
    await waitFor(() => expect(api.callsTo('GET', `/api/games/${first.id}/reviews`)).toHaveLength(1));
    await settle();
    return {
        api,
        /** How many times the members' score and the reviews have each been asked for. */
        communityReads: () => ({
            scores: api.callsTo('GET', `/api/games/${first.id}/community-scores`).length,
            reviews: api.callsTo('GET', `/api/games/${first.id}/reviews`).length,
        }),
    };
}

/**
 * The badges under the title, and the reader's row under them. They have no landmark or name of their
 * own; they are the rows beside the title, inside the element that holds it.
 */
const hero = () => within(screen.getByRole('heading', { level: 1, name: 'Celeste' }).parentElement!);

/** The members' score as its badge reads it out, for these scores. */
const memberScore = (scores: number[]) => {
    const mean = scores.reduce((sum, each) => sum + each, 0) / scores.length;
    return `Member score: ${ratingPercent(mean)} out of 100, from ${scores.length} scores`;
};

/** Follows one of the page's two tabs, as the reader would, and waits for it to be the one shown. */
async function openTab(actor: Actor, name: 'Overview' | 'Your game') {
    const tabs = within(screen.getByRole('navigation', { name: 'This game' }));
    await actor.click(tabs.getByRole('link', { name }));
    await waitFor(() => expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page'));
}

/** Writes a review for anyone, as the reader would, on the Your game tab. */
async function publishReview(actor: Actor, body: string) {
    await actor.type(screen.getByLabelText('What you thought'), body);
    await actor.selectOptions(screen.getByLabelText('Who can see it'), 'Anyone');
    await actor.click(screen.getByRole('button', { name: 'Save review' }));
}

afterEach(tearDownApi);

describe("GamePage after the reader's own write", () => {
    it("counts the reader's score in the members' score as soon as it saves", async () => {
        const actor = quickActor();
        const { communityReads } = await openGamePage();
        expect(hero().queryByText(/^Member score:/)).not.toBeInTheDocument();

        await actor.click(screen.getByRole('radio', { name: '9 out of 10' }));

        // Theirs is the score that takes the game over the floor, so there is a figure now.
        expect(await hero().findByText(memberScore([...OTHERS, 9]))).toBeInTheDocument();
        const section = screen.getByRole('region', { name: 'Member scores & reviews' });
        expect(within(section).getByText(memberScore([...OTHERS, 9]))).toBeInTheDocument();
        expect(communityReads()).toEqual({ scores: 2, reviews: 2 });
    });

    it("lists the reader's review among the members' once it is saved for anyone", async () => {
        // Written on the Your game tab and read on the Overview: the page, which holds the members'
        // view for both, is what has to have asked again in between.
        const actor = quickActor();
        const { communityReads } = await openGamePage();
        expect(screen.queryByRole('list', { name: 'Member reviews' })).not.toBeInTheDocument();

        await openTab(actor, 'Your game');
        await publishReview(actor, 'The B-sides are the game.');
        await waitFor(() => expect(communityReads()).toEqual({ scores: 2, reviews: 2 }));
        await openTab(actor, 'Overview');

        const listed = within(await screen.findByRole('list', { name: 'Member reviews' }));
        expect(listed.getByText('The B-sides are the game.')).toBeInTheDocument();
        expect(listed.getByRole('link', { name: 'alex' })).toBeInTheDocument();
        expect(listed.getByText('You')).toBeInTheDocument();
    });

    it("takes the reader's score and review back out once they delete everything they recorded", async () => {
        // The score in the hero, the review and the delete on the Your game tab, and the reviews on the
        // Overview: the hero's badge says the delete was heard on the tab it was made from, and the
        // Overview's list when the reader goes back to it.
        const actor = quickActor();
        await openGamePage(theApi(), { tab: '/yours' });
        await actor.click(screen.getByRole('radio', { name: '9 out of 10' }));
        await hero().findByText(memberScore([...OTHERS, 9]));
        await publishReview(actor, 'Gone soon.');
        await openTab(actor, 'Overview');
        await screen.findByRole('list', { name: 'Member reviews' });

        await openTab(actor, 'Your game');
        await actor.click(screen.getByRole('button', { name: /delete my data/i }));
        await actor.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(hero().queryByText(/^Member score:/)).not.toBeInTheDocument());
        await openTab(actor, 'Overview');
        expect(screen.getByRole('region', { name: 'Member scores & reviews' })).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Member reviews' })).not.toBeInTheDocument();
    });

    it('does not ask again over a change of list, which the section does not show', async () => {
        const actor = quickActor();
        const { api, communityReads } = await openGamePage();

        // The hero's select of the lists besides the Backlog, for a game in none of them.
        await actor.selectOptions(hero().getByLabelText('Add to another list'), 'Playing');
        await waitFor(() => expect(api.callsTo('PUT', '/api/lists/1')).toHaveLength(1));
        await settle();

        expect(communityReads()).toEqual({ scores: 1, reviews: 1 });
    });
});

describe('GamePage from one game to the next', () => {
    it("does not let a save still out for one game land in the next game's entry", async () => {
        // The page stays mounted when a link goes to another game, and the entry is keyed on the
        // game so that it does not: kept, it would write the first game's notes into the second's.
        const actor = quickActor();
        const save = held();
        await openGamePage({
            ...signedInRoutes(ALEX),
            'GET /api/entries/1': () => empty(404),
            'GET /api/entries/2': () => empty(404),
            'PUT /api/entries/1/notes': () => save.answer,
        }, { tab: '/yours' });

        await actor.type(screen.getByLabelText('Your notes'), 'Strawberries first.');
        await actor.click(screen.getByRole('button', { name: 'Save notes' }));
        await actor.click(screen.getByRole('link', { name: 'Next game' }));
        await screen.findByRole('heading', { level: 1, name: 'Hades' });
        await waitFor(() => expect(screen.getByLabelText('Your score for Hades')).toBeEnabled());

        await act(async () => save.release(empty()));
        await settle();

        expect(screen.getByLabelText('Your notes')).toHaveValue('');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
