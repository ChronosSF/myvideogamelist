import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ImportReviewPage } from '@/pages/ImportReviewPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UseImportReviewResult } from '@/hooks/useImport';
import { game, importReview, importRow, userProfile } from '@/test/factories';

/**
 * Auth, the lists context and the review hook, all mocked: each of the real ones fetches, and the
 * page only reads what they hold.
 *
 * One module-level object each, handed back on every call rather than a fresh literal — a new
 * object per render re-runs any effect depending on it, which ends in a heap crash rather than a
 * failed assertion.
 */
const auth: AuthContextValue = {
    user: null,
    loading: true,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

const review: UseImportReviewResult = {
    review: null,
    loading: false,
    error: null,
    gone: false,
    actionError: null,
    busy: false,
    matching: false,
    result: null,
    reload: vi.fn(),
    setDecisions: vi.fn(async () => {}),
    match: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    cancel: vi.fn(async () => true),
};

const lists = {
    nameFor: (id: string) => (id === 'finished' ? 'Beaten' : id),
    namesStatus: 'ready' as const,
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));
vi.mock('@/hooks/useImport', () => ({ useImportReview: () => review }));

const row = importRow;
const loaded = importReview;

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/import/job-1']}>
            <Routes>
                <Route path="/import/:jobId" element={<ImportReviewPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => vi.useRealTimers());

beforeEach(() => {
    auth.user = userProfile();
    auth.loading = false;
    review.review = null;
    review.loading = false;
    review.error = null;
    review.gone = false;
    review.actionError = null;
    review.busy = false;
    review.matching = false;
    review.result = null;
    vi.clearAllMocks();
});

describe('ImportReviewPage', () => {
    it('says how many games will be imported', () => {
        review.review = loaded([row(), row({ id: 2, decision: 'skip' })]);
        renderPage();

        expect(screen.getByRole('button', { name: 'Import 1 games' })).toBeInTheDocument();
    });

    it('groups the digits of a large count', () => {
        // A real export runs to hundreds and the cap is 5,000, so four-digit counts are ordinary
        // here. They go through formatCount like every other count on the site — which also fixes
        // the locale to one, so the server render and the hydration cannot disagree.
        review.review = loaded(Array.from({ length: 1200 }, (_, i) => row({ id: i + 1 })));
        renderPage();

        expect(screen.getByRole('button', { name: 'Import 1,200 games' })).toBeInTheDocument();
    });

    it('will not commit when nothing is selected', () => {
        review.review = loaded([row({ decision: 'skip' })]);
        renderPage();

        expect(screen.getByRole('button', { name: /^Import 0/ })).toBeDisabled();
    });

    it('opens on the rows that need a decision', async () => {
        // The default filter, because nobody scrolls six hundred rows looking for the twelve that
        // need one.
        review.review = loaded([
            row({ id: 1, title: 'Matched Game' }),
            row({ id: 2, title: 'Unmatched Game', gameId: null, matchKind: 'unmatched', decision: 'skip' }),
        ]);
        renderPage();

        expect(screen.getByText('Unmatched Game')).toBeInTheDocument();
        expect(screen.queryByText('Matched Game')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /^All / }));
        expect(screen.getByText('Matched Game')).toBeInTheDocument();
    });

    it('marks a game the user already has, and leaves it unselected', async () => {
        // §S8: an import must not overwrite what somebody recorded by hand without being asked.
        review.review = loaded([row({ alreadyTracked: true, decision: 'skip' })]);
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: /^All / }));
        expect(screen.getByRole('checkbox', { name: 'Import Metal Gear Solid 3' })).not.toBeChecked();
    });

    it('will not let an unmatched row be ticked', async () => {
        // A tickable unmatched row would count in "will import" and then be skipped at commit — a
        // promise the screen cannot keep. An ambiguous row is ticked by choosing a candidate; this
        // one has none to choose from, and §M4's free-text search is not built.
        review.review = loaded([row({ gameId: null, matchKind: 'unmatched', decision: 'skip' })]);
        renderPage();

        expect(screen.getByRole('checkbox', { name: 'Import Metal Gear Solid 3' })).toBeDisabled();
    });

    it('sends a decision when a row is ticked', async () => {
        // A matched row the user has not selected — an already-tracked one is the ordinary case,
        // since those default to skip. An unmatched row cannot be ticked at all.
        review.review = loaded([row({ decision: 'skip', alreadyTracked: true })]);
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: /^All / }));

        await userEvent.click(screen.getByRole('checkbox', { name: 'Import Metal Gear Solid 3' }));

        expect(review.setDecisions).toHaveBeenCalledWith([{ rowId: 1, decision: 'import' }]);
    });

    it('asks about an unrecognised shelf rather than defaulting it', async () => {
        // The rule from the spec §3.2 — never silently dropped, never silently made Backlog.
        review.review = loaded([row({ statusUnrecognised: true, status: null, sourceStatus: 'Gave Up On' })]);
        renderPage();

        expect(screen.getByText(/Gave Up On/)).toBeInTheDocument();

        await userEvent.selectOptions(screen.getByRole('combobox'), 'dropped');
        expect(review.setDecisions).toHaveBeenCalledWith(
            [{ rowId: 1, decision: 'import', status: 'dropped' }]);
    });

    it('labels a status by the name its owner gave the list', async () => {
        // A rename is the user's own label and is what every label reads (ADR 0031).
        review.review = loaded([row()]);
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: /^All / }));
        expect(screen.getByText(/Beaten/)).toBeInTheDocument();
    });

    it('shows a failed decision beside the rows rather than instead of them', () => {
        // The rollback has already happened, so the review underneath is fine — sharing one error
        // field would hide a perfectly good screen.
        review.review = loaded([row()]);
        review.actionError = 'That change was not saved.';
        renderPage();

        expect(screen.getByRole('alert')).toHaveTextContent('That change was not saved.');
        expect(screen.getByRole('button', { name: /^Import 1/ })).toBeInTheDocument();
    });

    it('offers the skipped rows as a file once the import is done', () => {
        // §C5: nothing is silently lost, and a count does not say which games to add by hand.
        review.result = {
            job: { ...loaded([]).job, state: 'done', importedCount: 600, skippedCount: 2 },
            skipped: [
                { title: 'One', sourceStatus: null, reason: 'No game was matched to it.' },
                { title: 'Two', sourceStatus: 'Played', reason: 'You chose not to import it.' },
            ],
        };
        renderPage();

        expect(screen.getByRole('heading', { name: 'Import finished' })).toBeInTheDocument();
        expect(screen.getByText(/600 games are now in your lists/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download what was skipped' })).toBeInTheDocument();
    });

    it('offers no download when every row imported', () => {
        review.result = {
            job: { ...loaded([]).job, state: 'done', importedCount: 3, skippedCount: 0 },
            skipped: [],
        };
        renderPage();

        expect(screen.queryByRole('button', { name: 'Download what was skipped' })).not.toBeInTheDocument();
    });

    it('tells a signed-out visitor to sign in', () => {
        auth.user = null;
        auth.loading = false;
        renderPage();

        expect(screen.getByText('Sign in to review your import.')).toBeInTheDocument();
    });

    it('shows a load failure with a way to retry', async () => {
        review.error = 'This import could not be loaded.';
        renderPage();

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('This import could not be loaded.');

        await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(review.reload).toHaveBeenCalled();
    });

    it('offers a way out rather than a retry for an import that is over', () => {
        // Every job ends this way in the end — committed, cancelled, or deleted by retention — so
        // this is the ordinary last state of the screen rather than an edge case. A "Try again"
        // here reloads a 404 and gets the same 404, for as long as somebody keeps pressing it.
        review.error = 'This import is no longer available.';
        review.gone = true;
        renderPage();

        const alert = screen.getByRole('alert');

        expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        expect(within(alert).getByRole('link', { name: 'Back to your imports' }))
            .toHaveAttribute('href', '/import');
    });

    it('offers to look up the games the file did not identify', async () => {
        // Offered rather than done on arrival: it spends IGDB's budget and takes real time, so it
        // is somebody asking for it rather than something that happens to them.
        review.review = loaded([
            row({ id: 1, title: 'No Id Here', gameId: null, matchKind: 'unlooked', decision: 'skip' }),
        ]);
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Find these games' }));
        expect(review.match).toHaveBeenCalled();
    });

    it('stops offering a lookup once every row has been looked at', () => {
        // A row a pass has already been over is `unmatched` rather than `unlooked` and will not
        // move by asking again. A button that stayed would invite somebody to spend a minute on a
        // search that finds nothing twice.
        review.review = loaded([
            row({
                id: 1, title: 'Nothing Like This Exists',
                gameId: null, matchKind: 'unmatched', decision: 'skip',
            }),
        ]);
        renderPage();

        expect(screen.queryByRole('button', { name: 'Find these games' })).not.toBeInTheDocument();
    });

    it('says a search is running and how much is left', () => {
        review.matching = true;
        review.review = loaded([
            row({ id: 1, gameId: null, matchKind: 'unlooked', decision: 'skip' }),
        ]);
        renderPage();

        expect(screen.getByRole('button', { name: /Searching… 1 left/ })).toBeDisabled();
    });

    it('lets an ambiguous row be resolved by choosing one of its candidates', async () => {
        // §M3. IGDB holds a row per release, so a search for a popular game answers with several
        // entries carrying its exact title — this is the ordinary outcome for one, not an edge
        // case. The row is resolved by recognising a cover and a year rather than by reading ids.
        review.review = loaded([
            row({
                id: 1, title: 'Resident Evil 2', releaseYear: null,
                gameId: null, matchKind: 'ambiguous', decision: 'skip',
                candidates: [
                    game({ id: 19686, title: 'Resident Evil 2', releaseDate: '2019-01-25' }),
                    game({ id: 880, title: 'Resident Evil 2', releaseDate: '1998-01-21' }),
                ],
            }),
        ]);
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Use Resident Evil 2 (1998)' }));

        // Choosing also selects it: somebody who has just said "that one" has said they want it.
        expect(review.setDecisions).toHaveBeenCalledWith([
            { rowId: 1, decision: 'import', gameId: 880 },
        ]);
    });

    it('tells an ambiguous row apart from one nothing was found for', () => {
        // Both are unimportable until somebody acts, and the two need different actions — one is a
        // choice on screen, the other is not. Labelling both "No game matched" would send somebody
        // looking for a picker that is not there.
        review.review = loaded([
            row({
                id: 1, title: 'Hollow Knight', gameId: null, matchKind: 'ambiguous', decision: 'skip',
                candidates: [game({ id: 14593, title: 'Hollow Knight', releaseDate: '2017-02-24' })],
            }),
            row({ id: 2, title: 'Nothing Like This', gameId: null, matchKind: 'unmatched', decision: 'skip' }),
        ]);
        renderPage();

        expect(screen.getByText('Which one is it?')).toBeInTheDocument();
        expect(screen.getByText('No game matched')).toBeInTheDocument();
    });

    it('will not let an ambiguous row be ticked before a game is chosen', () => {
        // Ticking it would count it in "will import" and then have the commit skip it, which is a
        // promise the screen cannot keep.
        review.review = loaded([
            row({
                id: 1, title: 'Hollow Knight', gameId: null, matchKind: 'ambiguous', decision: 'skip',
                candidates: [game({ id: 14593, title: 'Hollow Knight', releaseDate: '2017-02-24' })],
            }),
        ]);
        renderPage();

        expect(screen.getByRole('checkbox', { name: 'Import Hollow Knight' })).toBeDisabled();
    });

    it('says when an unfinished import will be deleted, and what keeps it alive', () => {
        // The window was undisclosed anywhere in the client, so a review that vanished on day
        // fifteen did so without warning. The date comes from the API, because the windows are a
        // server decision and a copy of them here would drift.
        // Only Date, so userEvent's own timers keep working in the rest of the file. Without a
        // pinned clock this assertion would pass today and count down to failing tomorrow.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));

        review.review = loaded([row()]);
        renderPage();

        // `expiresAt` on the fixture is a fortnight after the fixed clock.
        expect(screen.getByText(/deleted in 12 days/i)).toBeInTheDocument();
        expect(screen.getByText(/saving any decision starts that over/i)).toBeInTheDocument();
    });
});
