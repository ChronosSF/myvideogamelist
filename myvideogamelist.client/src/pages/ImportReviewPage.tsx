import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useLists } from '@/hooks/useLists';
import { useImportReview } from '@/hooks/useImport';
import { downloadSkippedRows } from '@/lib/importReport';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';
import { LIST_IDS, LIST_NAMES, type ListId } from '@/types/list';
import { IMPORT_DECISION, type ImportReviewRow } from '@/types/import';

export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'Review your import - MyVideoGameList' },
        { name: 'description', content: 'Check what will be imported before anything is saved.' },
        NOINDEX,
    ];
}

/** Which rows the table is showing. "Needs you" is the whole point of the screen. */
type Filter = 'attention' | 'importing' | 'all';

/**
 * How many rows are rendered before the "show more" button.
 *
 * A real export runs to several hundred rows, and rendering all of them costs a visibly slow first
 * paint for a screen most people skim and accept. A window plus a filter does what §C3's
 * virtualisation was for without a dependency, and the filter is the better tool anyway: nobody
 * scrolls 600 rows looking for the twelve that need a decision.
 */
const PAGE = 100;

export function ImportReviewPage() {
    const { jobId = '' } = useParams();
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const { nameFor, namesStatus } = useLists();

    const { review, loading, error, actionError, busy, result, reload, setDecisions, commit, cancel } =
        useImportReview(user?.id ?? null, jobId);

    const [filter, setFilter] = useState<Filter>('attention');
    const [shown, setShown] = useState(PAGE);

    const signedOut = !authLoading && user === null;

    // A rename is the user's own label, so it is what a status reads — except while the names are
    // still loading or failed to load, when the defaults are the honest fallback (ADR 0031).
    const label = (status: string | null) => {
        if (status === null) return 'No list';
        const id = status as ListId;
        return namesStatus === 'ready' ? nameFor(id) : (LIST_NAMES[id] ?? status);
    };

    // Memoised rather than derived inline: a fresh `[]` every render would change the identity
    // the filter below depends on, and re-filter several hundred rows on each one.
    const rows = useMemo(() => review?.rows ?? [], [review]);

    const visible = useMemo(() => {
        if (filter === 'importing') return rows.filter(r => r.decision === IMPORT_DECISION.import);
        if (filter === 'attention') return rows.filter(needsAttention);
        return rows;
    }, [rows, filter]);

    const decide = (row: ImportReviewRow, decision: typeof IMPORT_DECISION[keyof typeof IMPORT_DECISION]) =>
        void setDecisions([{ rowId: row.id, decision }]);

    const bulk = (wanted: ImportReviewRow[], decision: typeof IMPORT_DECISION[keyof typeof IMPORT_DECISION]) =>
        void setDecisions(
            wanted.filter(r => r.decision !== decision).map(r => ({ rowId: r.id, decision })));

    if (signedOut) {
        return (
            <p className="text-center text-slate-400 light:text-slate-600 font-medium py-24">
                Sign in to review your import.
            </p>
        );
    }

    // The import is over. Everything before this is about what *will* happen; this is what did.
    if (result) {
        return (
            <ResultPanel
                imported={result.job.importedCount ?? 0}
                skipped={result.skipped}
                fileName={result.job.fileName}
            />
        );
    }

    return (
        <div className="min-h-screen">
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <h1 className="text-2xl sm:text-3xl font-bold text-white light:text-slate-900 mb-1">
                        Review your import
                    </h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm">
                        {review ? `${review.job.fileName} — nothing is saved until you finish.` : 'Loading…'}
                    </p>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
                {(authLoading || loading) && (
                    <p className="text-slate-400 light:text-slate-600 text-sm py-16 text-center" role="status">
                        Loading your import…
                    </p>
                )}

                {!loading && error && (
                    <div className="text-center py-16" role="alert">
                        <p className="text-red-300 font-medium mb-3">{error}</p>
                        <button
                            type="button"
                            onClick={reload}
                            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-semibold rounded-lg"
                        >
                            Try again
                        </button>
                    </div>
                )}

                {/* A failed decision has already been rolled back, so it is shown beside the rows
                    rather than instead of them — the review underneath it is fine. */}
                {actionError && (
                    <p className="text-sm text-red-300 bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-3" role="alert">
                        {actionError}
                    </p>
                )}

                {review && !loading && !error && (
                    <>
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <Tile label="Games in file" value={review.summary.total} />
                            <Tile label="Will import" value={review.summary.selected} />
                            <Tile label="Already in your lists" value={review.summary.alreadyTracked} />
                            <Tile label="Need a decision" value={review.summary.unmatched + review.summary.statusUnrecognised} />
                        </dl>

                        <div className="flex flex-wrap items-center gap-2">
                            <FilterButton active={filter === 'attention'} onClick={() => setFilter('attention')}>
                                Needs you ({rows.filter(needsAttention).length})
                            </FilterButton>
                            <FilterButton active={filter === 'importing'} onClick={() => setFilter('importing')}>
                                Importing ({review.summary.selected})
                            </FilterButton>
                            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
                                All ({review.summary.total})
                            </FilterButton>

                            <span className="grow" />

                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 light:bg-slate-100 text-slate-300 light:text-slate-700 hover:bg-slate-700 light:hover:bg-slate-200"
                                onClick={() => bulk(rows.filter(r => r.gameId !== null), IMPORT_DECISION.import)}
                            >
                                Select every matched game
                            </button>
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 light:bg-slate-100 text-slate-300 light:text-slate-700 hover:bg-slate-700 light:hover:bg-slate-200"
                                onClick={() => bulk(rows, IMPORT_DECISION.skip)}
                            >
                                Clear all
                            </button>
                        </div>

                        {visible.length === 0 && (
                            <p className="text-slate-400 light:text-slate-600 text-sm py-12 text-center">
                                {filter === 'attention'
                                    ? 'Nothing needs a decision — every game was matched and understood.'
                                    : 'No games here.'}
                            </p>
                        )}

                        <ul className="space-y-2">
                            {visible.slice(0, shown).map(row => (
                                <li
                                    key={row.id}
                                    className="flex items-start gap-3 px-3 py-3 bg-slate-800/50 light:bg-white border border-slate-700/70 light:border-slate-200 rounded-lg"
                                >
                                    <input
                                        type="checkbox"
                                        className="mt-1 size-4 shrink-0 accent-blue-500"
                                        checked={row.decision === IMPORT_DECISION.import}
                                        aria-label={`Import ${row.title}`}
                                        onChange={event =>
                                            decide(row, event.target.checked ? IMPORT_DECISION.import : IMPORT_DECISION.skip)}
                                    />

                                    {row.game?.coverImageUrl ? (
                                        <img
                                            src={row.game.coverImageUrl}
                                            alt=""
                                            className="w-9 h-12 object-cover rounded shrink-0"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="w-9 h-12 rounded bg-slate-700/60 light:bg-slate-200 shrink-0" aria-hidden="true" />
                                    )}

                                    <div className="min-w-0 grow">
                                        <p className="text-slate-100 light:text-slate-900 text-sm font-medium truncate">
                                            {row.title}
                                            {row.releaseYear !== null && (
                                                <span className="text-slate-500 light:text-slate-400 font-normal"> ({row.releaseYear})</span>
                                            )}
                                        </p>

                                        <p className="text-xs text-slate-400 light:text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <span>{label(row.status)}</span>
                                            {row.score !== null && <span>· {row.score}/10</span>}
                                            {row.playthroughCount > 0 && (
                                                <span>
                                                    · {row.playthroughCount} {row.playthroughCount === 1 ? 'playthrough' : 'playthroughs'}
                                                    {row.minutesPlayed !== null && ` (${Math.round(row.minutesPlayed / 60)}h)`}
                                                </span>
                                            )}
                                            {row.wishlist && <Badge>Wishlist</Badge>}
                                            {row.favourite && <Badge>Favourite</Badge>}
                                            {row.hasNotes && <Badge>Notes</Badge>}
                                            {row.alreadyTracked && <Badge tone="amber">Already in your lists</Badge>}
                                            {row.gameId === null && <Badge tone="red">No game matched</Badge>}
                                        </p>

                                        {/* An unrecognised shelf is asked about rather than
                                            defaulted — the rule from the spec §3.2. */}
                                        {row.statusUnrecognised && (
                                            <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400 light:text-slate-500">
                                                <span>
                                                    Your file said “{row.sourceStatus}”, which we do not know. Put it in:
                                                </span>
                                                <select
                                                    className="bg-slate-900 light:bg-white border border-slate-600 light:border-slate-300 rounded px-2 py-1 text-slate-200 light:text-slate-800"
                                                    defaultValue=""
                                                    onChange={event => {
                                                        if (!event.target.value) return;
                                                        void setDecisions([{
                                                            rowId: row.id,
                                                            decision: IMPORT_DECISION.import,
                                                            status: event.target.value,
                                                        }]);
                                                    }}
                                                >
                                                    <option value="" disabled>Choose a list</option>
                                                    {LIST_IDS.map(id => (
                                                        <option key={id} value={id}>{label(id)}</option>
                                                    ))}
                                                </select>
                                            </label>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        {visible.length > shown && (
                            <button
                                type="button"
                                className="w-full py-2 text-sm font-semibold text-slate-300 light:text-slate-700 bg-slate-800 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200 rounded-lg"
                                onClick={() => setShown(count => count + PAGE)}
                            >
                                Show more ({visible.length - shown} left)
                            </button>
                        )}

                        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800 light:border-slate-200">
                            <button
                                type="button"
                                disabled={busy || review.summary.selected === 0}
                                onClick={() => void commit()}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
                            >
                                {busy ? 'Importing…' : `Import ${review.summary.selected} games`}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={async () => {
                                    if (await cancel()) await navigate('/import');
                                }}
                                className="px-4 py-2.5 text-sm font-semibold text-slate-400 light:text-slate-600 hover:text-slate-200 light:hover:text-slate-900"
                            >
                                Cancel this import
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * A row the user has to look at: one with no game matched, or one whose shelf we did not
 * understand. An already-tracked row is not here — it has a safe default and needs no decision.
 */
function needsAttention(row: ImportReviewRow): boolean {
    return row.gameId === null || row.statusUnrecognised;
}

function Tile({ label, value }: { label: string; value: number }) {
    return (
        <div className="px-4 py-3 bg-slate-800/50 light:bg-white border border-slate-700/70 light:border-slate-200 rounded-lg">
            <dt className="text-xs text-slate-400 light:text-slate-500">{label}</dt>
            <dd className="text-xl font-bold text-white light:text-slate-900">{value}</dd>
        </div>
    );
}

function FilterButton({ active, onClick, children }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                active
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 light:bg-slate-100 text-slate-300 light:text-slate-700 hover:bg-slate-700 light:hover:bg-slate-200'
            }`}
        >
            {children}
        </button>
    );
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'amber' | 'red' }) {
    const tones = {
        slate: 'bg-slate-700/60 text-slate-300 light:bg-slate-100 light:text-slate-600',
        amber: 'bg-amber-900/40 text-amber-300 light:bg-amber-100 light:text-amber-700',
        red: 'bg-red-900/40 text-red-300 light:bg-red-100 light:text-red-700',
    };
    return <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

/**
 * What the import did, and what it did not.
 *
 * The skipped rows are downloadable rather than only counted: §C5's promise is that nothing is
 * silently lost, and a number does not tell somebody which games to add by hand.
 */
function ResultPanel({ imported, skipped, fileName }: {
    imported: number;
    skipped: { title: string; sourceStatus: string | null; reason: string }[];
    fileName: string;
}) {
    return (
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
            <h1 className="text-2xl font-bold text-white light:text-slate-900 mb-2">Import finished</h1>
            <p className="text-slate-400 light:text-slate-600 mb-8">
                {imported} {imported === 1 ? 'game is' : 'games are'} now in your lists.
                {skipped.length > 0 && ` ${skipped.length} ${skipped.length === 1 ? 'was' : 'were'} skipped.`}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                    to="/lists"
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                    See your lists
                </Link>

                {skipped.length > 0 && (
                    <button
                        type="button"
                        onClick={() => downloadSkippedRows(skipped, `${fileName}-skipped.csv`)}
                        className="px-4 py-2.5 text-sm font-semibold text-slate-300 light:text-slate-700 bg-slate-800 light:bg-slate-100 hover:bg-slate-700 light:hover:bg-slate-200 rounded-lg"
                    >
                        Download what was skipped
                    </button>
                )}
            </div>
        </div>
    );
}

export default ImportReviewPage;
