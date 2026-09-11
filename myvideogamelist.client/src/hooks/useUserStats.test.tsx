import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUserStats, userStatsReducer } from '@/hooks/useUserStats';
import type { UserStatsState } from '@/hooks/useUserStats';
import type { UserStats } from '@/types/stats';

/** A stats document told apart by its tracked count, which is all these tests read. */
function stats(tracked: number): UserStats {
    return {
        library: {
            tracked,
            recorded: tracked,
            wishlisted: 0,
            byStatus: { backlog: tracked, playing: 0, on_hold: 0, finished: 0, dropped: 0 },
            completionRate: null,
        },
        scores: { scored: 0, mean: null, distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        activity: {
            logStartedAt: null,
            months: [],
            transitions: 0,
            currentStreakMonths: 0,
            longestStreakMonths: 0,
            timeToFinish: null,
        },
        playtime: { playthroughs: 0, totalMinutes: 0, withHours: 0, byPlatform: [] },
    };
}

type Answer = number | 'fail' | 'unreachable' | 'held';

/**
 * Answers `/api/user/stats` from a script, one entry per request, repeating the last. A `held`
 * entry is not answered until the test releases it, which is how a request from one account is
 * kept open across a sign-in by the next.
 */
function stubStats(answers: Answer[]) {
    let index = 0;
    const held: Array<(tracked: number) => void> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url !== '/api/user/stats') throw new Error(`unexpected fetch: ${url}`);

        const answer = answers[Math.min(index++, answers.length - 1)];
        if (answer === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
        if (answer === 'fail') return Promise.resolve(new Response('nope', { status: 500 }));
        if (answer === 'held') {
            return new Promise<Response>(resolve => {
                held.push(tracked =>
                    resolve(new Response(JSON.stringify(stats(tracked)), { status: 200 })));
            });
        }
        return Promise.resolve(new Response(JSON.stringify(stats(answer)), { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    return {
        fetchMock,
        /** Answers the oldest held request and flushes everything it causes. */
        release: (tracked: number) => act(async () => {
            held.shift()?.(tracked);
            await new Promise(resolve => setTimeout(resolve, 0));
        }),
    };
}

function Probe({ account }: { account: string | null }) {
    const { stats, loading, error, reload } = useUserStats(account);
    return (
        <div>
            <span data-testid="loading">{String(loading)}</span>
            <span data-testid="tracked">{stats === null ? 'none' : String(stats.library.tracked)}</span>
            <span data-testid="error">{error ?? ''}</span>
            <button type="button" onClick={reload}>reload</button>
        </div>
    );
}

const tracked = () => screen.getByTestId('tracked');
const loading = () => screen.getByTestId('loading');

afterEach(() => vi.unstubAllGlobals());

describe('useUserStats', () => {
    it('fetches nothing while nobody is signed in', () => {
        const { fetchMock } = stubStats([1]);
        render(<Probe account={null} />);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(loading()).toHaveTextContent('false');
        expect(tracked()).toHaveTextContent('none');
    });

    it('loads the signed-in account', async () => {
        stubStats([7]);
        render(<Probe account="alice" />);

        expect(loading()).toHaveTextContent('true');
        await waitFor(() => expect(tracked()).toHaveTextContent('7'));
        expect(loading()).toHaveTextContent('false');
    });

    it('clears the previous account before the next one answers', async () => {
        // Cleared on the transition rather than when the new fetch lands, so a slow or failing
        // load for the next account cannot leave the previous account's figures on screen.
        const { release } = stubStats([7, 'held']);
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(tracked()).toHaveTextContent('7'));

        view.rerender(<Probe account="bob" />);

        expect(tracked()).toHaveTextContent('none');
        expect(loading()).toHaveTextContent('true');

        await release(3);
        await waitFor(() => expect(tracked()).toHaveTextContent('3'));
    });

    it('drops a late answer from the previous account', async () => {
        // The first account's request is still open when the second signs in, so its answer
        // arrives after the switch and must not be written under the new name.
        const { release } = stubStats(['held', 3]);
        const view = render(<Probe account="alice" />);

        view.rerender(<Probe account="bob" />);
        await waitFor(() => expect(tracked()).toHaveTextContent('3'));

        await release(7);

        expect(tracked()).toHaveTextContent('3');
    });

    it('goes back to nothing on sign-out', async () => {
        stubStats([7]);
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(tracked()).toHaveTextContent('7'));

        view.rerender(<Probe account={null} />);

        expect(tracked()).toHaveTextContent('none');
        expect(loading()).toHaveTextContent('false');
    });

    it('fetches again on reload', async () => {
        const { fetchMock } = stubStats([7, 9]);
        render(<Probe account="alice" />);
        await waitFor(() => expect(tracked()).toHaveTextContent('7'));

        await userEvent.click(screen.getByRole('button', { name: 'reload' }));

        await waitFor(() => expect(tracked()).toHaveTextContent('9'));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports an unreachable API rather than loading forever', async () => {
        // `fetch` rejects when nothing answers; a hook that only checked `response.ok` would hang.
        stubStats(['unreachable']);
        render(<Probe account="alice" />);

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Failed to fetch'));
        expect(loading()).toHaveTextContent('false');
    });
});

describe('userStatsReducer', () => {
    /*
     * The frame these pin cannot be reached through the hook under jsdom: `act` flushes render,
     * commit and passive effects together on the way out, so the request is always aborted before
     * a stale answer can land, and "drops a late answer" above passes on the abort alone. In a
     * browser the cleanup runs after the commit, and a response resolving in between reaches the
     * reducer carrying the previous account's stamp. This is what stops it — see ADR 0022.
     */
    const bob: UserStatsState = { account: 'bob', stats: null, loading: true, error: null };

    it('drops a success stamped with an account that is no longer current', () => {
        const next = userStatsReducer(bob, { type: 'FETCH_SUCCESS', account: 'alice', stats: stats(7) });

        expect(next).toBe(bob);
    });

    it('drops an error stamped with an account that is no longer current', () => {
        const next = userStatsReducer(bob, { type: 'FETCH_ERROR', account: 'alice', error: 'nope' });

        expect(next).toBe(bob);
    });

    it('keeps a success stamped with the current account', () => {
        const next = userStatsReducer(bob, { type: 'FETCH_SUCCESS', account: 'bob', stats: stats(3) });

        expect(next.stats?.library.tracked).toBe(3);
        expect(next.loading).toBe(false);
    });

    it('starts a new account from nothing', () => {
        const alice: UserStatsState = { account: 'alice', stats: stats(7), loading: false, error: 'old' };

        const next = userStatsReducer(alice, { type: 'FETCH_START', account: 'bob' });

        expect(next).toEqual({ account: 'bob', stats: null, loading: true, error: null });
    });

    it('marks the same account as loading without discarding its figures', () => {
        // The same account asking again is a reload, not a transition: nothing held belongs to
        // somebody else, so there is nothing to clear.
        const alice: UserStatsState = { account: 'alice', stats: stats(7), loading: false, error: 'old' };

        const next = userStatsReducer(alice, { type: 'FETCH_START', account: 'alice' });

        expect(next.stats?.library.tracked).toBe(7);
        expect(next.loading).toBe(true);
        expect(next.error).toBeNull();
    });
});
