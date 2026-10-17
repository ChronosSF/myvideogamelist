import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { historyReducer, useHistory } from '@/hooks/useHistory';
import type { HistoryState } from '@/hooks/useHistory';
import type { HistoryPage } from '@/types/history';
import { historyPage, statusItem } from '@/test/factories';

/** A page of status items told apart by their game ids, which is all these tests read. */
function page(gameIds: number[], next: string | null = null, extra: Partial<HistoryPage> = {}): HistoryPage {
    return historyPage({ items: gameIds.map(gameId => statusItem({ gameId })), next, ...extra });
}

/** A ValidationProblemDetails refusing the cursor, as the controller writes it. */
const REFUSED = {
    status: 400,
    errors: { after: ['That is not a page of this history. Start again from the first.'] },
};

/**
 * Answers the API from a table of URLs, each with a script of answers, one per request and
 * repeating the last. An answer is a page, or one of `'fail'` (a 500), `'unreachable'` (a rejected
 * fetch), `'refused'` (the 400 a stale cursor gets) and `'held'` — not answered until the test
 * releases it, which is how a request is kept open across a sign-in by somebody else.
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
        if (answer === 'refused') return Promise.resolve(new Response(JSON.stringify(REFUSED), { status: 400 }));
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

function Probe({ account }: { account: string | null }) {
    const history = useHistory(account);
    return (
        <div>
            <span data-testid="loading">{String(history.loading)}</span>
            <span data-testid="items">{history.items.map(item => item.gameId).join(',')}</span>
            <span data-testid="error">{history.error ?? ''}</span>
            <span data-testid="more">{String(history.hasMore)}</span>
            <span data-testid="more-error">{history.moreError?.message ?? ''}</span>
            <span data-testid="restart">{String(history.moreError?.restart ?? false)}</span>
            <span data-testid="counts">{`${history.importedStatuses}/${history.undatedScores}`}</span>
            <button type="button" onClick={history.loadMore}>more</button>
            <button type="button" onClick={history.reload}>reload</button>
        </div>
    );
}

const text = (id: string) => screen.getByTestId(id);
const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

afterEach(() => vi.unstubAllGlobals());

describe('useHistory', () => {
    it('asks for nothing while nobody is signed in', () => {
        const { fetchMock } = stubApi({});
        render(<Probe account={null} />);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(text('loading')).toHaveTextContent('false');
    });

    it('loads the first page with the session cookie, and the counts with it', async () => {
        // The owner's own history, so it is the one read here that has to carry the cookie.
        const { fetchMock } = stubApi({ '/api/user/history': [page([1, 2], null, { importedStatuses: 4, undatedScores: 3 })] });
        render(<Probe account="alice" />);

        expect(text('loading')).toHaveTextContent('true');
        await waitFor(() => expect(text('items')).toHaveTextContent('1,2'));
        expect(text('loading')).toHaveTextContent('false');
        expect(text('counts')).toHaveTextContent('4/3');
        expect(text('more')).toHaveTextContent('false');
        expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include');
    });

    it('asks for the next page by the cursor the last one ended with, escaped, and stops at the end', async () => {
        // Never by page number: a move made in another tab adds an item at the top, and an offset
        // would then repeat one.
        const { fetchMock } = stubApi({
            '/api/user/history': [page([1, 2], 'c1&x')],
            '/api/user/history?after=c1%26x': [page([3])],
        });
        render(<Probe account="alice" />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));

        await press('more');

        await waitFor(() => expect(text('items')).toHaveTextContent('1,2,3'));
        expect(text('more')).toHaveTextContent('false');
        expect(String(fetchMock.mock.calls[1][0])).toBe('/api/user/history?after=c1%26x');
    });

    it('reports a failed next page, keeps what it has, and can try again', async () => {
        stubApi({
            '/api/user/history': [page([1, 2], 'c1')],
            '/api/user/history?after=c1': ['unreachable', page([3])],
        });
        render(<Probe account="alice" />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));

        await press('more');
        await waitFor(() => expect(text('more-error')).not.toBeEmptyDOMElement());
        expect(text('items')).toHaveTextContent('1,2');
        expect(text('restart')).toHaveTextContent('false');
        expect(text('error')).toBeEmptyDOMElement();

        await press('more');
        await waitFor(() => expect(text('items')).toHaveTextContent('1,2,3'));
        expect(text('more-error')).toBeEmptyDOMElement();
    });

    it('offers the first page again when the cursor is refused, in the API\'s own words', async () => {
        // A 400 is a cursor from a key ring this deployment no longer holds. Pressing "more" again
        // would fail the same way for ever, so the reader is told to start again — and can.
        stubApi({
            '/api/user/history': [page([1, 2], 'stale'), page([5, 6], 'fresh')],
            '/api/user/history?after=stale': ['refused'],
        });
        render(<Probe account="alice" />);
        await waitFor(() => expect(text('more')).toHaveTextContent('true'));

        await press('more');

        await waitFor(() => expect(text('restart')).toHaveTextContent('true'));
        expect(text('more-error')).toHaveTextContent('That is not a page of this history. Start again from the first.');

        await press('reload');

        await waitFor(() => expect(text('items')).toHaveTextContent('5,6'));
        expect(text('more-error')).toBeEmptyDOMElement();
    });

    it('reports an unreachable API rather than loading forever', async () => {
        stubApi({ '/api/user/history': ['unreachable'] });
        render(<Probe account="alice" />);

        await waitFor(() => expect(text('error')).toHaveTextContent('Failed to fetch'));
        expect(text('loading')).toHaveTextContent('false');
    });

    it('clears the previous account before the next one answers', async () => {
        // Cleared on the transition, so a slow or failing first page for the next account cannot
        // leave the previous account's history on screen under it.
        const { release } = stubApi({ '/api/user/history': [page([1]), 'held'] });
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(text('items')).toHaveTextContent('1'));

        view.rerender(<Probe account="bob" />);

        expect(text('items')).toBeEmptyDOMElement();
        expect(text('loading')).toHaveTextContent('true');

        await release(page([7]));
        await waitFor(() => expect(text('items')).toHaveTextContent('7'));
    });

    it('drops a late answer from the previous account', async () => {
        const { release } = stubApi({ '/api/user/history': ['held', page([7])] });
        const view = render(<Probe account="alice" />);

        view.rerender(<Probe account="bob" />);
        await waitFor(() => expect(text('items')).toHaveTextContent('7'));

        await release(page([1]));

        expect(text('items')).toHaveTextContent('7');
    });

    it('goes back to nothing on sign-out', async () => {
        stubApi({ '/api/user/history': [page([1], 'c1')] });
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(text('items')).toHaveTextContent('1'));

        view.rerender(<Probe account={null} />);

        expect(text('items')).toBeEmptyDOMElement();
        expect(text('more')).toHaveTextContent('false');
        expect(text('loading')).toHaveTextContent('false');
    });
});

describe('historyReducer', () => {
    /*
     * The frames these pin cannot be reached through the hook under jsdom: `act` flushes render,
     * commit and passive effects together on the way out, so the request is always aborted before a
     * stale answer can land. In a browser the cleanup runs after the commit, and a response resolving
     * in between reaches the reducer stamped for the previous account — see ADR 0022.
     */
    const bob: HistoryState = {
        account: 'bob',
        items: [statusItem({ gameId: 1 })],
        next: 'c1',
        importedStatuses: 0,
        undatedScores: 0,
        loading: false,
        error: null,
        loadingMore: true,
        moreError: null,
    };

    it('drops a first page stamped with an account that is no longer current', () => {
        expect(historyReducer(bob, { type: 'FETCH_SUCCESS', account: 'alice', page: page([9]) })).toBe(bob);
        expect(historyReducer(bob, { type: 'FETCH_ERROR', account: 'alice', error: 'nope' })).toBe(bob);
    });

    it('drops a next page stamped with another account, or continuing from another cursor', () => {
        // The second is a page asked for before a reload replaced the list, or a second press
        // repeating the first: the list no longer ends where the request began.
        expect(historyReducer(bob, { type: 'MORE_SUCCESS', account: 'alice', after: 'c1', page: page([2]) })).toBe(bob);
        expect(historyReducer(bob, { type: 'MORE_SUCCESS', account: 'bob', after: 'c0', page: page([2]) })).toBe(bob);
        expect(historyReducer(bob, {
            type: 'MORE_ERROR', account: 'bob', after: 'c0', error: { message: 'nope', restart: false },
        })).toBe(bob);
    });

    it('appends a next page that continues the list on screen', () => {
        const next = historyReducer(bob, { type: 'MORE_SUCCESS', account: 'bob', after: 'c1', page: page([2], 'c2') });

        expect(next.items.map(item => item.gameId)).toEqual([1, 2]);
        expect(next.next).toBe('c2');
        expect(next.loadingMore).toBe(false);
    });

    it('starts a new account from nothing', () => {
        const next = historyReducer(bob, { type: 'FETCH_START', account: 'carol' });

        expect(next.account).toBe('carol');
        expect(next.items).toEqual([]);
        expect(next.next).toBeNull();
        expect(next.loading).toBe(true);
    });

    it('keeps the list on a reload, and cancels a "show more" the reload has aborted', () => {
        // Nothing else would clear `loadingMore`: the aborted request dispatches nothing, and a
        // reload that then failed would leave the button saying "Loading…" for good.
        const next = historyReducer(
            { ...bob, moreError: { message: 'nope', restart: true } },
            { type: 'FETCH_START', account: 'bob' });

        expect(next.items.map(item => item.gameId)).toEqual([1]);
        expect(next.loading).toBe(true);
        expect(next.loadingMore).toBe(false);
        expect(next.moreError).toBeNull();
    });
});
