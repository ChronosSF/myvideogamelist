import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useImportReview } from '@/hooks/useImport';
import { IMPORT_MATCH } from '@/types/import';
import { importJob, importReview, importRow } from '@/test/factories';

/**
 * The matching loop, which is the one piece of this hook that can run away.
 *
 * The server resolves a bounded batch per call and answers with the rows it examined, so it is the
 * client that decides how many times to ask. Getting that wrong is not a wrong number on a screen —
 * it is a browser tab asking a rate-limited third party the same question for ever.
 */
describe('useImportReview.match', () => {
    const JOB = 'job-1';
    const TOTAL = 12;

    /** A job of `TOTAL` rows, the first `looked` of which have been resolved. */
    const rows = (looked: number) =>
        Array.from({ length: TOTAL }, (_, i) => importRow(i < looked
            ? { id: i + 1, gameId: 100 + i, matchKind: IMPORT_MATCH.matched }
            : { id: i + 1, gameId: null, matchKind: IMPORT_MATCH.unlooked, decision: 'skip' }));

    /**
     * Answers the review GET once and then each match POST from a script, where each entry is how
     * many rows that pass resolved. `'fail'` is a 502, which is what an IGDB outage reaches the
     * client as; `'stuck'` is a pass that hands back rows it did not move, which is the shape a
     * server that has stopped making progress has.
     */
    function stubMatching(passes: (number | 'fail' | 'stuck')[]) {
        let resolved = 0;
        let index = 0;

        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url === `/api/import/jobs/${JOB}` && init?.method === undefined) {
                return Promise.resolve(Response.json(importReview(rows(0))));
            }

            if (url === `/api/import/jobs/${JOB}/match` && init?.method === 'POST') {
                const pass = passes[Math.min(index++, passes.length - 1)];

                if (pass === 'fail') {
                    return Promise.resolve(
                        Response.json({ detail: 'IGDB is unreachable.' }, { status: 502 }));
                }

                const examined = pass === 'stuck'
                    ? rows(resolved + 1).slice(resolved, resolved + 1).map(
                        row => ({ ...row, gameId: null, matchKind: IMPORT_MATCH.unlooked }))
                    : rows(resolved + pass).slice(resolved, resolved + pass);

                if (pass !== 'stuck') resolved += pass;

                return Promise.resolve(Response.json({ job: importJob(), examined }));
            }

            throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
        });

        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    function Probe() {
        const { review, matching, actionError, match } = useImportReview('user-1', JOB);

        return (
            <div>
                <span data-testid="unlooked">{review?.summary.unlooked ?? '-'}</span>
                <span data-testid="matching">{String(matching)}</span>
                <span data-testid="action-error">{actionError ?? 'none'}</span>
                <button type="button" onClick={() => void match()}>Find these games</button>
            </div>
        );
    }

    const unlooked = () => screen.getByTestId('unlooked');
    const actionError = () => screen.getByTestId('action-error');

    const passes = (fetchMock: ReturnType<typeof stubMatching>) =>
        fetchMock.mock.calls.filter(
            ([, init]) => (init as RequestInit | undefined)?.method === 'POST').length;

    async function renderAndMatch() {
        render(<Probe />);
        await waitFor(() => expect(unlooked()).toHaveTextContent(String(TOTAL)));
        await act(() => userEvent.click(screen.getByRole('button')));
    }

    afterEach(() => vi.unstubAllGlobals());

    it('keeps asking until a pass has nothing left to examine', async () => {
        // Three passes for a job the server walks a batch at a time, then an empty one. One click,
        // and the count on screen falls as each answer lands rather than after all of them.
        const fetchMock = stubMatching([5, 5, 2, 0]);

        await renderAndMatch();

        expect(passes(fetchMock)).toBe(4);
        expect(unlooked()).toHaveTextContent('0');
        expect(screen.getByTestId('matching')).toHaveTextContent('false');
    });

    it('stops when a pass hands back rows it did not move', async () => {
        // The guard that matters. Without it, a server that has stopped making progress — a bug, a
        // row that cannot be written, anything — becomes a tab hammering IGDB's rate limit until
        // somebody closes it. Two calls: the one that made progress, and the one that did not.
        const fetchMock = stubMatching([5, 'stuck']);

        await renderAndMatch();

        expect(passes(fetchMock)).toBe(2);
        expect(unlooked()).toHaveTextContent('7');
    });

    it('keeps what earlier passes found when a later one fails', async () => {
        // Each pass is its own transaction on the server, so a failure is the failure of that pass
        // and not of the run. Throwing away the first answer would make an IGDB blip cost somebody
        // the lookups they had already paid for.
        stubMatching([4, 'fail']);

        await renderAndMatch();

        expect(unlooked()).toHaveTextContent('8');
        expect(actionError()).toHaveTextContent('IGDB is unreachable.');
    });

    it('sends the header the API refuses a write without', async () => {
        // A matching pass is a POST, so a bare fetch would be a 403 that looks like a bug
        // (ADR 0033). `apiFetch` is what puts the header on.
        const fetchMock = stubMatching([0]);

        await renderAndMatch();

        const [, init] = fetchMock.mock.calls.find(
            ([, options]) => (options as RequestInit | undefined)?.method === 'POST')!;

        expect(new Headers((init as RequestInit).headers).has('X-MVGL-Request')).toBe(true);
    });
});
