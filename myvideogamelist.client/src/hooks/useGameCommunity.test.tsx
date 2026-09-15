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

/** A page of reviews by these authors. `next` is opaque to the client, so any string will do. */
function reviewsPage(names: string[], total: number, next: string | null = null): GameReviews {
    return { reviews: names.map(review), total, next };
}

const TEN = Array.from({ length: 10 }, (_, i) => `member${i}`);

/**
 * Answers the API from a table of URLs, each with a script of answers, one per request and
 * repeating the last. An answer is a JSON body, or one of `'fail'` (a 500), `'unreachable'` (a
 * rejected fetch) and `'held'` — not answered until the test releases it with a body, which is how a
 * request is kept open across a navigation or a reload.
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
            <button type="button" onClick={community.reload}>reload</button>
        </div>
    );
}

const text = (id: string) => screen.getByTestId(id);

afterEach(() => vi.unstubAllGlobals());

describe('useGameCommunity', () => {
    it('asks both public endpoints for the game, and sends no cookie', async () => {
        // Both halves are the same for every reader. `fetch` would send the sign-in cookie to our own
        // origin unless told not to, so "no credentials" has to be said rather than left unset.
        const { fetchMock } = stubApi({
            '/api/games/1942/community-scores': [scores(0)],
            '/api/games/1942/reviews': [reviewsPage([], 0)],
        });
        render(<Probe gameId={1942} />);
        await waitFor(() => expect(text('settled')).toHaveTextContent('true'));

        expect(fetchMock.mock.calls.map(call => String(call[0])).sort())
            .toEqual(['/api/games/1942/community-scores', '/api/games/1942/reviews']);
        for (const call of fetchMock.mock.calls) expect(call[1]?.credentials).toBe('omit');
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

    it('asks for the next page by the cursor the last one ended with, and stops at the end', async () => {
        // Never by page number: rows move while somebody reads, and an offset then skips a review.
        const { fetchMock } = stubApi({
            '/api/games/1/community-scores': [scores(0)],
            '/api/games/1/reviews': [reviewsPage(TEN, 12, '638930.member9')],
            '/api/games/1/reviews?after=638930.member9': [reviewsPage(['member10', 'member11'], 12)],
        });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));

        await userEvent.click(screen.getByRole('button', { name: 'more' }));

        await waitFor(() => expect(text('reviews')).toHaveTextContent('member10,member11'));
        expect(text('reviews').textContent?.split(',')).toHaveLength(12);
        expect(text('more')).toHaveTextContent('false');
        expect(fetchMock.mock.calls[2][1]?.credentials).toBe('omit');
    });

    it('carries a cursor into the URL intact, whatever it holds', async () => {
        // Opaque to the client, so it is escaped rather than trusted to be URL-safe.
        const { fetchMock } = stubApi({
            '/api/games/1/community-scores': [scores(0)],
            '/api/games/1/reviews': [reviewsPage(TEN, 11, '1.a&b')],
            '/api/games/1/reviews?after=1.a%26b': [reviewsPage(['member10'], 11)],
        });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));

        await userEvent.click(screen.getByRole('button', { name: 'more' }));

        await waitFor(() => expect(text('reviews')).toHaveTextContent('member10'));
        expect(String(fetchMock.mock.calls[2][0])).toBe('/api/games/1/reviews?after=1.a%26b');
    });

    it('reports a failed next page, keeps what it has, and can try again', async () => {
        stubApi({
            '/api/games/1/community-scores': [scores(0)],
            '/api/games/1/reviews': [reviewsPage(TEN, 11, 'c1')],
            '/api/games/1/reviews?after=c1': ['unreachable', reviewsPage(['member10'], 11)],
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

describe('useGameCommunity reload', () => {
    it('asks again and shows the new answer, without emptying the section while it waits', async () => {
        // The reader has just scored or reviewed the game; blanking what they were looking at while
        // the refresh is out would read as their change having wiped it.
        const { release } = stubApi({
            '/api/games/1/community-scores': [scores(6), 'held'],
            '/api/games/1/reviews': [reviewsPage(['alex'], 1), 'held'],
        });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(text('scored')).toHaveTextContent('6'));

        await userEvent.click(screen.getByRole('button', { name: 'reload' }));

        expect(text('settled')).toHaveTextContent('true');
        expect(text('scored')).toHaveTextContent('6');
        expect(text('reviews')).toHaveTextContent('alex');

        await release(scores(7));
        await release(reviewsPage(['sam', 'alex'], 2));

        expect(text('scored')).toHaveTextContent('7');
        expect(text('reviews')).toHaveTextContent('sam,alex');
        expect(text('total')).toHaveTextContent('2');
    });

    it('keeps what was on screen when the reload fails', async () => {
        const { fetchMock } = stubApi({
            '/api/games/1/community-scores': [scores(6), 'unreachable'],
            '/api/games/1/reviews': [reviewsPage(['alex'], 1), 'fail'],
        });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(text('scored')).toHaveTextContent('6'));

        await userEvent.click(screen.getByRole('button', { name: 'reload' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        await act(async () => {});

        expect(text('scored')).toHaveTextContent('6');
        expect(text('reviews')).toHaveTextContent('alex');
        expect(text('total')).toHaveTextContent('1');
    });

    it('starts the list again from the first page', async () => {
        // The reader's own review may now sit anywhere in it, so the pages already open are stale.
        stubApi({
            '/api/games/1/community-scores': [scores(0)],
            '/api/games/1/reviews': [reviewsPage(TEN, 11, 'c1'), reviewsPage(TEN, 11, 'c1')],
            '/api/games/1/reviews?after=c1': [reviewsPage(['member10'], 11)],
        });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));
        await userEvent.click(screen.getByRole('button', { name: 'more' }));
        await waitFor(() => expect(text('reviews')).toHaveTextContent('member10'));

        await userEvent.click(screen.getByRole('button', { name: 'reload' }));

        await waitFor(() => expect(text('more')).toHaveTextContent('true'));
        expect(text('reviews').textContent?.split(',')).toEqual(TEN);
    });
});

describe('gameCommunityReducer', () => {
    /*
     * The frames these pin cannot be reached through the hook under jsdom: `act` flushes render,
     * commit and passive effects together, so a request is always aborted before a stale answer can
     * land, and the late-answer tests above pass on the abort alone. In a browser the cleanup runs
     * after the commit, and a response resolving in between reaches the reducer carrying a stamp that
     * no longer matches. This is what stops it — see ADR 0022.
     */
    const onGameTwo: GameCommunityState = {
        gameId: 2,
        settled: true,
        scores: scores(9),
        reviews: [review('sam')],
        total: 11,
        next: 'c1',
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
            type: 'MORE_SUCCESS', gameId: 1, after: 'c1', reviews: reviewsPage(['alex'], 11),
        });

        expect(next).toBe(onGameTwo);
    });

    it('appends a page that continues from where the list ends', () => {
        const next = gameCommunityReducer({ ...onGameTwo, loadingMore: true }, {
            type: 'MORE_SUCCESS', gameId: 2, after: 'c1', reviews: reviewsPage(['nadia'], 12, 'c2'),
        });

        expect(next.reviews.map(r => r.userName)).toEqual(['sam', 'nadia']);
        expect(next.next).toBe('c2');
        expect(next.total).toBe(12);
        expect(next.loadingMore).toBe(false);
    });

    it('drops a page that continues from somewhere the list no longer ends', () => {
        // Asked for before a reload replaced the list, or by a second click after the first had
        // already appended: either way it would put reviews after the wrong one.
        const next = gameCommunityReducer(onGameTwo, {
            type: 'MORE_SUCCESS', gameId: 2, after: 'c0', reviews: reviewsPage(['alex'], 11),
        });

        expect(next).toBe(onGameTwo);
    });

    it('drops a failure for a page that no longer continues the list', () => {
        const next = gameCommunityReducer(onGameTwo, { type: 'MORE_ERROR', gameId: 2, after: 'c0' });

        expect(next).toBe(onGameTwo);
    });

    it('keeps each half a reload failed to fetch, and takes the half it did', () => {
        const next = gameCommunityReducer({ ...onGameTwo, loadingMore: true }, {
            type: 'SETTLED', gameId: 2, scores: null, reviews: reviewsPage(['nadia', 'sam'], 12),
        });

        expect(next.scores?.scored).toBe(9);
        expect(next.reviews.map(r => r.userName)).toEqual(['nadia', 'sam']);
        // A reload cancels a "show more" still in flight, so nothing else would clear it.
        expect(next.loadingMore).toBe(false);
    });

    it('has nothing to keep when the first load fails', () => {
        const next = gameCommunityReducer(
            { ...onGameTwo, settled: false, scores: null, reviews: [], total: null, next: null },
            { type: 'SETTLED', gameId: 2, scores: null, reviews: null },
        );

        expect(next.settled).toBe(true);
        expect(next.scores).toBeNull();
        expect(next.total).toBeNull();
    });

    it('starts a new game from nothing', () => {
        const next = gameCommunityReducer({ ...onGameTwo, moreFailed: true }, { type: 'RESET', gameId: 3 });

        expect(next).toEqual({
            gameId: 3,
            settled: false,
            scores: null,
            reviews: [],
            total: null,
            next: null,
            loadingMore: false,
            moreFailed: false,
        });
    });
});
