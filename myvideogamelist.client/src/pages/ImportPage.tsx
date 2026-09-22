import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useImportJobs, useImportUpload } from '@/hooks/useImport';
import { IMPORT_STATE } from '@/types/import';
import { formatCount } from '@/lib/format';
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

    return (
        <div className="min-h-screen">
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">
                        Import your games
                    </h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                        Bring your library across from another tracker. You see everything before
                        anything is saved.
                    </p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                {signedOut && (
                    <p className="text-center text-slate-400 light:text-slate-600 font-medium py-24">
                        Sign in to import your games.
                    </p>
                )}

                {signedIn && (
                    <>
                        <section aria-labelledby="import-source">
                            <h2 id="import-source" className="text-lg font-semibold text-white light:text-slate-900 mb-1">
                                From Grouvee
                            </h2>
                            <p className="text-slate-400 light:text-slate-600 text-sm mb-4">
                                In Grouvee, open <span className="text-slate-300 light:text-slate-700">Settings → Export</span>{' '}
                                and download your collection. Either format works, though the{' '}
                                <span className="text-slate-300 light:text-slate-700">JSON</span> one carries a little more —
                                games you played and later took off your shelves are only in that file.
                            </p>

                            {/* A label wrapping the input is what makes the whole panel a valid
                                drop target and a keyboard-reachable file picker at once, without
                                a div pretending to be a button. */}
                            <label
                                className={`flex flex-col items-center justify-center gap-3 w-full px-6 py-12 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                                    dragging
                                        ? 'border-blue-500 bg-blue-500/10'
                                        : 'border-slate-700 light:border-slate-300 hover:border-slate-500 light:hover:border-slate-400'
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
                                <svg className="w-10 h-10 text-slate-600 light:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6H16a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12" />
                                </svg>
                                <span className="text-slate-300 light:text-slate-700 font-medium">
                                    {uploading ? 'Reading your file…' : 'Drop your export here, or choose a file'}
                                </span>
                                <span className="text-slate-500 light:text-slate-400 text-xs">
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
                                <p className="mt-3 text-sm text-red-300 bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-3" role="alert">
                                    {uploadError}
                                </p>
                            )}
                        </section>

                        {loading && (
                            <p className="text-slate-400 light:text-slate-600 text-sm" role="status">
                                Looking for imports you have already started…
                            </p>
                        )}

                        {!loading && error && (
                            <p className="text-sm text-red-300 bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-3" role="alert">
                                {error}
                            </p>
                        )}

                        {pending.length > 0 && (
                            <section aria-labelledby="import-pending">
                                <h2 id="import-pending" className="text-lg font-semibold text-white light:text-slate-900 mb-3">
                                    Waiting for you
                                </h2>
                                <ul className="space-y-2">
                                    {pending.map(job => (
                                        <li key={job.id}>
                                            <Link
                                                to={`/import/${job.id}`}
                                                className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-800/60 light:bg-white border border-slate-700 light:border-slate-200 rounded-lg hover:border-slate-500 transition-colors"
                                            >
                                                <span className="text-slate-200 light:text-slate-800 text-sm font-medium truncate">
                                                    {job.fileName}
                                                </span>
                                                <span className="text-slate-400 light:text-slate-500 text-xs shrink-0">
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
                                <h2 id="import-done" className="text-lg font-semibold text-white light:text-slate-900 mb-3">
                                    Already imported
                                </h2>
                                <ul className="space-y-2 text-sm">
                                    {finished.map(job => (
                                        <li
                                            key={job.id}
                                            className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-800/40 light:bg-slate-50 border border-slate-800 light:border-slate-200 rounded-lg"
                                        >
                                            <span className="text-slate-300 light:text-slate-700 truncate">{job.fileName}</span>
                                            <span className="text-slate-500 light:text-slate-400 text-xs shrink-0">
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
