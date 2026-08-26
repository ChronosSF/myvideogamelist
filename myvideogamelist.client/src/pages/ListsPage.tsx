import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { GameCard } from '@/components/GameCard';
import { ListTable } from '@/components/ListTable';
import { ListToolbar } from '@/components/ListToolbar';
import { useLists } from '@/hooks/useLists';
import { useAuth } from '@/hooks/useAuth';
import { type ListId, LIST_IDS, LIST_NAMES } from '@/types/list';
import type { PlatformDto } from '@/types/game';
import { sortEntries } from '@/lib/listSort';
import './ListsPage.css';
import { PRIVATE_NO_STORE } from '@/lib/cache';

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
    ];
}

export function ListsPage() {
    const { user } = useAuth();
    const {
        lists, loading, error, mutationError, isPending,
        view, setView, sortFor, setSort, setScore, removeFromList,
    } = useLists();
    const [activeTab, setActiveTab] = useState<ListId>('playing');

    // Transient and deliberately not persisted, unlike the sort and the layout. An empty
    // selection means "everything", so the filter starts inert.
    const [platformIds, setPlatformIds] = useState<number[]>([]);

    const entries = lists[activeTab];
    const sort = sortFor(activeTab);

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

    const visible = useMemo(() => {
        const filtered = platformIds.length === 0
            ? entries
            : entries.filter(entry => entry.game.platforms.some(p => platformIds.includes(p.id)));
        return sortEntries(filtered, sort);
    }, [entries, platformIds, sort]);

    return (
        <div className="min-h-screen">
            {/* Page header */}
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">My Lists</h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                        Track your games across different stages.
                    </p>

                    {/* Tabs */}
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
                                {LIST_NAMES[id]}
                                <span className="lists-tab-count">{lists[id].length}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Mutation error banner — shown when a card-level add/remove fails */}
            {mutationError && (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4" role="alert">
                    <div className="flex items-center gap-3 bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
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
                {!user && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <svg className="w-14 h-14 text-slate-700 light:text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            <p className="text-slate-400 light:text-slate-600 font-medium mb-3">
                                Sign in to manage your game lists.
                            </p>
                        </div>
                    </div>
                )}

                {user && loading && (
                    <div className="flex items-center justify-center py-24">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-label="Loading" />
                            <p className="text-slate-400 light:text-slate-600 text-sm">Loading your lists…</p>
                        </div>
                    </div>
                )}

                {user && !loading && error && (
                    <div className="flex items-center justify-center py-24">
                        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-8 max-w-md text-center">
                            <svg className="w-10 h-10 text-red-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 4a8 8 0 100 16 8 8 0 000-16z" />
                            </svg>
                            <p className="text-red-300 font-medium mb-1">Failed to load lists</p>
                            <p className="text-red-400/70 text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {user && !loading && !error && entries.length > 0 && (
                    <ListToolbar
                        view={view}
                        onViewChange={setView}
                        sort={sort}
                        onSortChange={next => setSort(activeTab, next)}
                        platforms={platforms}
                        selectedPlatformIds={platformIds}
                        onPlatformsChange={setPlatformIds}
                    />
                )}

                {user && !loading && !error && entries.length > 0 && visible.length === 0 && (
                    <div className="text-center py-16">
                        <p className="text-slate-400 light:text-slate-600 text-sm mb-3">
                            No games in {LIST_NAMES[activeTab]} match the platform filter.
                        </p>
                        <button
                            type="button"
                            className="text-blue-400 light:text-blue-700 text-sm font-semibold hover:underline"
                            onClick={() => setPlatformIds([])}
                        >
                            Clear the filter
                        </button>
                    </div>
                )}

                {user && !loading && !error && entries.length === 0 && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <svg
                                className="w-14 h-14 text-slate-700 light:text-slate-300 mx-auto mb-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <p className="text-slate-400 light:text-slate-600 font-medium mb-3">
                                No games in {LIST_NAMES[activeTab]} yet.
                            </p>
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Browse Games
                            </Link>
                        </div>
                    </div>
                )}

                {user && !loading && !error && visible.length > 0 && view === 'tiles' && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {visible.map(entry => (
                            <GameCard key={entry.game.id} game={entry.game} />
                        ))}
                    </div>
                )}

                {user && !loading && !error && visible.length > 0 && view === 'table' && (
                    <ListTable
                        entries={visible}
                        sort={sort}
                        listName={LIST_NAMES[activeTab]}
                        isPending={isPending}
                        onSortChange={next => setSort(activeTab, next)}
                        onScoreChange={(gameId, score) => void setScore(gameId, score)}
                        onRemove={gameId => void removeFromList(activeTab, gameId)}
                    />
                )}
            </div>
        </div>
    );
}

export default ListsPage;
