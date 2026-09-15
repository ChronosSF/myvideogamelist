import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { trackedNewsReducer, useTrackedNews, type TrackedNewsState } from '@/hooks/useTrackedNews';
import type { NewsItemDto } from '@/types/news';

/** A news item told apart by its title, which is all these tests read. */
function item(title: string): NewsItemDto {
    return {
        id: title,
        gameId: 1,
        gameTitle: 'Hades',
        gameCoverUrl: null,
        title,
        url: 'https://example.test/news',
        source: 'Steam',
        excerpt: null,
        publishedAt: '2026-09-14T10:00:00+00:00',
    };
}

type Answer = string | 'fail' | 'unreachable' | 'held';

/**
 * Answers `/api/user/news` from a script, one entry per request, repeating the last. A string is a
 * one-item response with that title. A `held` entry is not answered until the test releases it, which
 * is how one account's request is kept open across a sign-in by the next.
 */
function stubNews(answers: Answer[]) {
    let index = 0;
    const held: Array<(title: string) => void> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url !== '/api/user/news') throw new Error(`unexpected fetch: ${url}`);

        const answer = answers[Math.min(index++, answers.length - 1)];
        if (answer === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
        if (answer === 'fail') return Promise.resolve(new Response('nope', { status: 500 }));
        if (answer === 'held') {
            return new Promise<Response>(resolve => {
                held.push(title => resolve(new Response(JSON.stringify([item(title)]), { status: 200 })));
            });
        }
        return Promise.resolve(new Response(JSON.stringify([item(answer)]), { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    return {
        fetchMock,
        /** Answers the oldest held request and flushes everything it causes. */
        release: (title: string) => act(async () => {
            held.shift()?.(title);
            await new Promise(resolve => setTimeout(resolve, 0));
        }),
    };
}

function Probe({ account }: { account: string | null }) {
    const { news, loading, error, reload } = useTrackedNews(account);
    return (
        <div>
            <span data-testid="loading">{String(loading)}</span>
            <span data-testid="news">{news === null ? 'none' : news.map(n => n.title).join(',')}</span>
            <span data-testid="error">{error ?? ''}</span>
            <button type="button" onClick={reload}>reload</button>
        </div>
    );
}

const news = () => screen.getByTestId('news');
const loading = () => screen.getByTestId('loading');

afterEach(() => vi.unstubAllGlobals());

describe('useTrackedNews', () => {
    it('fetches nothing while nobody is signed in', () => {
        const { fetchMock } = stubNews(['Patch 1.1']);
        render(<Probe account={null} />);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(loading()).toHaveTextContent('false');
        expect(news()).toHaveTextContent('none');
    });

    it('loads the signed-in account', async () => {
        stubNews(['Patch 1.1']);
        render(<Probe account="alice" />);

        expect(loading()).toHaveTextContent('true');
        await waitFor(() => expect(news()).toHaveTextContent('Patch 1.1'));
        expect(loading()).toHaveTextContent('false');
    });

    it('clears the previous account before the next one answers', async () => {
        const { release } = stubNews(['Alice news', 'held']);
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(news()).toHaveTextContent('Alice news'));

        view.rerender(<Probe account="bob" />);

        expect(news()).toHaveTextContent('none');
        expect(loading()).toHaveTextContent('true');

        await release('Bob news');
        await waitFor(() => expect(news()).toHaveTextContent('Bob news'));
    });

    it('drops a late answer from the previous account', async () => {
        const { release } = stubNews(['held', 'Bob news']);
        const view = render(<Probe account="alice" />);

        view.rerender(<Probe account="bob" />);
        await waitFor(() => expect(news()).toHaveTextContent('Bob news'));

        await release('Alice news');

        expect(news()).toHaveTextContent('Bob news');
    });

    it('goes back to nothing on sign-out', async () => {
        stubNews(['Patch 1.1']);
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(news()).toHaveTextContent('Patch 1.1'));

        view.rerender(<Probe account={null} />);

        expect(news()).toHaveTextContent('none');
        expect(loading()).toHaveTextContent('false');
    });

    it('fetches again on reload', async () => {
        const { fetchMock } = stubNews(['fail', 'Patch 1.1']);
        render(<Probe account="alice" />);
        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('(500)'));

        await userEvent.click(screen.getByRole('button', { name: 'reload' }));

        await waitFor(() => expect(news()).toHaveTextContent('Patch 1.1'));
        expect(screen.getByTestId('error')).toBeEmptyDOMElement();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports an unreachable API rather than loading forever', async () => {
        stubNews(['unreachable']);
        render(<Probe account="alice" />);

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Failed to fetch'));
        expect(loading()).toHaveTextContent('false');
    });
});

describe('trackedNewsReducer', () => {
    /*
     * The frame these pin cannot be reached through the hook under jsdom — see the same block in
     * useUserStats.test.tsx. In a browser a response resolving between the commit of a new account
     * and the effect cleanup reaches the reducer with the previous account's stamp; this drops it.
     */
    const bob: TrackedNewsState = { account: 'bob', news: null, loading: true, error: null };

    it('drops a success stamped with an account that is no longer current', () => {
        expect(trackedNewsReducer(bob, { type: 'FETCH_SUCCESS', account: 'alice', news: [item('Alice news')] }))
            .toBe(bob);
    });

    it('drops an error stamped with an account that is no longer current', () => {
        expect(trackedNewsReducer(bob, { type: 'FETCH_ERROR', account: 'alice', error: 'nope' })).toBe(bob);
    });

    it('keeps a success stamped with the current account', () => {
        const next = trackedNewsReducer(bob, { type: 'FETCH_SUCCESS', account: 'bob', news: [item('Bob news')] });

        expect(next.news?.map(n => n.title)).toEqual(['Bob news']);
        expect(next.loading).toBe(false);
    });

    it('starts a new account from nothing', () => {
        const alice: TrackedNewsState = { account: 'alice', news: [item('Alice news')], loading: false, error: 'old' };

        expect(trackedNewsReducer(alice, { type: 'FETCH_START', account: 'bob' }))
            .toEqual({ account: 'bob', news: null, loading: true, error: null });
    });

    it('keeps what it has when the same account asks again', () => {
        const alice: TrackedNewsState = { account: 'alice', news: [item('Alice news')], loading: false, error: 'old' };

        const next = trackedNewsReducer(alice, { type: 'FETCH_START', account: 'alice' });

        expect(next.news?.map(n => n.title)).toEqual(['Alice news']);
        expect(next.loading).toBe(true);
        expect(next.error).toBeNull();
    });
});
