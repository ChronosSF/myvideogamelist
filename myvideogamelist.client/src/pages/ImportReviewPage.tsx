import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GameCover } from '@/components/GameCover';
import { ImportCandidateButton } from '@/components/ImportCandidateButton';
import { ImportRowSearch } from '@/components/ImportRowSearch';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import { useFavourites } from '@/hooks/useFavourites';
import { useImportReview } from '@/hooks/useImport';
import { downloadSkippedRows } from '@/lib/importReport';
import { expiresInWords } from '@/lib/importExpiry';
import { titleAndYear } from '@/lib/releaseDate';
import { useHydrated } from '@/lib/useHydrated';
import { formatCount, formatCountOf } from '@/lib/format';
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

/**
 * What the played-but-unresolved choice shows when its rows disagree. Only a write from outside this
 * screen can cause that, since the one request that sets the group sets every row of it.
 */
const MIXED = 'mixed';

export function ImportReviewPage() {
    const { jobId = '' } = useParams();
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const { nameFor, namesStatus, reload: reloadLists } = useLists();
    const { reload: reloadWishlist } = useWishlist();
    const { reload: reloadFavourites } = useFavourites();

    const {
        review, loading, error, gone, actionError, busy, matching, saving, result,
        reload, setDecisions, setPlayedStatus, match, commit, cancel,
    } = useImportReview(user?.id ?? null, jobId);

    /**
     * Commits, then has the lists, the wishlist and the favourites fetched again.
     *
     * The import writes all three on the server, around the providers that hold them. Each loads
     * once per account and lives above every page, so without this the lists stay as they were
     * before the import until the page is reloaded — empty, for somebody importing into an empty
     * account.
     */
    const commitAndRefresh = async () => {
        if (!(await commit())) return;
        reloadLists();
        reloadWishlist();
        reloadFavourites();
    };

    const playedChoiceId = useId();

    // After hydration only: the phrase is relative to the reader's clock, which the server render
    // cannot know. See `useHydrated`.
    const hydrated = useHydrated();
    const expiresIn = hydrated && review ? expiresInWords(review.job.expiresAt) : null;

    const [filter, setFilter] = useState<Filter>('attention');
    const [shown, setShown] = useState(PAGE);

    // The row whose search is open, if any. One at a time: each open search asks IGDB for its own
    // term, and a screen of open panels is no longer a list somebody can work down.
    const [searchingRow, setSearchingRow] = useState<number | null>(null);

    // What the last choice of a game did, read out politely. The row it was made on changes under
    // the press — the candidates go with the question, the search closes — and under "Needs you"
    // the row itself leaves, so without this nothing says that the press did anything.
    const [chosen, setChosen] = useState('');

    const listRef = useRef<HTMLUListElement>(null);
    const nothingLeftRef = useRef<HTMLParagraphElement>(null);

    // Where focus goes after a choice, consumed once the rows have re-rendered. A ref, because it is
    // a request to the DOM about the next commit rather than something to render; the tick beside it
    // makes a commit happen after a failed save, whose rollback may already have rendered.
    const refocus = useRef<{ rowId: number; index: number } | null>(null);
    const [refocusTick, setRefocusTick] = useState(0);

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

    // Games rather than rows wherever a row's game is known, because a game is what lands in
    // somebody's library and two rows can name one — a source listing a game once per platform, or
    // the same game chosen for two rows (issue 300). The commit makes one entry of them, and its
    // result panel counts the games it wrote, so a button that counted rows promised more than that.
    // Counted off the rows, as `attention` is, rather than kept in the summary beside them, and only
    // the rows with a game: the commit skips one with none, and counted here it would have the tile
    // say "from 3 rows" over two games that no two rows share.
    const importing = useMemo(() => {
        const selected = rows.filter(row => row.decision === IMPORT_DECISION.import && row.gameId !== null);
        return { rows: selected.length, games: gamesNamed(selected) };
    }, [rows]);
    const trackedGames = useMemo(() => gamesNamed(rows.filter(row => row.alreadyTracked)), [rows]);

    // The played-but-unresolved group's list, read back off its rows rather than held beside them,
    // so the choice can never say one thing while the rows say another.
    const playedStatus = useMemo(() => {
        const statuses = new Set(rows.filter(row => row.playedUnresolved).map(row => row.status));
        return statuses.size > 1 ? MIXED : ([...statuses][0] ?? null);
    }, [rows]);

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

    /**
     * A game chosen for a row, whether the matcher offered it (§M3) or the row's own search found it
     * (§M4): one write, the decision endpoint's, and one way of choosing (issue 158). Choosing also
     * selects the row — somebody who has just said "that one" has said they want it — unless the
     * user already has the game. Importing it would give their entry the file's status and mark it
     * imported, and §S8 has an existing entry overwritten only when somebody ticks it, as the
     * matcher's own rows for such a game start unticked.
     *
     * Asked of the review rather than the lists: an entry in no list — a game taken out of every
     * list keeps its entry — is in none of them, and the lists may still be loading or have failed
     * to. The review is on screen before any row can be chosen.
     */
    const choose = (row: ImportReviewRow, game: GameDto, index: number) => {
        const tracked = review?.trackedGameIds.includes(game.id) ?? false;

        // Consumed by the render the decision's own update makes, which is the one that has moved
        // the row: `setDecisions` applies it before its first await.
        refocus.current = { rowId: row.id, index };
        setSearchingRow(null);
        setChosen(tracked
            ? `${titleAndYear(game)} chosen for “${row.title}”. It is already in your library, so it is left unticked.`
            : `${titleAndYear(game)} chosen for “${row.title}”.`);

        void setDecisions([{
            rowId: row.id,
            decision: tracked ? IMPORT_DECISION.skip : IMPORT_DECISION.import,
            gameId: game.id,
            game,
            alreadyTracked: tracked,
        }]).then(saved => {
            if (saved) return;
            // The row is back as it was, beside the error. Focus goes back to it, and the sentence
            // that said it was chosen goes, so a second try says it again rather than nothing.
            refocus.current = { rowId: row.id, index };
            setRefocusTick(tick => tick + 1);
            setChosen('');
        });
    };

    /**
     * Focus, after a choice, goes where the person would go next. The control they pressed is gone
     * by now, and left alone focus falls to the document, so the next Tab starts again from the top
     * of a page that can hold hundreds of rows. Their own row when it is still listed; under "Needs
     * you" it is not, and the next row is the one in its place, or the one before when it was the
     * last. When none is left, the line saying so.
     *
     * A row's title rather than any control in it: the next row's first control is often one of its
     * candidates, and a second press of Enter, or one held down, would choose a game for a row the
     * person has not looked at. From the title the next Tab reaches the row's controls.
     */
    useEffect(() => {
        const request = refocus.current;
        if (request === null) return;
        refocus.current = null;

        const items = Array.from(listRef.current?.children ?? []).filter(
            (item): item is HTMLElement => item instanceof HTMLElement);
        const item = items.find(element => element.dataset.rowId === String(request.rowId))
            ?? items[request.index]
            ?? items[request.index - 1];

        (item?.querySelector<HTMLElement>('[data-row-title]') ?? nothingLeftRef.current)?.focus();
    }, [visible, refocusTick]);

    const showFilter = (next: Filter) => {
        setFilter(next);
        // A row hidden by the filter takes its search with it, and should not open again by itself
        // — asking IGDB once more — when the filter brings it back.
        setSearchingRow(null);
    };

    if (signedOut) {
        return (
            <p className="text-center text-fg-muted font-medium py-24">
                Sign in to review your import.
            </p>
        );
    }

    // The import is over. Everything before this is about what *will* happen; this is what did.
    if (result) {
        return (
            <ResultPanel
                rows={result.job.importedCount ?? 0}
                games={result.games}
                unlisted={result.unlisted}
                wishlistOnly={result.wishlistOnly}
                skipped={result.skipped}
                fileName={result.job.fileName}
            />
        );
    }

    return (
        <div className="min-h-screen">
            <PageHeader
                title="Review your import"
                width="6xl"
                compact
                description={review ? `${review.job.fileName} — nothing is saved until you finish.` : 'Loading…'}
            >
                {expiresIn && (
                    <p className="text-fg-faint text-xs mt-1">
                        An import left unfinished is deleted {expiresIn}, along with the decisions
                        made on it. Saving any decision starts that over.
                    </p>
                )}
            </PageHeader>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
                {(authLoading || loading) && (
                    <p className="text-fg-muted text-sm py-16 text-center" role="status">
                        Loading your import…
                    </p>
                )}

                {!loading && error && (
                    <div className="text-center py-16" role="alert">
                        <p className="text-danger-300 font-medium mb-3">{error}</p>
                        {/* A job that is over cannot come back, and this is now how every job ends:
                            committed, cancelled, or deleted by retention. Offering the reload that
                            produced the 404 would only produce it again. */}
                        {gone ? (
                            <Link
                                to="/import"
                                className="inline-block px-4 py-2 btn-outline text-sm font-semibold"
                            >
                                Back to your imports
                            </Link>
                        ) : (
                            <button
                                type="button"
                                onClick={reload}
                                className="px-4 py-2 bg-danger-700 hover:bg-danger-600 text-fg-strong text-sm font-semibold rounded-lg"
                            >
                                Try again
                            </button>
                        )}
                    </div>
                )}

                {/* A failed decision has already been rolled back, so it is shown beside the rows
                    rather than instead of them — the review underneath it is fine. */}
                {actionError && (
                    <p className="text-sm text-danger-300 bg-danger-900/20 border border-danger-700/50 rounded-lg px-4 py-3" role="alert">
                        {actionError}
                    </p>
                )}

                {review && !loading && !error && (
                    <>
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {/* The file's rows, under no noun: what is in a file is rows, and no
                                count of games can be made of the ones nothing has matched yet. */}
                            <Tile label="In your file" value={review.summary.total} />
                            {/* Named rows only when they differ, as the result panel does, so that
                                "11" beside a file of 14 does not read as three left out. */}
                            <Tile
                                label="Games to import"
                                value={importing.games}
                                note={importing.games < importing.rows
                                    ? `from ${formatCount(importing.rows)} rows`
                                    : undefined}
                            />
                            {/* "Library", not "lists": an entry the user has in no list is one
                                of these, and the games in no list are in none of their lists. */}
                            <Tile label="Already in your library" value={trackedGames} />
                            {/* Counted off the rows rather than added up out of the summary, which
                                would count a row twice when its game is unknown *and* its shelf
                                is — and which is the same set the "Needs you" filter shows. */}
                            <Tile label="Need a decision" value={attention.length} />
                        </dl>

                        {/* Offered rather than done on arrival: it spends IGDB's budget and takes
                            real time, so it is somebody asking for it. Absent once every row has
                            been looked at, because asking again would return the same answers. */}
                        {review.summary.unlooked > 0 && (
                            <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-primary-950/40 border border-primary-800/50 rounded-lg">
                                <p className="text-sm text-fg-soft grow">
                                    {formatCount(review.summary.unlooked)}{' '}
                                    {review.summary.unlooked === 1 ? 'row of your file names' : 'rows of your file name'} a
                                    game without its id. We can look {review.summary.unlooked === 1 ? 'it' : 'them'} up
                                    by name — you still choose anything we are not sure about.
                                </p>
                                <button
                                    type="button"
                                    disabled={matching || busy}
                                    onClick={() => void match()}
                                    className="px-4 py-2 btn-primary disabled:opacity-50 text-sm"
                                >
                                    {matching
                                        ? `Searching… ${formatCount(review.summary.unlooked)} left`
                                        : 'Find these games'}
                                </button>
                            </div>
                        )}

                        {/* ADR 0045. Asked once for every game the file says was played without
                            saying how that ended. The import still guesses nothing — no list stays
                            the default — but nobody has to place hundreds of games one at a time
                            afterwards, from game pages that are the only place such a game shows. */}
                        {review.summary.playedUnresolved > 0 && (
                            <PlayedChoice
                                id={playedChoiceId}
                                count={review.summary.playedUnresolved}
                                status={playedStatus}
                                disabled={busy || saving}
                                label={label}
                                onChoose={status => void setPlayedStatus(status)}
                            />
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                            <FilterButton active={filter === 'attention'} onClick={() => showFilter('attention')}>
                                Needs you ({formatCount(attention.length)})
                            </FilterButton>
                            <FilterButton active={filter === 'importing'} onClick={() => showFilter('importing')}>
                                Importing ({formatCount(review.summary.selected)})
                            </FilterButton>
                            <FilterButton active={filter === 'all'} onClick={() => showFilter('all')}>
                                All ({formatCount(review.summary.total)})
                            </FilterButton>

                            <span className="grow" />

                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-semibold btn-outline"
                                onClick={() => bulk(rows.filter(r => r.gameId !== null), IMPORT_DECISION.import)}
                            >
                                Select every matched game
                            </button>
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-semibold btn-outline"
                                onClick={() => bulk(rows, IMPORT_DECISION.skip)}
                            >
                                Clear all
                            </button>
                        </div>

                        {visible.length === 0 && (
                            // Focusable from script only, as where a choice leaves focus once it
                            // was the last row needing one.
                            <p ref={nothingLeftRef} tabIndex={-1} className="text-fg-muted text-sm py-12 text-center rounded-lg focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus">
                                {filter === 'attention'
                                    ? 'Nothing needs a decision — every game was matched and understood.'
                                    : 'Nothing here.'}
                            </p>
                        )}

                        <p role="status" className="sr-only">{chosen}</p>

                        <ul ref={listRef} className="border-t border-line">
                            {visible.slice(0, shown).map((row, index) => (
                                <li
                                    key={row.id}
                                    data-row-id={row.id}
                                    className="flex items-start gap-3 py-4 border-b border-line"
                                >
                                    {/* Disabled while no game is matched — ticking such a row would
                                        count it in "will import" and then have the commit skip it,
                                        a promise the screen cannot keep. An ambiguous row is ticked
                                        by choosing one of its candidates below, and either kind by
                                        choosing a game its search found, which resolves and selects
                                        it in one click (§M3, §M4). */}
                                    <input
                                        type="checkbox"
                                        className="mt-1 size-4 shrink-0 disabled:opacity-40"
                                        checked={row.decision === IMPORT_DECISION.import}
                                        disabled={row.gameId === null}
                                        aria-label={`Import ${row.title}`}
                                        title={row.gameId === null
                                            ? 'We could not match this to a game, so it cannot be imported yet.'
                                            : undefined}
                                        onChange={event =>
                                            decide(row, event.target.checked ? IMPORT_DECISION.import : IMPORT_DECISION.skip)}
                                    />

                                    <GameCover url={row.game?.coverImageUrl} className="w-9 h-12" sizes="2.25rem" />

                                    <div className="min-w-0 grow">
                                        {/* Focusable from script only: where focus goes after a game
                                            is chosen here or in the row before, since it commits
                                            nothing when pressed. */}
                                        <p
                                            data-row-title
                                            tabIndex={-1}
                                            className="text-fg text-sm font-medium truncate rounded-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
                                        >
                                            {row.title}
                                            {row.releaseYear !== null && (
                                                <span className="text-fg-faint font-normal"> ({row.releaseYear})</span>
                                            )}
                                        </p>

                                        <p className="text-xs text-fg-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <span>{label(row.status)}</span>
                                            {row.score !== null && <span>· {row.score}/10</span>}
                                            {row.playthroughCount > 0 && (
                                                <span>
                                                    · {formatCountOf(row.playthroughCount, 'playthrough', 'playthroughs')}
                                                    {row.minutesPlayed !== null && ` (${Math.round(row.minutesPlayed / 60)}h)`}
                                                </span>
                                            )}
                                            {row.wishlist && <Badge>Wishlist</Badge>}
                                            {row.favourite && <Badge>Favourite</Badge>}
                                            {/* A cut note says so before the commit, since the text
                                                lost is usually a review its owner wrote (ADR 0083). */}
                                            {row.notesCut
                                                ? <Badge tone="warning">Notes cut to 2,000 characters</Badge>
                                                : row.hasNotes && <Badge>Notes</Badge>}
                                            {row.alreadyTracked && <Badge tone="warning">Already in your library</Badge>}
                                            {row.matchKind === IMPORT_MATCH.ambiguous && (
                                                <Badge tone="warning">Which one is it?</Badge>
                                            )}
                                            {row.matchKind === IMPORT_MATCH.unmatched && (
                                                <Badge tone="danger">No game matched</Badge>
                                            )}
                                        </p>

                                        {/* §M3: the alternatives, with cover and year, so the row
                                            is resolved by recognising a game rather than by reading
                                            one. Choosing also selects the row — somebody who has
                                            just said "that one" has said they want it. */}
                                        {row.candidates.length > 0 && (
                                            <div className="mt-2">
                                                <p className="text-xs text-fg-muted mb-1.5">
                                                    We found {row.candidates.length === 1 ? 'a close match' : 'more than one'}.
                                                    Which did you play?
                                                </p>
                                                <ul className="flex flex-wrap gap-2">
                                                    {row.candidates.map(candidate => (
                                                        <li key={candidate.id}>
                                                            <ImportCandidateButton
                                                                game={candidate}
                                                                onChoose={() => choose(row, candidate, index)}
                                                            />
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* §M4: a row nothing was found for, or whose candidates are
                                            all wrong, searched for from the row itself rather than by
                                            leaving the page to find an id. Not on an unlooked row,
                                            which the matcher has not been over yet and usually
                                            places on its own. */}
                                        {searchable(row) && (
                                            <ImportRowSearch
                                                title={row.title}
                                                prompt={row.candidates.length > 0 ? 'None of these?' : undefined}
                                                open={searchingRow === row.id}
                                                onOpenChange={open => setSearchingRow(open ? row.id : null)}
                                                onChoose={game => choose(row, game, index)}
                                            />
                                        )}

                                        {/* Issue 324: the same search, to change a game we found
                                            or somebody chose here — a mis-click on Resident Evil 2
                                            (2019) for the 1998 one could be unticked and not put
                                            right. It names the game the row has now, which the
                                            file's title above does not, so a wrong one can be seen
                                            before it is imported. */}
                                        {changeable(row) && (
                                            <ImportRowSearch
                                                title={row.title}
                                                prompt={row.game
                                                    ? <>Matched to <span className="text-fg-soft">{titleAndYear(row.game)}</span>.</>
                                                    : 'Not the right game?'}
                                                label="Change"
                                                name={`Change the game for ${row.title}`}
                                                open={searchingRow === row.id}
                                                onOpenChange={open => setSearchingRow(open ? row.id : null)}
                                                onChoose={game => choose(row, game, index)}
                                            />
                                        )}

                                        {/* An unrecognised shelf is asked about rather than
                                            defaulted — the rule from the spec §3.2. */}
                                        {row.statusUnrecognised && (
                                            <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                                                <span>
                                                    Your file said “{row.sourceStatus}”, which we do not know. Put it in:
                                                </span>
                                                <select
                                                    className="bg-page border border-line-strong rounded px-2 py-1 text-fg"
                                                    defaultValue=""
                                                    onChange={event => {
                                                        if (!event.target.value) return;
                                                        // Selected only once it has a game, as the
                                                        // checkbox is: a row with none would be
                                                        // listed as importing and then skipped.
                                                        void setDecisions([{
                                                            rowId: row.id,
                                                            decision: row.gameId === null
                                                                ? IMPORT_DECISION.skip
                                                                : IMPORT_DECISION.import,
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
                                className="w-full py-2 text-sm font-semibold btn-outline"
                                onClick={() => setShown(count => count + PAGE)}
                            >
                                Show more ({formatCount(visible.length - shown)} left)
                            </button>
                        )}

                        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-line">
                            {/* Held while a change is still on its way. Every change is on screen
                                before the server has it, and a commit sent past one would import
                                what the server held before it — a list chosen a moment earlier,
                                shown and then quietly not applied. */}
                            <button
                                type="button"
                                disabled={busy || saving || importing.games === 0}
                                onClick={() => void commitAndRefresh()}
                                className="px-5 py-2.5 btn-primary disabled:opacity-50 text-sm"
                            >
                                {busy
                                    ? 'Importing…'
                                    : `Import ${formatCount(importing.games)} ${importing.games === 1 ? 'game' : 'games'}`}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={async () => {
                                    if (await cancel()) await navigate('/import');
                                }}
                                className="px-4 py-2.5 text-sm font-semibold text-fg-muted hover:text-fg"
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

/**
 * A row its owner can search IGDB from: one the matcher has been over and could not place, because
 * it found nothing (`unmatched`) or would not choose (`ambiguous`). An `unlooked` row is left to
 * "Find these games", which places most of them without anybody typing, and a `matched` one has its
 * game.
 */
function searchable(row: ImportReviewRow): boolean {
    return row.matchKind === IMPORT_MATCH.unmatched || row.matchKind === IMPORT_MATCH.ambiguous;
}

/**
 * A row whose game can be changed, through the same search (issue 324): one with a game the matcher
 * found by its title, or that somebody chose here. Not one whose game the file named, which is its
 * owner's own record of what they played, and which on a Grouvee export is nearly every row — so the
 * screen most people see gains nothing it does not need.
 */
function changeable(row: ImportReviewRow): boolean {
    return row.matchKind === IMPORT_MATCH.matched && row.gameId !== null && !row.gameFromFile;
}

/**
 * The one question about the games the file says were played and not how that ended: which list
 * they all go into, if any.
 *
 * A labelled select rather than a "mark them finished" button, because Finished is the likeliest
 * answer and not the only one, and because no list has to stay reachable — it is where the group
 * starts, and changing one's mind has to be able to get back there.
 */
function PlayedChoice({ id, count, status, disabled, label, onChoose }: {
    id: string;
    count: number;
    /** A status key, null for no list, or `MIXED` when the rows disagree. */
    status: string | null;
    disabled: boolean;
    label: (status: string | null) => string;
    onChoose: (status: string | null) => void;
}) {
    const one = count === 1;

    return (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-primary-950/40 border border-primary-800/50 rounded-lg">
            <div className="grow basis-72 text-sm">
                <p className="text-fg font-medium">
                    {one
                        ? 'You played one of these games, but your file does not say whether you finished it.'
                        : `You played ${formatCount(count)} of these games, but your file does not say whether you finished them.`}
                </p>
                <p className="text-fg-muted mt-0.5">
                    {one
                        ? 'Left in no list it is still imported, score and playthroughs included, but none of your lists will show it.'
                        : 'Left in no list they are still imported, scores and playthroughs included, but none of your lists will show them.'}
                </p>
            </div>

            <div className="flex items-center gap-2 text-sm">
                <label htmlFor={id} className="text-fg-soft whitespace-nowrap">
                    {one ? 'Put it in' : 'Put them in'}
                </label>
                <select
                    id={id}
                    className="bg-page border border-line-strong rounded px-2 py-1.5 text-fg disabled:opacity-50"
                    value={status ?? ''}
                    disabled={disabled}
                    onChange={event => onChoose(event.target.value || null)}
                >
                    <option value="">No list</option>
                    {LIST_IDS.map(listId => (
                        <option key={listId} value={listId}>{label(listId)}</option>
                    ))}
                    {status === MIXED && <option value={MIXED} disabled>Some of each</option>}
                </select>
            </div>
        </div>
    );
}

/** How many games these rows name. A row with no game yet names none. */
function gamesNamed(rows: ImportReviewRow[]): number {
    return new Set(rows.flatMap(row => (row.gameId === null ? [] : [row.gameId]))).size;
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
    return (
        <div className="pt-3 border-t border-line-strong">
            <dt className="type-kicker text-fg-muted">{label}</dt>
            <dd className="mt-1.5 type-display text-3xl text-fg-strong">{formatCount(value)}</dd>
            {note && <dd className="mt-1 type-meta text-xs text-fg-muted">{note}</dd>}
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
            className={`px-3 py-1.5 text-xs font-semibold rounded-sm border transition-colors ${
                active
                    ? 'bg-primary-500 border-primary-500 text-on-primary'
                    : 'border-line-strong text-fg-strong hover:border-fg-muted'
            }`}
        >
            {children}
        </button>
    );
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warning' | 'danger' }) {
    const tones = {
        neutral: 'bg-raised/60 text-fg-soft',
        warning: 'bg-warning-900/40 text-warning-300',
        danger: 'bg-danger-900/40 text-danger-300',
    };
    return <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

/**
 * What the import did, and what it did not.
 *
 * The skipped rows are downloadable rather than only counted: §C5's promise is that nothing is
 * silently lost, and a number does not tell somebody which games to add by hand. The games in no
 * list are said out loud for the same reason — "now in your lists" was once the whole sentence, and
 * it was false of three-quarters of a real library.
 *
 * A game in no list but on the wishlist is named apart from those (issue 301). It is where its
 * owner put it — a game shelved only as wanted — and `/wishlist` shows it, so "on its own game page"
 * would send somebody looking for a problem that is not there.
 *
 * What it counts is games, because games are what is now in somebody's library. The rows they came
 * from are a different number only when two of the rows it imported named one game — as a source
 * that lists a game once per platform does — and only then does the panel speak of rows. Then it
 * has to: after a review that said it would import 14, a bare "11 games" reads as three lost.
 *
 * It takes focus to its heading as it mounts (issue 302). It replaces the review, and the Import
 * button that had focus goes with it, so focus would fall to the document and a screen reader would
 * say nothing at all. A `role="status"` region would not do instead: one that mounts with its words
 * already in it is not reliably announced.
 */
function ResultPanel({ rows, games, unlisted, wishlistOnly, skipped, fileName }: {
    /** The rows imported — the job's `importedCount`, which with the skipped ones is every row. */
    rows: number;
    /** The games those rows went into: fewer than `rows` when two of them named one game. */
    games: number;
    /** How many of those games are in no list, and not on the wishlist either. */
    unlisted: number;
    /** How many of those games are in no list but on the wishlist. */
    wishlistOnly: number;
    skipped: { title: string; sourceStatus: string | null; reason: string }[];
    fileName: string;
}) {
    const merged = games < rows;
    const from = merged ? `, from ${formatCountOf(rows, 'row', 'rows')} of your file` : '';

    // Straight after "rows of your file" a bare "them" could be the rows, and a row is in no list.
    const ofThem = merged ? 'of the games' : 'of them';

    // "It" rather than "1 of them" when there is one game, "They are all" rather than "40 of them"
    // when every game is so, and nothing when none is.
    const howMany = (count: number) =>
        games === 1
            ? 'It is'
            : count === games
                ? 'They are all'
                : `${formatCount(count)} ${ofThem} ${count === 1 ? 'is' : 'are'}`;

    const onWishlist = wishlistOnly === 0 ? '' : `${howMany(wishlistOnly)} on your wishlist.`;

    // Every one of several in no list reads better said the other way round.
    const inNoList = unlisted === 0
        ? ''
        : unlisted === games && games > 1
            ? `None ${ofThem} is in a list, so they are on their own game pages.`
            : `${howMany(unlisted)} in no list, so ${unlisted === 1 ? 'it is on its own game page' : 'they are on their own game pages'} rather than in your lists.`;

    const outcome = unlisted === 0 && wishlistOnly === 0
        ? `${formatCountOf(games, 'game is', 'games are')} now in your lists${from}.`
        : [`${formatCountOf(games, 'game was', 'games were')} imported${from}.`, onWishlist, inNoList]
            .filter(Boolean)
            .join(' ');

    // Once, as it mounts. A second run, as StrictMode makes in development, focuses it again. The
    // outcome is the heading's description, so a screen reader says what happened along with
    // "Import finished" rather than only if its user reads on.
    const heading = useRef<HTMLHeadingElement>(null);
    const outcomeId = useId();
    useEffect(() => {
        heading.current?.focus();
    }, []);

    // A skipped row is a row, and can be one whose game another row imported. Until the panel has
    // spoken of rows, the file's rows are its games and need no noun of their own.
    const passedOver = skipped.length === 0
        ? ''
        : ` ${merged ? formatCountOf(skipped.length, 'row was', 'rows were') : formatCountOf(skipped.length, 'was', 'were')} skipped.`;

    return (
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
            {/* Focusable from script only: it is where focus goes, and pressing it does nothing. */}
            <h1
                ref={heading}
                tabIndex={-1}
                aria-describedby={outcomeId}
                className="type-display text-3xl text-fg-strong mb-3 rounded-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
            >
                Import finished
            </h1>
            <p id={outcomeId} className="text-fg-muted mb-8">
                {outcome}
                {passedOver}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                    to="/lists"
                    className="px-5 py-2.5 btn-primary text-sm"
                >
                    See your lists
                </Link>

                {wishlistOnly > 0 && (
                    <Link
                        to="/wishlist"
                        className="px-4 py-2.5 text-sm font-semibold btn-outline"
                    >
                        See your wishlist
                    </Link>
                )}

                {skipped.length > 0 && (
                    <button
                        type="button"
                        onClick={() => downloadSkippedRows(skipped, `${fileName}-skipped.csv`)}
                        className="px-4 py-2.5 text-sm font-semibold btn-outline"
                    >
                        Download what was skipped
                    </button>
                )}
            </div>
        </div>
    );
}

export default ImportReviewPage;
