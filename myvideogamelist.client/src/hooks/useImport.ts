import { useCallback, useReducer, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { PermanentFetchError, useAccountResource } from '@/hooks/useAccountResource';
import {
    IMPORT_DECISION,
    IMPORT_MATCH,
    type ImportJob,
    type ImportMatchPass,
    type ImportResult,
    type ImportReview,
    type ImportRowDecision,
} from '@/types/import';

/**
 * The sentence worth showing when a request fails.
 *
 * The API answers `ProblemDetails`, and its `detail` is written for a person — the upload's
 * rejections say exactly what is wrong with the file. Reading the status alone turns "that export
 * has 8,000 games and the limit is 5,000" into "Something went wrong", which is the mistake the
 * frontend conventions record as having been made once already.
 */
async function problem(response: Response, fallback: string): Promise<string> {
    try {
        const body = (await response.json()) as { detail?: string; title?: string };
        return body.detail ?? body.title ?? fallback;
    } catch {
        return fallback;
    }
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
    if (!response.ok) throw new Error(await problem(response, fallback));
    return (await response.json()) as T;
}

/** Every import this account has run or started, newest first, so an unfinished one can be resumed. */
export function useImportJobs(accountId: string | null) {
    const load = useCallback(
        (signal: AbortSignal) =>
            apiFetch('/api/import/jobs', { signal }).then(r =>
                readJson<ImportJob[]>(r, 'Your imports could not be loaded.')),
        [],
    );

    return useAccountResource<ImportJob[]>(accountId, 'jobs', load);
}

export interface UseImportUploadResult {
    uploading: boolean;
    error: string | null;
    /** Resolves to the new job, or null when the upload was refused — `error` then says why. */
    upload: (file: File) => Promise<ImportJob | null>;
}

/**
 * Sending an export file and getting a job back.
 *
 * Nothing here is account-scoped state: the result is handed straight to the caller, which
 * navigates to it, so there is nothing for a sign-out to leave behind.
 */
export function useImportUpload(): UseImportUploadResult {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = useCallback(async (file: File) => {
        setUploading(true);
        setError(null);

        const body = new FormData();
        body.append('file', file);

        try {
            // `apiFetch`, not bare `fetch`: this is a write, and one sent without the request
            // header is refused with a 403 (ADR 0033). No `Content-Type` is set by hand — the
            // browser has to add the multipart boundary itself.
            const response = await apiFetch('/api/import/jobs', { method: 'POST', body });

            if (!response.ok) {
                setError(await problem(response, 'That file could not be imported.'));
                return null;
            }

            return (await response.json()) as ImportJob;
        } catch {
            // A rejected fetch is the unreachable-API case, which `!response.ok` never reports.
            setError('We could not reach MyVideoGameList just now. Please try again.');
            return null;
        } finally {
            setUploading(false);
        }
    }, []);

    return { uploading, error, upload };
}

export interface UseImportReviewResult {
    review: ImportReview | null;
    loading: boolean;
    error: string | null;
    /** Set when a decision, commit or cancel failed. Separate from `error`, which means the review itself is untrustworthy. */
    actionError: string | null;
    /**
     * The job is over rather than briefly unreachable — committed, cancelled, or deleted by
     * retention. Reloading can only produce the same answer, so the screen offers a way out
     * instead of a retry.
     */
    gone: boolean;
    busy: boolean;
    /** A matching run is in flight. Separate from `busy`, which stops the whole screen. */
    matching: boolean;
    /**
     * A change to the review is still on its way to the server: a decision, or the played group's
     * list. Both are on screen before the server has them, so the commit waits for them — sent past
     * one, it would import what the server held before the change while the screen showed the
     * change. The played group's choice waits too, so a second answer cannot race the first and be
     * rolled back over by it.
     */
    saving: boolean;
    result: ImportResult | null;
    reload: () => void;
    setDecisions: (decisions: ImportRowDecision[]) => Promise<void>;
    /**
     * Puts every row the file says was played, without saying how that ended, into one list — or,
     * given null, back into none (ADR 0045).
     */
    setPlayedStatus: (status: string | null) => Promise<void>;
    /** Looks up the rows whose file named no game, a batch at a time, until none is left. */
    match: () => Promise<void>;
    commit: () => Promise<void>;
    cancel: () => Promise<boolean>;
}

/**
 * One import job: its rows, the decisions made about them, and committing them.
 *
 * The load error and the action error are separate fields. A failed load means there is nothing
 * trustworthy on screen; a failed decision has been rolled back and the rows beside it are fine,
 * so sharing one field would render a failed toggle as "failed to load" and hide a perfectly good
 * review.
 */
export function useImportReview(accountId: string | null, jobId: string): UseImportReviewResult {
    const load = useCallback(
        (signal: AbortSignal) =>
            apiFetch(`/api/import/jobs/${jobId}`, { signal }).then(r => {
                // 404 here is a job's ordinary end, not a hiccup: the API refuses a review of one
                // that has been committed or cancelled, and retention deletes every job in the
                // end. Reloading would ask the same question and get the same answer, so this is
                // marked permanent and the screen stops offering "Try again".
                if (r.status === 404) {
                    throw new PermanentFetchError(
                        'This import is no longer available. Imports are deleted a while after they '
                        + 'are finished, or after they are left unfinished for too long.');
                }

                return readJson<ImportReview>(r, 'This import could not be loaded.');
            }),
        [jobId],
    );

    const { data, loading, error, errorIsPermanent, reload, patch } = useAccountResource<ImportReview>(
        accountId, jobId, load);

    const identity = accountId === null ? null : `${accountId}|${jobId}`;
    const [actions, dispatch] = useReducer(reviewActionReducer, identity, idle);

    // Idempotent by the condition, as in `useAccountResource`: React re-renders at once, the
    // identity then matches, and nothing loops. Applied during render, so there is no committed
    // frame showing the previous job's result.
    if (actions.identity !== identity) dispatch({ type: 'RESET', identity });

    const setDecisions = useCallback(
        async (decisions: ImportRowDecision[]) => {
            if (decisions.length === 0) return;

            const wanted = new Map(decisions.map(d => [d.rowId, d]));

            // Applied locally first so a 600-row screen does not wait on a round trip per click,
            // and put back surgically on failure — restoring a snapshot would undo whichever other
            // change succeeded meanwhile.
            const before = new Map(
                (data?.rows ?? [])
                    .filter(row => wanted.has(row.id))
                    .map(row => [row.id, row]),
            );

            patch(review => applyDecisions(review, decisions));
            dispatch({ type: 'WRITE_START', identity });

            let error: string | null = null;
            try {
                const response = await apiFetch(`/api/import/jobs/${jobId}/rows`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rows: decisions }),
                });

                if (!response.ok) throw new Error(await problem(response, 'That change was not saved.'));
            } catch (err) {
                patch(review => restoreRows(review, before));
                error = err instanceof Error ? err.message : 'That change was not saved.';
            } finally {
                dispatch({ type: 'WRITE_END', identity, error });
            }
        },
        [data, identity, jobId, patch],
    );

    /**
     * One list for every played-but-unresolved row, or none.
     *
     * Applied locally first, like a decision, and undone on failure by putting back each row's own
     * status rather than the row: a box ticked on one of them meanwhile is not this request's to
     * undo. The server finds the rows itself, so the request names only the list.
     */
    const setPlayedStatus = useCallback(
        async (status: string | null) => {
            const before = new Map(
                (data?.rows ?? []).filter(row => row.playedUnresolved).map(row => [row.id, row.status]));

            if (before.size === 0) return;

            patch(review => withPlayedStatus(review, () => status));
            dispatch({ type: 'WRITE_START', identity });

            let error: string | null = null;
            try {
                const response = await apiFetch(`/api/import/jobs/${jobId}/played-status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status }),
                });

                if (!response.ok) throw new Error(await problem(response, 'That change was not saved.'));
            } catch (err) {
                patch(review => withPlayedStatus(review, row => before.get(row.id) ?? null));
                error = err instanceof Error ? err.message : 'That change was not saved.';
            } finally {
                dispatch({ type: 'WRITE_END', identity, error });
            }
        },
        [data, identity, jobId, patch],
    );

    /**
     * One matching pass after another until nothing is left to look up.
     *
     * The server resolves a bounded batch per call — IGDB is paced at four requests a second, and a
     * request that tried to walk five thousand rows would be a timeout rather than a feature — so
     * the loop lives here, where each answer can be put on screen as it lands and the person
     * watching sees the count fall instead of a spinner.
     *
     * It stops when a pass moves nothing out of the unlooked state, which covers both ways this can
     * end: a pass with nothing left to examine returns no rows at all, and a server that has
     * stopped making progress returns rows that did not move. The second matters — without it a
     * browser tab asks a rate-limited third party the same question for ever.
     */
    const match = useCallback(async () => {
        dispatch({ type: 'MATCH_START', identity });

        let error: string | null = null;
        try {
            for (;;) {
                const response = await apiFetch(`/api/import/jobs/${jobId}/match`, { method: 'POST' });
                const pass = await readJson<ImportMatchPass>(response, 'Those games could not be looked up.');

                patch(review => merge(review, pass));

                if (!pass.examined.some(row => row.matchKind !== IMPORT_MATCH.unlooked)) return;
            }
        } catch (err) {
            // Whatever was resolved before the failure is already on screen and already saved: each
            // pass is its own transaction, so this reports the pass that failed rather than undoing
            // the ones that did not.
            error = err instanceof Error ? err.message : 'Those games could not be looked up.';
        } finally {
            dispatch({ type: 'MATCH_END', identity, error });
        }
    }, [identity, jobId, patch]);

    // Read off the state rather than kept in a ref, so it is the count this render shows: the
    // button is disabled on the same value, and this refuses the call a stale handler could make.
    const saving = actions.writes > 0;

    const commit = useCallback(async () => {
        if (saving) return;

        dispatch({ type: 'BUSY_START', identity });
        try {
            const response = await apiFetch(`/api/import/jobs/${jobId}/commit`, { method: 'POST' });
            const result = await readJson<ImportResult>(response, 'The import could not be finished.');
            dispatch({ type: 'BUSY_END', identity, error: null, result });
        } catch (err) {
            dispatch({
                type: 'BUSY_END',
                identity,
                error: err instanceof Error ? err.message : 'The import could not be finished.',
            });
        }
    }, [identity, jobId, saving]);

    const cancel = useCallback(async () => {
        dispatch({ type: 'BUSY_START', identity });
        try {
            const response = await apiFetch(`/api/import/jobs/${jobId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await problem(response, 'That import could not be cancelled.'));
            dispatch({ type: 'BUSY_END', identity, error: null });
            return true;
        } catch (err) {
            dispatch({
                type: 'BUSY_END',
                identity,
                error: err instanceof Error ? err.message : 'That import could not be cancelled.',
            });
            return false;
        }
    }, [identity, jobId]);

    return {
        review: data, loading, error, gone: errorIsPermanent,
        actionError: actions.actionError, busy: actions.busy, matching: actions.matching, saving,
        result: actions.result, reload, setDecisions, setPlayedStatus, match, commit, cancel,
    };
}

/**
 * What the review's own actions are doing, beside whose review it is.
 *
 * Outside `useAccountResource`, so its guard is written here, in the same three parts (ADR 0022):
 * the identity lives in this state rather than in a ref, the move to a new one is applied during
 * render, and every completion is stamped with the identity it was started for and dropped on a
 * mismatch. The reset alone is not enough. A commit or a save still on its way when somebody moves
 * to another job lands after the reset, and would otherwise put its result or its error on that
 * job's screen, or end a save the new job has in flight.
 */
interface ReviewActionState {
    identity: string | null;
    /** Set when a decision, the played group's list, a lookup, a commit or a cancel failed. */
    actionError: string | null;
    /** A commit or a cancel is on its way. */
    busy: boolean;
    matching: boolean;
    /** Changes to the review still on their way to the server. What `saving` is read from. */
    writes: number;
    result: ImportResult | null;
}

type ReviewAction =
    | { type: 'RESET'; identity: string | null }
    | { type: 'WRITE_START'; identity: string | null }
    | { type: 'WRITE_END'; identity: string | null; error: string | null }
    | { type: 'MATCH_START'; identity: string | null }
    | { type: 'MATCH_END'; identity: string | null; error: string | null }
    | { type: 'BUSY_START'; identity: string | null }
    | { type: 'BUSY_END'; identity: string | null; error: string | null; result?: ImportResult };

function idle(identity: string | null): ReviewActionState {
    return { identity, actionError: null, busy: false, matching: false, writes: 0, result: null };
}

/**
 * Every action but the reset names the review it was started for, and one that names another is
 * dropped whole. A start clears the last error, so a banner nobody can dismiss goes on the next
 * attempt; an end that failed sets it, and one that succeeded leaves whatever another failure set.
 */
function reviewActionReducer(state: ReviewActionState, action: ReviewAction): ReviewActionState {
    if (action.type === 'RESET') return idle(action.identity);
    if (action.identity !== state.identity) return state;

    switch (action.type) {
        case 'WRITE_START':
            return { ...state, writes: state.writes + 1, actionError: null };
        case 'WRITE_END':
            return { ...state, writes: state.writes - 1, actionError: action.error ?? state.actionError };
        case 'MATCH_START':
            return { ...state, matching: true, actionError: null };
        case 'MATCH_END':
            return { ...state, matching: false, actionError: action.error ?? state.actionError };
        case 'BUSY_START':
            return { ...state, busy: true, actionError: null };
        case 'BUSY_END':
            return {
                ...state,
                busy: false,
                actionError: action.error ?? state.actionError,
                result: action.result ?? state.result,
            };
    }
}

/**
 * Gives every played-but-unresolved row the status `statusFor` names, and touches nothing else on
 * any row. No recount: which rows are selected does not change with the list they are going into.
 */
function withPlayedStatus(
    review: ImportReview,
    statusFor: (row: ImportReview['rows'][number]) => string | null,
): ImportReview {
    const rows = review.rows.map(row => (row.playedUnresolved ? { ...row, status: statusFor(row) } : row));
    return { ...review, rows };
}

/** Applies decisions to the rows they name, and recounts what the commit button reads. */
function applyDecisions(review: ImportReview, decisions: ImportRowDecision[]): ImportReview {
    const wanted = new Map(decisions.map(d => [d.rowId, d]));

    const rows = review.rows.map(row => {
        const decision = wanted.get(row.id);
        if (!decision) return row;

        return {
            ...row,
            decision: decision.decision,
            ...(decision.status ? { status: decision.status, statusUnrecognised: false } : {}),

            // The alternatives go with the question, exactly as the server drops them: a row whose
            // game has been chosen must stop offering a list that no longer includes the choice.
            ...(decision.gameId
                ? { gameId: decision.gameId, matchKind: IMPORT_MATCH.matched, candidates: [] }
                : {}),
        };
    });

    return { ...review, rows, summary: recount(review, rows) };
}

function restoreRows(review: ImportReview, before: Map<number, ImportReview['rows'][number]>): ImportReview {
    const rows = review.rows.map(row => before.get(row.id) ?? row);
    return { ...review, rows, summary: recount(review, rows) };
}

/**
 * Puts a matching pass's answer over the rows it examined: which game each one is, and nothing the
 * pass did not decide.
 *
 * A pass reads its rows before its slow call to IGDB, so the rest of each row it hands back is as
 * old as that read. The list a row goes into can have changed on this screen since — the played
 * group's choice reaches an id-less row the pass is examining — and taking the pass's copy would put
 * the old list back on screen while the server held the new one, which is what the commit imports.
 * The decision is the pass's only where it set one: it pre-checks a row it resolved to a game the
 * user does not have (`ImportService.MatchAsync`), and leaves every other row's decision as it was.
 */
function merge(review: ImportReview, pass: ImportMatchPass): ImportReview {
    const examined = new Map(pass.examined.map(row => [row.id, row]));

    const rows = review.rows.map(row => {
        const answer = examined.get(row.id);
        if (!answer) return row;

        const preChecked = answer.gameId !== null && !answer.alreadyTracked;

        return {
            ...row,
            gameId: answer.gameId,
            game: answer.game,
            candidates: answer.candidates,
            matchKind: answer.matchKind,
            alreadyTracked: answer.alreadyTracked,
            decision: preChecked ? answer.decision : row.decision,
        };
    });

    return { ...review, job: pass.job, rows, summary: recount(review, rows) };
}

/**
 * The counts the screen reads, recomputed from the rows rather than adjusted by a delta — a delta
 * has to be right about what changed, and this cannot be.
 *
 * Only the two the screen actually reads and local changes actually move. The rest of the summary
 * is the server's own count from the last read: recomputing figures nobody renders would be three
 * more counting rules to keep in step with the ones that produced them.
 */
function recount(review: ImportReview, rows: ImportReview['rows']): ImportReview['summary'] {
    return {
        ...review.summary,
        selected: rows.filter(row => row.decision === IMPORT_DECISION.import).length,
        unlooked: rows.filter(row => row.matchKind === IMPORT_MATCH.unlooked).length,
    };
}
