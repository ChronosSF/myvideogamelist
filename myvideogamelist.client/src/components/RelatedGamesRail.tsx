import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { RelatedGameDto, RelatedGamesDto } from '@/types/game';
import { useAuth } from '@/hooks/useAuth';
import { useLists } from '@/hooks/useLists';
import { releaseAsGame } from '@/hooks/useReleaseGame';
import { formatCountOf } from '@/lib/format';
import { theSeries } from '@/lib/releaseReason';
import { RelatedGameCard } from '@/components/RelatedGameCard';

/**
 * A series opens partway only once this one would be past the first screen of a desktop, seven covers
 * wide; it then opens a few games before it.
 */
const OPENS_PARTWAY_PAST = 6;
const BEFORE_ANCHOR = 3;

/** More than this many games to add at once is asked about first: a press should not fill a Backlog by surprise. */
const ASK_OVER = 5;

/** The first covers are in the first screen on a desktop, so they load with the page. */
const EAGER_COVERS = 7;

interface RelatedGamesRailProps {
    related: RelatedGamesDto;
    /** The game the page is about, which may be an edition of the rail's anchor. */
    gameId: number;
    /** The names of the game's series, which name the rail. */
    seriesNames: string[];
}

type BulkAdd =
    | { phase: 'asking'; account: string }
    | { phase: 'adding'; account: string; done: number; total: number }
    | { phase: 'done'; account: string; added: number; failed: number };

/**
 * The game's related games (issue 450, ADR 0084): the rest of its series and its own remakes, remasters and
 * ports, in release order, with this game marked where it falls, and its editions as a line of links
 * under them. The first thing under the game page's tabs, so that it is in view before any scrolling.
 *
 * A long series opens a few games before this one, with the earlier ones a press away, rather than
 * scrolling itself there: a rail that scrolls itself as the page loads ends the page's largest-paint
 * measurement (issue 315). Super Mario held 123 games on 2026-11-04.
 */
export function RelatedGamesRail({ related, gameId, seriesNames }: RelatedGamesRailProps) {
    const { user } = useAuth();
    const lists = useLists();
    const [showEarlier, setShowEarlier] = useState(false);
    const [bulk, setBulk] = useState<BulkAdd | null>(null);

    // The newest lists and account, for the bulk add's later steps: the provider's functions close over
    // the render they came from, and a step taken after the reader signed out, or in as somebody else,
    // must not happen at all. Written after each commit. Whether a step's add held is what the add itself
    // answers, never this: the commit of a rollback can land after the step reads it.
    const latest = useRef({ lists, account: user?.id ?? null });
    useEffect(() => {
        latest.current = { lists, account: user?.id ?? null };
    });

    // The anchor is never in the bulk add, though on an edition's page its card offers it: it is the game this
    // page is about, the edition being that game (F3), so a reader who tracks the edition tracks it already.
    const others = related.games.filter(game => game.id !== related.anchorId);
    // Nothing to show but the page's own game. An edition's page shows its original, even alone.
    if (related.editions.length === 0 && related.games.every(game => game.id === gameId)) return null;

    const account = user?.id ?? null;
    const listsKnown = account !== null && !lists.loading && lists.error === null;
    const untracked = listsKnown ? others.filter(game => lists.getListFor(game.id) === null) : [];
    const bulkNow = bulk !== null && bulk.account === account ? bulk : null;

    const anchorIndex = related.games.findIndex(game => game.id === related.anchorId);
    const firstShown = showEarlier || anchorIndex <= OPENS_PARTWAY_PAST ? 0 : anchorIndex - BEFORE_ANCHOR;
    const shown = related.games.slice(firstShown);

    const addAll = async (games: RelatedGameDto[]) => {
        if (account === null) return;
        setBulk({ phase: 'adding', account, done: 0, total: games.length });

        let added = 0;
        for (const [index, game] of games.entries()) {
            if (latest.current.account !== account) return;
            const current = latest.current.lists;
            // Added elsewhere meanwhile: adding it again would move it.
            const held = current.getListFor(game.id) !== null
                || await current.addToList('backlog', releaseAsGame({ gameId: game.id, title: game.name, coverImageUrl: game.coverImageUrl, platforms: [] }));
            if (held) added++;
            setBulk({ phase: 'adding', account, done: index + 1, total: games.length });
        }

        setBulk({ phase: 'done', account, added, failed: games.length - added });
    };

    const backlog = lists.nameFor('backlog');
    const anchorName = related.games[anchorIndex]?.name ?? null;
    const series = seriesNames.length === 1 ? theSeries(seriesNames[0]) : null;
    const title = series === null ? 'Related games' : series.charAt(0).toUpperCase() + series.slice(1);

    return (
        <section aria-labelledby="related-games" className="rule-heavy pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 mb-5">
                <h2 id="related-games" className="type-display text-3xl text-fg-strong">{title}</h2>
                <div className="flex flex-wrap items-center gap-4">
                    <span className="type-meta text-fg-faint">
                        {formatCountOf(related.games.length, 'game', 'games')}, in release order
                    </span>
                    {bulkNow?.phase === 'adding' ? (
                        <span className="type-meta text-fg-soft" role="status">
                            Adding {bulkNow.done} of {bulkNow.total} to {backlog}…
                        </span>
                    ) : bulkNow?.phase === 'asking' ? (
                        <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={`Add ${untracked.length} games to ${backlog}?`}>
                            <span className="text-sm text-fg-soft">Add {untracked.length} games to {backlog}?</span>
                            <button type="button" onClick={() => void addAll(untracked)} className="h-8 px-3 btn-primary text-sm">
                                Add {untracked.length}
                            </button>
                            <button type="button" onClick={() => setBulk(null)} className="h-8 px-3 btn-outline text-sm font-semibold">
                                Cancel
                            </button>
                        </span>
                    ) : untracked.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                if (account === null) return;
                                if (untracked.length > ASK_OVER) setBulk({ phase: 'asking', account });
                                else void addAll(untracked);
                            }}
                            className="inline-flex items-center gap-1.5 h-8 px-3 btn-outline text-sm font-semibold"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h13M4 11h13M4 16h7M17 14v7M13.5 17.5h7" />
                            </svg>
                            {untracked.length === 1
                                ? `Add the one you don't track to ${backlog}`
                                : `Add the ${untracked.length} you don't track to ${backlog}`}
                        </button>
                    )}
                </div>
            </div>

            {bulkNow?.phase === 'done' && (
                <p className={`mb-4 text-sm ${bulkNow.failed > 0 ? 'text-danger-300' : 'text-fg-soft'}`} role="status">
                    {bulkNow.failed > 0
                        ? `Added ${bulkNow.added} to ${backlog}; ${bulkNow.failed} could not be added. Please try again.`
                        : `Added ${bulkNow.added} to ${backlog}.`}
                </p>
            )}

            <ol
                className="relative flex gap-5 overflow-x-auto -mt-1 pt-1 pb-4 -mx-4 px-4 sm:-mx-1 sm:px-1 scroll-px-4 sm:scroll-px-1 snap-x"
                // A region of its own that scrolls apart from the page, so named and reachable by keyboard,
                // as the other rails are (GameRefRail). It reaches a ring's width past the column on every
                // side, and pads it back, because it clips what it holds: the ring round this game's cover
                // and a focused cover's are drawn outside the cover.
                tabIndex={0}
                aria-label={title}
            >
                {firstShown > 0 && (
                    <li className="shrink-0 snap-start w-32 sm:w-36">
                        <button
                            type="button"
                            onClick={() => setShowEarlier(true)}
                            aria-label={formatCountOf(firstShown, 'earlier game', 'earlier games')}
                            className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-sm btn-outline text-sm font-semibold"
                        >
                            <span className="type-display text-2xl">{firstShown}</span>
                            {firstShown === 1 ? 'earlier game' : 'earlier games'}
                        </button>
                    </li>
                )}
                {shown.map((game, index) => (
                    <li key={game.id} className="shrink-0 snap-start w-32 sm:w-36">
                        <RelatedGameCard
                            game={game}
                            anchor={game.id === related.anchorId}
                            self={game.id === gameId}
                            eager={index < EAGER_COVERS}
                        />
                    </li>
                ))}
            </ol>

            {related.editions.length > 0 && (
                <p className="mt-2 pt-3 border-t border-line type-meta text-fg-faint leading-relaxed">
                    Other releases of this game:{' '}
                    {related.editions.map((edition, index) => (
                        <span key={edition.id}>
                            {index > 0 && ' · '}
                            <Link to={`/games/${edition.id}`} className="text-link">{editionName(edition.name, anchorName)}</Link>
                            {edition.releaseYear !== null && <> {edition.releaseYear}</>}
                        </span>
                    ))}
                </p>
            )}
        </section>
    );
}

/**
 * An edition's name without its game's in front, which the line already says: IGDB calls the Witcher 3's
 * "The Witcher 3: Wild Hunt - Game of the Year Edition". Whole where it is not so prefixed.
 */
function editionName(name: string, anchorName: string | null): string {
    if (anchorName === null) return name;
    for (const separator of [' - ', ': ']) {
        const prefix = `${anchorName}${separator}`;
        if (name.startsWith(prefix) && name.length > prefix.length) return name.slice(prefix.length);
    }
    return name;
}
