import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useLists } from '@/hooks/useLists';
import { useImportReview } from '@/hooks/useImport';
import { downloadSkippedRows } from '@/lib/importReport';
import { expiresInWords } from '@/lib/importExpiry';
import { releaseYear } from '@/lib/releaseDate';
import { useHydrated } from '@/lib/useHydrated';
import { formatCount } from '@/lib/format';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';
import type { GameDto } from '@/types/game';
import { LIST_IDS, LIST_NAMES, type ListId } from '@/types/list';
import { IMPORT_DECISION, IMPORT_MATCH, type ImportReviewRow } from '@/types/import';

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

    const {
        review, loading, error, gone, actionError, busy, matching, result,
        reload, setDecisions, match, commit, cancel,
    } = useImportReview(user?.id ?? null, jobId);

    // After hydration only: the phrase is relative to the reader's clock, which the server render
    // cannot know. See `useHydrated`.
    const hydrated = useHydrated();
    const expiresIn = hydrated && review ? expiresInWords(review.job.expiresAt) : null;

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

    // Memoised for the same reason `rows` is: it is read three times a render — the tile, the
    // filter's own label, and the list itself — over up to five thousand rows.
    const attention = useMemo(() => rows.filter(needsAttention), [rows]);

    const visible = useMemo(() => {
        if (filter === 'importing') return rows.filter(r => r.decision === IMPORT_DECISION.import);
        if (filter === 'attention') return attention;
        return rows;
    }, [rows, attention, filter]);

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
                    {expiresIn && (
                        <p className="text-slate-500 light:text-slate-500 text-xs mt-1">
                            An import left unfinished is deleted {expiresIn}, along with the decisions
                            made on it. Saving any decision starts that over.
                        </p>
                    )}
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
                        {/* A job that is over cannot come back, and this is now how every job ends:
                            committed, cancelled, or deleted by retention. Offering the reload that
                            produced the 404 would only produce it again. */}
                        {gone ? (
                            <Link
                                to="/import"
                                className="inline-block px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg"
                            >
                                Back to your imports
                            </Link>
                        ) : (
                            <button
                                type="button"
                                onClick={reload}
                                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-semibold rounded-lg"
                            >
                                Try again
                            </button>
                        )}
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
                            {/* Counted off the rows rather than added up out of the summary, which
                                would count a row twice when its game is unknown *and* its shelf
                                is — and which is the same set the "Needs you" filter shows. */}
                            <Tile label="Need a decision" value={attention.length} />
                        </dl>

                        {/* Offered rather than done on arrival: it spends IGDB's budget and takes
                            real time, so it is somebody asking for it. Absent once every row has
                            been looked at, because asking again would return the same answers. */}
                        {review.summary.unlooked > 0 && (
                            <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-blue-950/40 light:bg-blue-50 border border-blue-800/50 light:border-blue-200 rounded-lg">
                                <p className="text-sm text-slate-300 light:text-slate-700 grow">
                                    {formatCount(review.summary.unlooked)}{' '}
                                    {review.summary.unlooked === 1 ? 'game was' : 'games were'} exported
                                    without an id. We can search for {review.summary.unlooked === 1 ? 'it' : 'them'} by
                                    name — you still choose anything we are not sure about.
                                </p>
                                <button
                                    type="button"
                                    disabled={matching || busy}
                                    onClick={() => void match()}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                                >
                                    {matching
                                        ? `Searching… ${formatCount(review.summary.unlooked)} left`
                                        : 'Find these games'}
                                </button>
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                            <FilterButton active={filter === 'attention'} onClick={() => setFilter('attention')}>
                                Needs you ({formatCount(attention.length)})
                            </FilterButton>
                            <FilterButton active={filter === 'importing'} onClick={() => setFilter('importing')}>
                                Importing ({formatCount(review.summary.selected)})
                            </FilterButton>
                            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
                                All ({formatCount(review.summary.total)})
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
                                    {/* Disabled while no game is matched — ticking such a row would
                                        count it in "will import" and then have the commit skip it,
                                        a promise the screen cannot keep. An ambiguous row is ticked
                                        by choosing one of its candidates below, which resolves and
                                        selects it in one click (§M3). */}
                                    <input
                                        type="checkbox"
                                        className="mt-1 size-4 shrink-0 accent-blue-500 disabled:opacity-40"
                                        checked={row.decision === IMPORT_DECISION.import}
                                        disabled={row.gameId === null}
                                        aria-label={`Import ${row.title}`}
                                        title={row.gameId === null
                                            ? 'We could not match this to a game, so it cannot be imported yet.'
                                            : undefined}
                                        onChange={event =>
                                            decide(row, event.target.checked ? IMPORT_DECISION.import : IMPORT_DECISION.skip)}
                                    />

                                    <Cover url={row.game?.coverImageUrl} className="w-9 h-12" />

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
                                            {row.matchKind === IMPORT_MATCH.ambiguous && (
                                                <Badge tone="amber">Which one is it?</Badge>
                                            )}
                                            {row.matchKind === IMPORT_MATCH.unmatched && (
                                                <Badge tone="red">No game matched</Badge>
                                            )}
                                        </p>

                                        {/* §M3: the alternatives, with cover and year, so the row
                                            is resolved by recognising a game rather than by reading
                                            one. Choosing also selects the row — somebody who has
                                            just said "that one" has said they want it. */}
                                        {row.candidates.length > 0 && (
                                            <div className="mt-2">
                                                <p className="text-xs text-slate-400 light:text-slate-500 mb-1.5">
                                                    We found {row.candidates.length === 1 ? 'a close match' : 'more than one'}.
                                                    Which did you play?
                                                </p>
                                                <ul className="flex flex-wrap gap-2">
                                                    {row.candidates.map(candidate => (
                                                        <li key={candidate.id}>
                                                            <CandidateButton
                                                                candidate={candidate}
                                                                onChoose={() => void setDecisions([{
                                                                    rowId: row.id,
                                                                    decision: IMPORT_DECISION.import,
                                                                    gameId: candidate.id,
                                                                }])}
                                                            />
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

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
                                Show more ({formatCount(visible.length - shown)} left)
                            </button>
                        )}

                        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800 light:border-slate-200">
                            <button
                                type="button"
                                disabled={busy || review.summary.selected === 0}
                                onClick={() => void commit()}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
                            >
                                {busy ? 'Importing…' : `Import ${formatCount(review.summary.selected)} games`}
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

/** A game's cover, or the space one would take. */
function Cover({ url, className }: { url?: string | null; className: string }) {
    return url
        ? <img src={url} alt="" className={`${className} object-cover rounded shrink-0`} loading="lazy" />
        : <div className={`${className} rounded bg-slate-700/60 light:bg-slate-200 shrink-0`} aria-hidden="true" />;
}

/**
 * One game the matcher offered, as something to recognise and press.
 *
 * Named rather than left to its own text: a row of buttons each reading "Resident Evil 2 (1998)"
 * says what they are and not what pressing one does. The visible text is inside the label, so
 * "click Resident Evil 2" still works by voice.
 */
function CandidateButton({ candidate, onChoose }: { candidate: GameDto; onChoose: () => void }) {
    const year = candidate.releaseDate === null ? null : releaseYear(candidate.releaseDate);

    return (
        <button
            type="button"
            aria-label={`Use ${candidate.title}${year === null ? '' : ` (${year})`}`}
            onClick={onChoose}
            className="flex items-center gap-2 pl-1 pr-2.5 py-1 bg-slate-900/60 light:bg-slate-50 border border-slate-600 light:border-slate-300 hover:border-blue-500 rounded-lg text-left transition-colors"
        >
            <Cover url={candidate.coverImageUrl} className="w-6 h-8" />
            <span className="text-xs text-slate-200 light:text-slate-800 font-medium">
                {candidate.title}
                {year !== null && (
                    <span className="text-slate-500 light:text-slate-400 font-normal">{' '}({year})</span>
                )}
            </span>
        </button>
    );
}

function Tile({ label, value }: { label: string; value: number }) {
    return (
        <div className="px-4 py-3 bg-slate-800/50 light:bg-white border border-slate-700/70 light:border-slate-200 rounded-lg">
            <dt className="text-xs text-slate-400 light:text-slate-500">{label}</dt>
            <dd className="text-xl font-bold text-white light:text-slate-900">{formatCount(value)}</dd>
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
                {formatCount(imported)} {imported === 1 ? 'game is' : 'games are'} now in your lists.
                {skipped.length > 0 && ` ${formatCount(skipped.length)} ${skipped.length === 1 ? 'was' : 'were'} skipped.`}
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
