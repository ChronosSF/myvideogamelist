import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gameCommunityReducer, useGameCommunity } from '@/hooks/useGameCommunity';
import type { GameCommunityState } from '@/hooks/useGameCommunity';
import type { CommunityScores, GameReview, GameReviews } from '@/types/community';

/** A scores document told apart by how many members scored, which is all these tests read. */
function scores(scored: number): CommunityScores {
    return { scored, mean: scored === 0 ? null : 8, distribution: [0, 0, 0, 0, 0, 0, 0, scored, 0, 0] };
}

function review(userName: string): GameReview {
    return {
        userName,
        body: `${userName} wrote this.`,
        hasSpoilers: false,
        score: null,
        createdAt: '2026-09-01T10:00:00+00:00',
        updatedAt: '2026-09-01T10:00:00+00:00',
    };
}

function reviewsPage(names: string[], total: number, page = 1, pageSize = 10): GameReviews {
    return { reviews: names.map(review), total, page, pageSize };
}

/**
 * Answers the API from a table of URLs, each with a script of answers, one per request and
 * repeating the last. An answer is a JSON body, or one of `'fail'` (a 500), `'unreachable'` (a
 * rejected fetch) and `'held'` — not answered until the test releases it with a body, which is how a
 * request for one game is kept open across a navigation to the next.
 */
function stubApi(routes: Record<string, unknown[]>) {
    const counts = new Map<string, number>();
    const held: Array<(body: unknown) => void> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        const script = routes[url];
        if (script === undefined) throw new Error(`unexpected fetch: ${url}`);

        const index = counts.get(url) ?? 0;
        counts.set(url, index + 1);
        const answer = script[Math.min(index, script.length - 1)];

        if (answer === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
        if (answer === 'fail') return Promise.resolve(new Response('nope', { status: 500 }));
        if (answer === 'held') {
            return new Promise<Response>(resolve => {
                held.push(body => resolve(new Response(JSON.stringify(body), { status: 200 })));
            });
        }
        return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    return {
        fetchMock,
        /** Answers the oldest held request and flushes everything it causes. */
        release: (body: unknown) => act(async () => {
            held.shift()?.(body);
            await new Promise(resolve => setTimeout(resolve, 0));
        }),
    };
}

function Probe({ gameId }: { gameId: number }) {
    const community = useGameCommunity(gameId);
    return (
        <div>
            <span data-testid="settled">{String(community.settled)}</span>
            <span data-testid="scored">{community.scores === null ? 'none' : String(community.scores.scored)}</span>
            <span data-testid="reviews">{community.reviews.map(r => r.userName).join(',')}</span>
            <span data-testid="total">{community.total === null ? 'none' : String(community.total)}</span>
            <span data-testid="more">{String(community.hasMore)}</span>
            <span data-testid="more-failed">{String(community.moreFailed)}</span>
            <button type="button" onClick={community.loadMore}>more</button>
        </div>
    );
}

const text = (id: string) => screen.getByTestId(id);

afterEach(() => vi.unstubAllGlobals());

describe('useGameCommunity', () => {
    it('asks both public endpoints for the game, without credentials', async () => {
        // Both halves are the same for every reader, so there is nothing to send a cookie for.
        const { fetchMock } = stubApi({
            '/api/games/1942/community-scores': [scores(0)],
            '/api/games/1942/reviews': [reviewsPage([], 0)],
        });
        render(<Probe gameId={1942} />);
        await waitFor(() => expect(text('settled')).toHaveTextContent('true'));

        expect(fetchMock.mock.calls.map(call => String(call[0])).sort())
            .toEqual(['/api/games/1942/community-scores', '/api/games/1942/reviews']);
        for (const call of fetchMock.mock.calls) expect(call[1]?.credentials).toBeUndefined();
    });

    it('settles once, with both answers together', async () => {
        // The section appears once rather than growing twice, so neither half lands alone.
        const { release } = stubApi({
            '/api/games/1/community-scores': [scores(6)],
            '/api/games/1/reviews': ['held'],
        });
        render(<Probe gameId={1} />);
        await act(async () => {});

        expect(text('settled')).toHaveTextContent('false');
        expect(text('scored')).toHaveTextContent('none');

        await release(reviewsPage(['alex'], 1));

        expect(text('settled')).toHaveTextContent('true');
        expect(text('scored')).toHaveTextContent('6');
        expect(text('reviews')).toHaveTextContent('alex');
        expect(text('total')).toHaveTextContent('1');
    });

    it('keeps the half that answered when the other fails', async () => {
        stubApi({
            '/api/games/1/community-scores': [scores(6)],
            '/api/games/1/reviews': ['fail'],
        });
        render(<Probe gameId={1} />);

        await waitFor(() => expect(text('settled')).toHaveTextContent('true'));
        expect(text('scored')).toHaveTextContent('6');
        // Null, not zero: nobody is being reported as having written nothing.
        expect(text('total')).toHaveTextContent('none');
    });

    it('settles rather than loading forever when the API is unreachable', async () => {
        // `fetch` rejects when nothing answers; a hook that only checked `response.ok` would hang.
        stubApi({
            '/api/games/1/community-scores': ['unreachable'],
            '/api/games/1/reviews': ['unreachable'],
        });
        render(<Probe gameId={1} />);

        await waitFor(() => expect(text('settled')).toHaveTextContent('true'));
        expect(text('scored')).toHaveTextContent('none');
        expect(text('total')).toHaveTextContent('none');
    });

    it('appends the next page when asked, and stops offering one at the end', async () => {
        const firstTen = Array.from({ length: 10 }, (_, i) => `member${i}`);
        const { fetchMock } = stubApi({
            '/api/games/1/community-scores': [scores(0)],
            '/api/games/1/reviews': [reviewsPage(firstTen, 12)],
            '/api/games/1/reviews?page=2': [reviewsPage(['member10', 'member11'], 12, 2)],
        });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));

        await userEvent.click(screen.getByRole('button', { name: 'more' }));

        await waitFor(() => expect(text('reviews')).toHaveTextContent('member10,member11'));
        expect(text('reviews').textContent?.split(',')).toHaveLength(12);
        expect(text('more')).toHaveTextContent('false');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('reports a failed next page, keeps what it has, and can try again', async () => {
        const firstTen = Array.from({ length: 10 }, (_, i) => `member${i}`);
        stubApi({
            '/api/games/1/community-scores': [scores(0)],
            '/api/games/1/reviews': [reviewsPage(firstTen, 11)],
            '/api/games/1/reviews?page=2': ['unreachable', reviewsPage(['member10'], 11, 2)],
        });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));

        await userEvent.click(screen.getByRole('button', { name: 'more' }));
        await waitFor(() => expect(text('more-failed')).toHaveTextContent('true'));
        expect(text('reviews').textContent?.split(',')).toHaveLength(10);
        expect(text('more')).toHaveTextContent('true');

        await userEvent.click(screen.getByRole('button', { name: 'more' }));
        await waitFor(() => expect(text('reviews')).toHaveTextContent('member10'));
        expect(text('more-failed')).toHaveTextContent('false');
    });

    it("clears the previous game's figures before the next game answers", async () => {
        // The page stays mounted when a link goes from one game to another, so the members' view of
        // the last game must not sit under the new game's title while the new one loads.
        const { release } = stubApi({
            '/api/games/1/community-scores': [scores(6)],
            '/api/games/1/reviews': [reviewsPage(['alex'], 1)],
            '/api/games/2/community-scores': [scores(9)],
            '/api/games/2/reviews': ['held'],
        });
        const view = render(<Probe gameId={1} />);
        await waitFor(() => expect(text('scored')).toHaveTextContent('6'));

        view.rerender(<Probe gameId={2} />);

        expect(text('settled')).toHaveTextContent('false');
        expect(text('scored')).toHaveTextContent('none');
        expect(text('reviews')).toBeEmptyDOMElement();

        await release(reviewsPage(['sam'], 1));
        await waitFor(() => expect(text('scored')).toHaveTextContent('9'));
        expect(text('reviews')).toHaveTextContent('sam');
    });

    it('drops a late answer for the previous game', async () => {
        const { release } = stubApi({
            '/api/games/1/community-scores': [scores(6)],
            '/api/games/1/reviews': ['held'],
            '/api/games/2/community-scores': [scores(9)],
            '/api/games/2/reviews': [reviewsPage(['sam'], 1)],
        });
        const view = render(<Probe gameId={1} />);

        view.rerender(<Probe gameId={2} />);
        await waitFor(() => expect(text('reviews')).toHaveTextContent('sam'));

        await release(reviewsPage(['alex'], 1));

        expect(text('reviews')).toHaveTextContent('sam');
        expect(text('scored')).toHaveTextContent('9');
    });
});

describe('gameCommunityReducer', () => {
    /*
     * The frame these pin cannot be reached through the hook under jsdom: `act` flushes render,
     * commit and passive effects together, so the request is always aborted before a stale answer
     * can land, and "drops a late answer" above passes on the abort alone. In a browser the cleanup
     * runs after the commit, and a response resolving in between reaches the reducer carrying the
     * previous game's stamp. This is what stops it — see ADR 0022.
     */
    const onGameTwo: GameCommunityState = {
        gameId: 2,
        settled: true,
        scores: scores(9),
        reviews: [review('sam')],
        total: 11,
        page: 1,
        pageSize: 10,
        loadingMore: false,
        moreFailed: false,
    };

    it('drops the first answers when they are stamped with a game no longer on screen', () => {
        const next = gameCommunityReducer(onGameTwo, {
            type: 'SETTLED', gameId: 1, scores: scores(6), reviews: reviewsPage(['alex'], 1),
        });

        expect(next).toBe(onGameTwo);
    });

    it('drops a further page stamped with a game no longer on screen', () => {
        const next = gameCommunityReducer(onGameTwo, {
            type: 'MORE_SUCCESS', gameId: 1, reviews: reviewsPage(['alex'], 11, 2),
        });

        expect(next).toBe(onGameTwo);
    });

    it('does not list a review twice when the pages have moved underneath the reader', () => {
        // A review rewritten while somebody reads jumps to the top and pushes the rest down, so the
        // next page can open with the review that closed the last one.
        const next = gameCommunityReducer(onGameTwo, {
            type: 'MORE_SUCCESS', gameId: 2, reviews: reviewsPage(['sam', 'nadia'], 12, 2),
        });

        expect(next.reviews.map(r => r.userName)).toEqual(['sam', 'nadia']);
        expect(next.page).toBe(2);
        expect(next.total).toBe(12);
    });

    it('starts a new game from nothing', () => {
        const next = gameCommunityReducer({ ...onGameTwo, moreFailed: true }, { type: 'RESET', gameId: 3 });

        expect(next).toEqual({
            gameId: 3,
            settled: false,
            scores: null,
            reviews: [],
            total: null,
            page: 0,
            pageSize: 0,
            loadingMore: false,
            moreFailed: false,
        });
    });
});
