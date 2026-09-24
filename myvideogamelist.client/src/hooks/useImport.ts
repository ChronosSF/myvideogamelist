import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { PermanentFetchError, useAccountResource } from '@/hooks/useAccountResource';
import {
    IMPORT_DECISION,
    type ImportJob,
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
    result: ImportResult | null;
    reload: () => void;
    setDecisions: (decisions: ImportRowDecision[]) => Promise<void>;
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

    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);

    // These three sit outside `useAccountResource`, so they need its guard applied by hand — a
    // commit that lands after a sign-out or a move to another job would otherwise render one
    // account's imported counts and skipped titles under the next one's name. Reset during render,
    // not in an effect, so there is no committed frame showing the previous job's result.
    const [resultIdentity, setResultIdentity] = useState(
        accountId === null ? null : `${accountId}|${jobId}`);
    const identity = accountId === null ? null : `${accountId}|${jobId}`;

    if (resultIdentity !== identity) {
        setResultIdentity(identity);
        setResult(null);
        setActionError(null);
        setBusy(false);
    }

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
            setActionError(null);

            try {
                const response = await apiFetch(`/api/import/jobs/${jobId}/rows`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rows: decisions }),
                });

                if (!response.ok) throw new Error(await problem(response, 'That change was not saved.'));
            } catch (err) {
                patch(review => restoreRows(review, before));
                setActionError(err instanceof Error ? err.message : 'That change was not saved.');
            }
        },
        [data, jobId, patch],
    );

    const commit = useCallback(async () => {
        setBusy(true);
        setActionError(null);
        try {
            const response = await apiFetch(`/api/import/jobs/${jobId}/commit`, { method: 'POST' });
            setResult(await readJson<ImportResult>(response, 'The import could not be finished.'));
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'The import could not be finished.');
        } finally {
            setBusy(false);
        }
    }, [jobId]);

    const cancel = useCallback(async () => {
        setBusy(true);
        setActionError(null);
        try {
            const response = await apiFetch(`/api/import/jobs/${jobId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await problem(response, 'That import could not be cancelled.'));
            return true;
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'That import could not be cancelled.');
            return false;
        } finally {
            setBusy(false);
        }
    }, [jobId]);

    return {
        review: data, loading, error, gone: errorIsPermanent, actionError, busy, result, reload,
        setDecisions, commit, cancel,
    };
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
            ...(decision.gameId ? { gameId: decision.gameId, matchKind: 'matched' } : {}),
        };
    });

    return { ...review, rows, summary: recount(review, rows) };
}

function restoreRows(review: ImportReview, before: Map<number, ImportReview['rows'][number]>): ImportReview {
    const rows = review.rows.map(row => before.get(row.id) ?? row);
    return { ...review, rows, summary: recount(review, rows) };
}

/**
 * The counts the screen reads, recomputed from the rows rather than adjusted by a delta — a delta
 * has to be right about what changed, and this cannot be.
 */
function recount(review: ImportReview, rows: ImportReview['rows']): ImportReview['summary'] {
    return {
        ...review.summary,
        selected: rows.filter(row => row.decision === IMPORT_DECISION.import).length,
        statusUnrecognised: rows.filter(row => row.statusUnrecognised).length,
        unmatched: rows.filter(row => row.gameId === null).length,
        matched: rows.filter(row => row.gameId !== null).length,
    };
}
