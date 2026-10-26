import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { GameCard } from '@/components/GameCard';
import { GameGridSkeleton } from '@/components/GameGridSkeleton';
import { ListTable } from '@/components/ListTable';
import { ListTableSkeleton } from '@/components/ListTableSkeleton';
import { ListToolbar } from '@/components/ListToolbar';
import { LoadingState } from '@/components/LoadingState';
import { ListTagFilter } from '@/components/ListTagFilter';
import { TagChips } from '@/components/TagChips';
import { useListTagFilter } from '@/hooks/useListTagFilter';
import { PageHeader } from '@/components/PageHeader';
import { ReorderAnnouncer } from '@/components/ReorderAnnouncer';
import { ReorderHandle } from '@/components/ReorderHandle';
import { Skeleton } from '@/components/Skeleton';
import { useLists } from '@/hooks/useLists';
import { useAuth } from '@/hooks/useAuth';
import { useFavourites } from '@/hooks/useFavourites';
import { useReorder } from '@/hooks/useReorder';
import { type ListEntryDto, type ListId, HAND_ORDERED_LISTS, LIST_IDS } from '@/types/list';
import type { PlatformDto } from '@/types/game';
import { GAME_GRID, GAME_GRID_FIRST_ROW } from '@/lib/gameGrid';
import { MANUAL_SORT, sortEntries } from '@/lib/listSort';
import './ListsPage.css';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';

/** A heroicon's path: a padlock, for a page that needs somebody signed in. */
const LOCK_ICON = 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z';

/** A heroicon's path: an empty clipboard, for a list with nothing on it. */
const LIST_ICON = 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2';

/** How many shapes stand in for a list whose length is not known yet: two rows of tiles at the widest. */
const SKELETON_TILES = GAME_GRID_FIRST_ROW * 2;
const SKELETON_ROWS = 8;

/**
 * `ListToolbar` before the lists arrive, in its own box: the toolbar appears above any list with games in
 * it, so leaving it out would push the list down by its height the moment it landed. A control with words
 * in it is 2.025rem tall, what its 0.8rem type, padding and border come to; the two layout buttons show an
 * icon only, so they are 1.7rem and their border. On a phone those two wrap to a line of their own, as the
 * real ones do, and that line is only as tall as they are.
 */
function ToolbarSkeleton() {
    const control = 'block h-[2.025rem] rounded-lg';
    const icon = 'block h-[calc(1.7rem+2px)] w-[calc(2.2rem+2px)] rounded-lg';
    return (
        <div className="list-toolbar skeleton-sheen">
            <div className="list-toolbar-group">
                <Skeleton className="block w-8 h-3 rounded-sm" />
                <Skeleton className={`${control} w-32`} />
                <Skeleton className={`${control} w-9`} />
            </div>
            <div className="list-toolbar-group">
                <Skeleton className={`${control} w-28`} />
            </div>
            <div className="list-toolbar-group list-toolbar-views">
                <Skeleton className={icon} />
                <Skeleton className={icon} />
            </div>
        </div>
    );
}

/**
 * This route's whole content is the signed-in user's lists. Stated explicitly rather than left to inherit the root default, so that changing the
 * root's policy later cannot silently make this page shared.
 */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'My lists - MyVideoGameList' },
        {
            name: 'description',
            content: 'Your games across Backlog, Playing, On Hold, Finished and Dropped.',
        },
        // What a crawler is served here is the signed-out shell, which is a page about nothing.
        NOINDEX,
    ];
}

export function ListsPage() {
    const { user, loading: authLoading } = useAuth();
    const {
        lists, loading, error, mutationError, isPending, reload,
        view, setView, sortFor, setSort, setScore, removeFromList, moveInOrder, nameFor,
    } = useLists();
    const { isFavourite } = useFavourites();

    // Nobody is signed in or out until auth has answered: the server render never knows, and the
    // first client render has to match it. Checking `user` alone told every signed-in visitor to
    // sign in before showing them their lists.
    const signedIn = !authLoading && user !== null;
    const signedOut = !authLoading && user === null;

    const [activeTab, setActiveTab] = useState<ListId>('playing');

    // Transient and deliberately not persisted, unlike the sort and the layout. An empty
    // selection means "everything", so the filter starts inert.
    const [platformIds, setPlatformIds] = useState<number[]>([]);

    // By tag as well, ticks and all in a hook of its own (ADR 0065).
    const tagFilter = useListTagFilter(lists, user?.id ?? null);

    const entries = lists[activeTab];
    const sort = sortFor(activeTab);

    // Nothing tracked anywhere, which is not the same as nothing on this tab: an account with four
    // hundred games and an empty On Hold shelf has an empty `entries` every time it opens that tab.
    const libraryEmpty = LIST_IDS.every(id => lists[id].length === 0);

    // Options come from the platforms actually present across the user's lists, so the filter
    // never offers a choice that would match nothing.
    const platforms = useMemo<PlatformDto[]>(() => {
        const seen = new Map<number, PlatformDto>();
        for (const id of LIST_IDS) {
            for (const entry of lists[id]) {
                for (const platform of entry.game.platforms) {
                    if (!seen.has(platform.id)) seen.set(platform.id, platform);
                }
            }
        }
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [lists]);

    const { matches: matchesTags } = tagFilter;
    const visible = useMemo(() => {
        const filtered = platformIds.length === 0
            ? entries
            : entries.filter(entry => entry.game.platforms.some(p => platformIds.includes(p.id)));
        return sortEntries(filtered.filter(matchesTags), sort);
    }, [entries, platformIds, sort, matchesTags]);

    const clearFilters = () => {
        setPlatformIds([]);
        tagFilter.setSelected([]);
    };

    // The hand order, where this list offers one. It can be rearranged only when every game in it is
    // on screen: a game dropped between two that a filter has left showing would land among games
    // the user cannot see, in an order they never chose.
    const offerManual = HAND_ORDERED_LISTS.includes(activeTab);
    const manual = sort.key === MANUAL_SORT.key;
    const arranging = manual && platformIds.length === 0 && !tagFilter.active;

    const byId = useMemo(() => new Map(visible.map(entry => [entry.game.id, entry])), [visible]);
    const reorder = useReorder({
        ids: visible.map(entry => entry.game.id),
        nameOf: id => byId.get(id)?.game.title ?? 'This game',
        onMove: (id, afterId) => moveInOrder(activeTab, id, afterId),
        canMove: id => !isPending(id),
        disabled: !arranging,
    });

    // While a game is being moved it is drawn where it would land; the rest of the time this is the
    // sorted list as it stands.
    const shown: ListEntryDto[] = arranging
        ? reorder.order.flatMap(id => byId.get(id) ?? [])
        : visible;

    return (
        <div className="min-h-screen">
            <PageHeader title="My Lists" description="Track your games across different stages.">
                <div className="lists-tabs" role="tablist" aria-label="Game lists">
                    {LIST_IDS.map(id => (
                        <button
                            key={id}
                            id={`lists-tab-${id}`}
                            role="tab"
                            aria-selected={activeTab === id}
                            aria-controls="lists-tabpanel"
                            className={`lists-tab-btn${activeTab === id ? ' active' : ''}`}
                            onClick={() => setActiveTab(id)}
                        >
                            {nameFor(id)}
                            <span className="lists-tab-count">{lists[id].length}</span>
                        </button>
                    ))}
                </div>
            </PageHeader>

            {/* Mutation error banner — shown when a card-level add/remove fails */}
            {mutationError && (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4" role="alert">
                    <div className="flex items-center gap-3 bg-danger-900/20 border border-danger-700/50 rounded-lg px-4 py-3 text-sm text-danger-300">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 4a8 8 0 100 16 8 8 0 000-16z" />
                        </svg>
                        {mutationError}
                    </div>
                </div>
            )}

            {/* Content */}
            <div
                id="lists-tabpanel"
                className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
                role="tabpanel"
                aria-labelledby={`lists-tab-${activeTab}`}
            >
                {signedOut && <EmptyState icon={LOCK_ICON} message="Sign in to manage your game lists." />}

                {/* Auth's wait as well as the fetch's. The lists are asked for the moment auth
                    answers, so the two read as one loading state rather than two in a row. Drawn as
                    the layout the reader keeps their lists in, which the preferences may already have
                    said; until they do, it is the default, tiles, as the page itself would be. */}
                {(authLoading || (signedIn && loading)) && (
                    <LoadingState label="Loading your lists…">
                        <ToolbarSkeleton />
                        {view === 'table'
                            ? <ListTableSkeleton rows={SKELETON_ROWS} />
                            : <GameGridSkeleton count={SKELETON_TILES} />}
                    </LoadingState>
                )}

                {/* The way out of a failed load without reloading the page. The skeleton takes the
                    error's place, button and all, so focus goes to the tab whose list is loading
                    rather than falling to the page's body. */}
                {signedIn && !loading && error && (
                    <ErrorState
                        title="Failed to load lists"
                        onRetry={() => {
                            document.getElementById(`lists-tab-${activeTab}`)?.focus();
                            reload();
                        }}
                    >
                        {error}
                    </ErrorState>
                )}

                {signedIn && !loading && !error && entries.length > 0 && (
                    <ListToolbar
                        view={view}
                        onViewChange={setView}
                        sort={sort}
                        onSortChange={next => setSort(activeTab, next)}
                        offerManual={offerManual}
                        platforms={platforms}
                        selectedPlatformIds={platformIds}
                        onPlatformsChange={setPlatformIds}
                    >
                        <ListTagFilter
                            tags={tagFilter.offered}
                            selected={tagFilter.selected}
                            onChange={tagFilter.setSelected}
                            countFor={tagId => tagFilter.countIn(entries, tagId)}
                            shown={visible.length}
                            total={entries.length}
                        />
                    </ListToolbar>
                )}

                {signedIn && !loading && !error && entries.length > 0 && manual && (
                    <p className="lists-order-hint">
                        {arranging
                            ? 'Drag a game by its handle to where you mean to play it — or press a handle and then the handle of the game whose place it should take, or pick one up with Space and move it with the arrow keys. Games you have not placed follow, in the order they joined your backlog.'
                            : tagFilter.active
                                ? 'Clear the filters to rearrange your order.'
                                : 'Clear the platform filter to rearrange your order.'}
                    </p>
                )}

                {signedIn && !loading && !error && arranging && visible.length > 0 && (
                    <ReorderAnnouncer reorder={reorder} />
                )}

                {signedIn && !loading && !error && entries.length > 0 && visible.length === 0 && (
                    <div className="text-center py-16">
                        <p className="text-fg-muted text-sm mb-3">
                            {tagFilter.active
                                ? `No games in ${nameFor(activeTab)} match the filters.`
                                : `No games in ${nameFor(activeTab)} match the platform filter.`}
                        </p>
                        <button
                            type="button"
                            className="text-primary-400 text-sm font-semibold hover:underline"
                            onClick={clearFilters}
                        >
                            {tagFilter.active ? 'Clear the filters' : 'Clear the filter'}
                        </button>
                    </div>
                )}

                {signedIn && !loading && !error && entries.length === 0 && (
                    <EmptyState icon={LIST_ICON} message={`No games in ${nameFor(activeTab)} yet.`}>
                        <Link
                            to="/games"
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-on-primary text-sm font-bold rounded-sm transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Browse games
                        </Link>

                        {/* Retyping a few hundred games is the single biggest reason people
                            abandon a new tracker — the premise the whole importer rests on
                            (`specs/csv-list-import.md` §1) — and an empty library is the only
                            moment that person is still here to be told there is a way out of
                            it. The importer's one other link is a card on the account page,
                            which is where somebody goes to run it a second time rather than
                            where a new account looks. Quiet, and second, because browsing is
                            still the right first move for somebody who tracked nothing
                            anywhere. */}
                        {libraryEmpty && (
                            <Link
                                to="/import"
                                className="block mt-4 text-primary-400 text-sm font-semibold hover:underline"
                            >
                                Bring your games across from another tracker
                            </Link>
                        )}
                    </EmptyState>
                )}

                {/* The first row loads with the page: it is what the reader is looking at. */}
                {signedIn && !loading && !error && visible.length > 0 && view === 'tiles' && (
                    <div
                        className={GAME_GRID}
                        // A list while it is an order, so assistive technology hears each game's place.
                        {...(arranging ? { ...reorder.listProps(), role: 'list' } : {})}
                    >
                        {shown.map((entry, index) => arranging ? (
                            <div
                                key={entry.game.id}
                                className="reorder-tile"
                                role="listitem"
                                {...reorder.itemProps(entry.game.id)}
                            >
                                <ReorderHandle
                                    handle={reorder.handleProps(entry.game.id)}
                                    rank={index + 1}
                                    variant="overlay"
                                />
                                <GameCard game={entry.game} eager={index < GAME_GRID_FIRST_ROW}>
                                    <TagChips tags={tagFilter.tagsOf(entry)} max={3} />
                                </GameCard>
                            </div>
                        ) : (
                            <GameCard key={entry.game.id} game={entry.game} eager={index < GAME_GRID_FIRST_ROW}>
                                <TagChips tags={tagFilter.tagsOf(entry)} max={3} />
                            </GameCard>
                        ))}
                    </div>
                )}

                {signedIn && !loading && !error && visible.length > 0 && view === 'table' && (
                    <ListTable
                        entries={shown}
                        sort={sort}
                        listName={nameFor(activeTab)}
                        isPending={isPending}
                        isFavourite={isFavourite}
                        onSortChange={next => setSort(activeTab, next)}
                        onScoreChange={(gameId, score) => void setScore(gameId, score)}
                        onRemove={gameId => void removeFromList(activeTab, gameId)}
                        reorder={arranging ? reorder : undefined}
                        tagsFor={tagFilter.tagsOf}
                    />
                )}
            </div>
        </div>
    );
}

export default ListsPage;
