import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { useImportJobs, useImportUpload } from '@/hooks/useImport';
import { IMPORT_STATE } from '@/types/import';
import { formatCount } from '@/lib/format';
import { expiresInWords } from '@/lib/importExpiry';
import { useHydrated } from '@/lib/useHydrated';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';

/** One person's import history, so never cacheable. Declared rather than inherited from the root. */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'Import your games - MyVideoGameList' },
        { name: 'description', content: 'Bring your games across from another tracker.' },
        NOINDEX,
    ];
}

/**
 * Where an import starts: pick a file, or pick up one already waiting.
 *
 * The upload does not stream or poll. Parsing an export makes no network call of its own — Grouvee
 * carries IGDB's ids, so there is nothing to look up (ADR 0037) — and the response is the job to
 * review, which this navigates straight to.
 */
export function ImportPage() {
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const { data: jobs, loading, error } = useImportJobs(user?.id ?? null);
    const { uploading, error: uploadError, upload } = useImportUpload();
    const [dragging, setDragging] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    // Nobody is signed in or out until auth has answered: the server render never knows, and the
    // first client render has to match it.
    const signedIn = !authLoading && user !== null;
    const signedOut = !authLoading && user === null;

    const send = async (file: File | undefined) => {
        if (!file) return;
        const job = await upload(file);
        if (job) await navigate(`/import/${job.id}`);
    };

    const pending = (jobs ?? []).filter(job => job.state === IMPORT_STATE.pending);
    const finished = (jobs ?? []).filter(job => job.state === IMPORT_STATE.done);

    // After hydration only: the phrase is relative to the reader's clock, which the server render
    // cannot know. The server sends the date, so nothing here holds a copy of the retention
    // windows — see `@/lib/importExpiry`.
    const hydrated = useHydrated();
    const expiresIn = (expiresAt: string) => (hydrated ? expiresInWords(expiresAt) : null);

    return (
        <div className="min-h-screen">
            <PageHeader
                title="Import your games"
                width="4xl"
                description="Bring your library across from another tracker. You see everything before anything is saved."
            />

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                {signedOut && (
                    <p className="text-center text-fg-muted font-medium py-24">
                        Sign in to import your games.
                    </p>
                )}

                {signedIn && (
                    <>
                        <section aria-labelledby="import-source">
                            <h2 id="import-source" className="type-display text-2xl text-fg-strong border-t-2 border-fg-strong pt-4 mb-2">
                                From Grouvee
                            </h2>
                            <p className="text-fg-muted text-sm mb-4">
                                In Grouvee, open <span className="text-fg-soft">Settings → Export</span>{' '}
                                and download your collection. Either format works, though the{' '}
                                <span className="text-fg-soft">JSON</span> one carries a little more —
                                games you played and later took off your shelves are only in that file.
                            </p>

                            {/* A label wrapping the input is what makes the whole panel a valid
                                drop target and a keyboard-reachable file picker at once, without
                                a div pretending to be a button. */}
                            <label
                                className={`flex flex-col items-center justify-center gap-3 w-full px-6 py-12 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                                    dragging
                                        ? 'border-primary-500 bg-primary-500/10'
                                        : 'border-line-strong hover:border-fg-faint'
                                }`}
                                onDragOver={event => {
                                    event.preventDefault();
                                    setDragging(true);
                                }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={event => {
                                    event.preventDefault();
                                    setDragging(false);
                                    void send(event.dataTransfer.files[0]);
                                }}
                            >
                                <svg className="w-10 h-10 text-fg-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6H16a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12" />
                                </svg>
                                <span className="text-fg-soft font-medium">
                                    {uploading ? 'Reading your file…' : 'Drop your export here, or choose a file'}
                                </span>
                                <span className="text-fg-faint text-xs">
                                    .json or .csv, up to 5 MB
                                </span>
                                <input
                                    ref={input}
                                    type="file"
                                    accept=".json,.csv,application/json,text/csv"
                                    className="sr-only"
                                    disabled={uploading}
                                    onChange={event => {
                                        void send(event.target.files?.[0]);
                                        // Cleared so choosing the same file twice fires again —
                                        // which is exactly what somebody does after a rejection.
                                        event.target.value = '';
                                    }}
                                />
                            </label>

                            {uploadError && (
                                <p className="mt-3 text-sm text-danger-300 bg-danger-900/20 border border-danger-700/50 rounded-lg px-4 py-3" role="alert">
                                    {uploadError}
                                </p>
                            )}
                        </section>

                        {loading && (
                            <p className="text-fg-muted text-sm" role="status">
                                Looking for imports you have already started…
                            </p>
                        )}

                        {!loading && error && (
                            <p className="text-sm text-danger-300 bg-danger-900/20 border border-danger-700/50 rounded-lg px-4 py-3" role="alert">
                                {error}
                            </p>
                        )}

                        {/* §C6's empty state, and the one this page shows most often: an account
                            that has never imported is exactly the account reading these
                            instructions. Without it the fetch resolves and the bottom half of the
                            screen simply goes blank, which reads as something having failed. */}
                        {!loading && !error && jobs?.length === 0 && (
                            <p className="text-fg-muted text-sm" role="status">
                                You have not imported anything yet. Once you upload a file it stays here
                                until you finish reviewing it, so you can close this page and come back.
                            </p>
                        )}

                        {pending.length > 0 && (
                            <section aria-labelledby="import-pending">
                                <h2 id="import-pending" className="type-display text-2xl text-fg-strong border-t-2 border-fg-strong pt-4 mb-4">
                                    Waiting for you
                                </h2>
                                <ul className="border-t border-line">
                                    {pending.map(job => (
                                        <li key={job.id}>
                                            <Link
                                                to={`/import/${job.id}`}
                                                className="group flex items-center justify-between gap-4 py-3.5 border-b border-line"
                                            >
                                                <span className="min-w-0">
                                                    <span className="block type-title text-fg-strong truncate group-hover:underline decoration-line-strong underline-offset-4">
                                                        {job.fileName}
                                                    </span>
                                                    {expiresIn(job.expiresAt) && (
                                                        <span className="block text-fg-faint text-xs mt-0.5">
                                                            Deleted {expiresIn(job.expiresAt)} if you do not come back to it
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="text-fg-muted text-xs shrink-0">
                                                    {formatCount(job.rowCount)} games — review
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {finished.length > 0 && (
                            <section aria-labelledby="import-done">
                                <h2 id="import-done" className="type-display text-2xl text-fg-strong border-t-2 border-fg-strong pt-4 mb-2">
                                    Already imported
                                </h2>
                                <p className="text-fg-muted text-sm mb-3">
                                    The games are in your lists. These are only the receipts, and they are
                                    tidied away a few days after the import finishes.
                                </p>
                                <ul className="border-t border-line text-sm">
                                    {finished.map(job => (
                                        <li
                                            key={job.id}
                                            className="flex items-center justify-between gap-4 py-3.5 border-b border-line"
                                        >
                                            <span className="min-w-0">
                                                <span className="block text-fg-soft truncate">
                                                    {job.fileName}
                                                </span>
                                                {expiresIn(job.expiresAt) && (
                                                    <span className="block text-fg-faint text-xs mt-0.5">
                                                        Receipt deleted {expiresIn(job.expiresAt)}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="text-fg-faint text-xs shrink-0">
                                                {formatCount(job.importedCount ?? 0)} imported,{' '}
                                                {formatCount(job.skippedCount ?? 0)} skipped
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default ImportPage;
