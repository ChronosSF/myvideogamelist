import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { communityTimesReducer, useCommunityTimes } from '@/hooks/useCommunityTimes';
import type { CommunityTimesState } from '@/hooks/useCommunityTimes';
import type { CommunityTimes } from '@/types/playthrough';

/** A times document told apart by the playthroughs behind its middle tier, which is all these tests read. */
function times(samples: number): CommunityTimes {
    return {
        buckets: [
            { type: 'rushed', samples: 0, medianMinutes: null },
            { type: 'normally', samples, medianMinutes: 130 * 60 },
            { type: 'completionist', samples: 0, medianMinutes: null },
        ],
    };
}

/**
 * Answers the API from a table of URLs. A `held` answer is not given until the test releases it with
 * a body, which is how a request for one game is kept open across a navigation to the next.
 */
function stubApi(routes: Record<string, CommunityTimes | 'held'>) {
    const held: Array<(body: CommunityTimes) => void> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        const answer = routes[url];
        if (answer === undefined) throw new Error(`unexpected fetch: ${url}`);

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
        release: (body: CommunityTimes) => act(async () => {
            held.shift()?.(body);
            await new Promise(resolve => setTimeout(resolve, 0));
        }),
    };
}

function Probe({ gameId }: { gameId: number }) {
    const community = useCommunityTimes(gameId);
    const normally = community?.buckets.find(bucket => bucket.type === 'normally');
    return <span data-testid="normally">{normally === undefined ? 'none' : String(normally.samples)}</span>;
}

const normally = () => screen.getByTestId('normally');

afterEach(() => vi.unstubAllGlobals());

describe('useCommunityTimes', () => {
    it('asks without sending the sign-in cookie', async () => {
        // An aggregate that names nobody and answers every reader alike. `fetch` sends cookies to our
        // own origin by default, so leaving `credentials` unset would not have kept them off it.
        const { fetchMock } = stubApi({ '/api/games/1/community-times': times(6) });
        render(<Probe gameId={1} />);
        await waitFor(() => expect(normally()).toHaveTextContent('6'));

        expect(fetchMock.mock.calls[0][1]?.credentials).toBe('omit');
    });

    it("clears the previous game's figures before the next game answers", async () => {
        // The game page stays mounted when a link goes from one game to another, so the last game's
        // medians must not sit under the new game's title while the new one loads.
        const { release } = stubApi({
            '/api/games/1/community-times': times(6),
            '/api/games/2/community-times': 'held',
        });
        const view = render(<Probe gameId={1} />);
        await waitFor(() => expect(normally()).toHaveTextContent('6'));

        view.rerender(<Probe gameId={2} />);

        expect(normally()).toHaveTextContent('none');

        await release(times(9));
        await waitFor(() => expect(normally()).toHaveTextContent('9'));
    });

    it('drops a late answer for the previous game', async () => {
        const { release } = stubApi({
            '/api/games/1/community-times': 'held',
            '/api/games/2/community-times': times(9),
        });
        const view = render(<Probe gameId={1} />);

        view.rerender(<Probe gameId={2} />);
        await waitFor(() => expect(normally()).toHaveTextContent('9'));

        await release(times(6));

        expect(normally()).toHaveTextContent('9');
    });
});

describe('communityTimesReducer', () => {
    /*
     * The frame these pin cannot be reached through the hook under jsdom: `act` flushes render,
     * commit and passive effects together, so the request is always aborted before a stale answer
     * can land, and "drops a late answer" above passes on the abort alone. In a browser the cleanup
     * runs after the commit, and an answer resolving in between reaches the reducer carrying the
     * previous game's stamp. This is what stops it — see ADR 0022.
     */

    // The frame's own state: the new game has been reset, and its own request is not yet sent.
    const onGameTwo: CommunityTimesState = { gameId: 2, times: null };

    it('drops an answer stamped with a game no longer on screen', () => {
        const next = communityTimesReducer(onGameTwo, { type: 'SETTLED', gameId: 1, times: times(6) });

        expect(next).toBe(onGameTwo);
    });

    it('keeps an answer stamped with the game on screen', () => {
        const next = communityTimesReducer(onGameTwo, { type: 'SETTLED', gameId: 2, times: times(9) });

        expect(next).toEqual({ gameId: 2, times: times(9) });
    });

    it('starts a new game from nothing', () => {
        const next = communityTimesReducer({ gameId: 1, times: times(6) }, { type: 'RESET', gameId: 3 });

        expect(next).toEqual({ gameId: 3, times: null });
    });
});
