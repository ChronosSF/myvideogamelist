import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { hiddenPlatformsReducer, useHiddenPlatforms } from '@/hooks/useHiddenPlatforms';
import type { HiddenPlatformsState } from '@/hooks/useHiddenPlatforms';

type Answer = number[] | 'held' | 'fail';

/**
 * Answers `/api/user/hidden-platforms` from a script, one entry per GET, repeating the last. A
 * `held` entry waits for the test to release it, which is how one account's request is kept open
 * across a sign-in by the next.
 */
function stubHidden(answers: Answer[]) {
    let index = 0;
    const held: Array<(ids: number[]) => void> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url !== '/api/user/hidden-platforms') throw new Error(`unexpected fetch: ${url}`);
        if (init?.method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }));

        const answer = answers[Math.min(index++, answers.length - 1)];
        if (answer === 'held') {
            return new Promise<Response>(resolve => {
                held.push(ids => resolve(new Response(JSON.stringify(ids), { status: 200 })));
            });
        }
        if (answer === 'fail') return Promise.resolve(new Response('nope', { status: 500 }));
        return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    return {
        fetchMock,
        /** Answers the oldest held request and flushes everything it causes. */
        release: (ids: number[]) => act(async () => {
            held.shift()?.(ids);
            await new Promise(resolve => setTimeout(resolve, 0));
        }),
    };
}

function Probe({ account }: { account: string | null }) {
    const { hiddenIds, loading, loadError } = useHiddenPlatforms(account);
    return (
        <div>
            <span data-testid="loading">{String(loading)}</span>
            <span data-testid="load-error">{loadError ?? 'none'}</span>
            <span data-testid="hidden">
                {hiddenIds.size === 0 ? 'none' : [...hiddenIds].sort((a, b) => a - b).join(',')}
            </span>
        </div>
    );
}

const hidden = () => screen.getByTestId('hidden');
const loading = () => screen.getByTestId('loading');
const loadError = () => screen.getByTestId('load-error');

afterEach(() => vi.unstubAllGlobals());

describe('useHiddenPlatforms', () => {
    it('fetches nothing while nobody is signed in', () => {
        const { fetchMock } = stubHidden([[1]]);
        render(<Probe account={null} />);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(loading()).toHaveTextContent('false');
        expect(hidden()).toHaveTextContent('none');
    });

    it('loads the signed-in account', async () => {
        stubHidden([[6, 48]]);
        render(<Probe account="alice" />);

        expect(loading()).toHaveTextContent('true');
        await waitFor(() => expect(hidden()).toHaveTextContent('6,48'));
        expect(loading()).toHaveTextContent('false');
    });

    it('reports a failed read rather than passing its empty set off as the answer', async () => {
        // The empty set left behind is not "nothing hidden", and a caller has to be able to tell
        // the difference: the profile page offers no Save while this is set, because saving that
        // set would write it over whatever the user had actually chosen.
        stubHidden(['fail']);
        render(<Probe account="alice" />);

        await waitFor(() =>
            expect(loadError()).toHaveTextContent('Failed to load hidden platforms (500)'));
        expect(hidden()).toHaveTextContent('none');
        expect(loading()).toHaveTextContent('false');
    });

    it('clears the previous account before the next one answers', async () => {
        // One person's hidden platforms must not stay in force for the next, not even for the
        // length of a request: the timeline would filter the new account's view by them.
        const { release } = stubHidden([[6, 48], 'held']);
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(hidden()).toHaveTextContent('6,48'));

        view.rerender(<Probe account="bob" />);

        expect(hidden()).toHaveTextContent('none');
        expect(loading()).toHaveTextContent('true');

        await release([130]);
        await waitFor(() => expect(hidden()).toHaveTextContent('130'));
    });

    it('drops a late answer from the previous account', async () => {
        const { release } = stubHidden(['held', [130]]);
        const view = render(<Probe account="alice" />);

        view.rerender(<Probe account="bob" />);
        await waitFor(() => expect(hidden()).toHaveTextContent('130'));

        await release([6, 48]);

        expect(hidden()).toHaveTextContent('130');
    });

    it('goes back to an empty set on sign-out', async () => {
        // The timeline stays mounted through a sign-out, and a signed-out visitor has hidden nothing.
        stubHidden([[6, 48]]);
        const view = render(<Probe account="alice" />);
        await waitFor(() => expect(hidden()).toHaveTextContent('6,48'));

        view.rerender(<Probe account={null} />);

        expect(hidden()).toHaveTextContent('none');
        expect(loading()).toHaveTextContent('false');
    });
});

describe('hiddenPlatformsReducer', () => {
    /*
     * Pinned on the reducer because the hook cannot reach the frame under jsdom — see the note on
     * `userStatsReducer`'s tests. The save's completions are the exception worth stressing: a PUT
     * is not aborted on sign-out, so its result really can arrive after the account has changed.
     */
    const bob: HiddenPlatformsState = {
        account: 'bob',
        hiddenIds: new Set([130]),
        loading: false,
        saving: false,
        loadError: null,
        saveError: null,
    };

    it.each([
        { type: 'FETCH_SUCCESS', account: 'alice', ids: new Set([6]) },
        { type: 'FETCH_ERROR', account: 'alice', error: 'nope' },
        { type: 'EDIT', account: 'alice', update: new Set([6]) },
        { type: 'SAVE_START', account: 'alice' },
        { type: 'SAVE_SUCCESS', account: 'alice' },
        { type: 'SAVE_ERROR', account: 'alice', error: 'nope' },
    ] as const)('drops $type stamped with an account that is no longer current', action => {
        expect(hiddenPlatformsReducer(bob, action)).toBe(bob);
    });

    it('applies an updater to the current set', () => {
        const next = hiddenPlatformsReducer(bob, {
            type: 'EDIT',
            account: 'bob',
            update: prev => new Set([...prev, 6]),
        });

        expect([...next.hiddenIds]).toEqual([130, 6]);
    });

    it('starts a new account from nothing, including a save left in flight', () => {
        const alice: HiddenPlatformsState = {
            account: 'alice',
            hiddenIds: new Set([6, 48]),
            loading: false,
            saving: true,
            loadError: 'old',
            saveError: 'old',
        };

        const next = hiddenPlatformsReducer(alice, { type: 'FETCH_START', account: 'bob' });

        expect(next).toEqual({
            account: 'bob',
            hiddenIds: new Set(),
            loading: true,
            saving: false,
            loadError: null,
            saveError: null,
        });
    });

    it('keeps a failed read apart from a failed save', () => {
        // One field for both cannot say whether the set beside it is the user's answer or the
        // absence of one, and only the read's empty set is dangerous to save.
        const next = hiddenPlatformsReducer(bob, {
            type: 'FETCH_ERROR',
            account: 'bob',
            error: 'Failed to load hidden platforms (500)',
        });

        expect(next.loadError).toBe('Failed to load hidden platforms (500)');
        expect(next.saveError).toBeNull();
        expect(next.loading).toBe(false);
    });

    it('surfaces a failed save without dropping the edits it was saving', () => {
        // The set on screen is still what the user chose; only the save of it failed, and they
        // can try again without re-ticking everything.
        const saving: HiddenPlatformsState = { ...bob, saving: true };

        const next = hiddenPlatformsReducer(saving, { type: 'SAVE_ERROR', account: 'bob', error: 'Failed to save (500)' });

        expect(next.saving).toBe(false);
        expect(next.saveError).toBe('Failed to save (500)');
        // Not a load failure: what is on screen is still the user's own set.
        expect(next.loadError).toBeNull();
        expect([...next.hiddenIds]).toEqual([130]);
    });
});
