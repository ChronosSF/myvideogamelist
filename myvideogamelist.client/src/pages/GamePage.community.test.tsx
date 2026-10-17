import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub } from 'react-router';
import { GamePage } from '@/pages/GamePage';
import { MIN_MEMBER_SCORES, ratingPercent } from '@/lib/score';
import type { CommunityScores, GameReviews } from '@/types/community';
import type { ReviewDto, ReviewInputDto } from '@/types/playthrough';
import { entryDetail, game, review, userProfile } from '@/test/factories';
import { AppProviders } from '@/test/providers';
import { type ApiCall, type ApiRoutes, empty, json, stubApi } from '@/test/api';

/**
 * The game page with the reader's own panel and the members' section both real, and the API played
 * by a small model of the server: the members' score counts the reader's own, and the reviews list
 * theirs once it is for anyone on a public profile.
 *
 * The page fetches that view once, after hydration, and never caches it (ADR 0028). So a reader's
 * own score or review shows beside the panel only if the page asks again once it has saved — or
 * the section goes on showing the game as it was, which reads as the write having failed. The panel's
 * suite asserts that it calls back; this asserts that the page is listening.
 */

const ALEX = userProfile({ userName: 'alex', profileVisibility: 'public' });
const CELESTE = game({ id: 1, title: 'Celeste' });

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
        };
    };

    const reviews = (): GameReviews => {
        const published = own !== null && own.visibility === 'public' && ALEX.profileVisibility === 'public';
        return {
            reviews: published && own !== null
                ? [{ userName: ALEX.userName, body: own.body, hasSpoilers: own.hasSpoilers, score, createdAt: own.createdAt, updatedAt: own.updatedAt }]
                : [],
            total: published ? 1 : 0,
            next: null,
        };
    };

    return {
        'GET /api/auth/me': () => json(ALEX),
        'GET /api/lists': () => json({ lists: {} }),
        'GET /api/user/list-preferences': () => json({ view: 'tiles', sorts: {}, names: {} }),
        'GET /api/wishlist': () => json([]),
        'GET /api/favourites': () => json([]),
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

/** The page, its loader's answer in hand as on the server, once the panel and the section have loaded. */
async function openGamePage() {
    const api = stubApi(theApi());
    const Stub = createRoutesStub([{ id: 'game', path: '/games/:id', Component: GamePage }]);
    render(
        <AppProviders>
            <Stub initialEntries={['/games/1']} hydrationData={{ loaderData: { game: { game: CELESTE } } }} />
        </AppProviders>,
    );

    await waitFor(() => expect(screen.getByLabelText('Your score for Celeste')).toBeEnabled());
    await waitFor(() => expect(api.callsTo('GET', '/api/games/1/reviews')).toHaveLength(1));
    return { api, communityReads: () => api.callsTo('GET', '/api/games/1/community-scores').length };
}

/** The badges under the title. */
const hero = () => within(screen.getByRole('heading', { level: 1, name: 'Celeste' }).parentElement!);

/** The members' score as its badge reads it out, for these scores. */
const memberScore = (scores: number[]) => {
    const mean = scores.reduce((sum, each) => sum + each, 0) / scores.length;
    return `Member score: ${ratingPercent(mean)} out of 100, from ${scores.length} scores`;
};

/** Skips user-event's pause between keystrokes, which costs a timer per character. */
const setupActor = () => userEvent.setup({ delay: null });

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("GamePage after the reader's own write", () => {
    it("counts the reader's score in the members' score as soon as it saves", async () => {
        const actor = setupActor();
        const { communityReads } = await openGamePage();
        expect(hero().queryByText(/^Member score:/)).not.toBeInTheDocument();

        await actor.click(screen.getByRole('radio', { name: '9 out of 10' }));

        // Theirs is the score that takes the game over the floor, so there is a figure now.
        expect(await hero().findByText(memberScore([...OTHERS, 9]))).toBeInTheDocument();
        const section = screen.getByRole('region', { name: 'Member scores & reviews' });
        expect(within(section).getByText(memberScore([...OTHERS, 9]))).toBeInTheDocument();
        expect(communityReads()).toBe(2);
    });

    it("lists the reader's review among the members' once it is saved for anyone", async () => {
        const actor = setupActor();
        await openGamePage();
        expect(screen.queryByRole('list', { name: 'Member reviews' })).not.toBeInTheDocument();

        await actor.type(screen.getByLabelText('What you thought'), 'The B-sides are the game.');
        await actor.selectOptions(screen.getByLabelText('Who can see it'), 'Anyone');
        await actor.click(screen.getByRole('button', { name: 'Save review' }));

        const listed = within(await screen.findByRole('list', { name: 'Member reviews' }));
        expect(listed.getByText('The B-sides are the game.')).toBeInTheDocument();
        expect(listed.getByRole('link', { name: 'alex' })).toBeInTheDocument();
        expect(listed.getByText('You')).toBeInTheDocument();
    });

    it('takes them back out once the reader deletes everything they recorded', async () => {
        const actor = setupActor();
        await openGamePage();
        await actor.click(screen.getByRole('radio', { name: '9 out of 10' }));
        await hero().findByText(memberScore([...OTHERS, 9]));

        await actor.click(screen.getByRole('button', { name: /delete my data/i }));
        await actor.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(hero().queryByText(/^Member score:/)).not.toBeInTheDocument());
    });

    it('does not ask again over a change of list, which the section does not show', async () => {
        const actor = setupActor();
        const { api, communityReads } = await openGamePage();

        await actor.click(screen.getByRole('button', { name: 'Playing' }));
        await waitFor(() => expect(api.callsTo('PUT', '/api/lists/1')).toHaveLength(1));

        expect(communityReads()).toBe(1);
    });
});
