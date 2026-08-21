import { useCallback, useEffect, useRef, useState } from 'react';
import { GameCard } from '@/components/GameCard';
import type { GameDto, PagedGamesResponse } from '@/types/game';

const PAGE_SIZE = 20;

async function fetchGamesPage(offset: number, search: string, signal?: AbortSignal): Promise<PagedGamesResponse> {
    const params = new URLSearchParams({ offset: String(offset) });
    if (search.trim()) params.set('search', search.trim());

    const response = await fetch(`/api/games?${params}`, { signal });
    if (!response.ok) {
        throw new Error(`Failed to load games (${response.status})`);
    }
    return response.json() as Promise<PagedGamesResponse>;
}

export function meta() {
    return [
        { title: 'Browse games - MyVideoGameList' },
        { name: 'description', content: 'Search and browse games across PC, PlayStation, Xbox and Nintendo, and add them to your lists.' },
    ];
}

export function GamesPage() {
    const [games, setGames] = useState<GameDto[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const isLoadingMoreRef = useRef(false);
    const loadMoreControllerRef = useRef<AbortController | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Debounce the search input so we don't fire a request on every keystroke
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [search]);

    // Reset the results when the search term changes. Adjusting state during render is
    // React's sanctioned alternative to resetting inside an effect, which would commit a
    // throwaway render of the stale list first.
    // https://react.dev/learn/you-might-not-need-an-effect
    const [activeSearch, setActiveSearch] = useState(debouncedSearch);
    if (activeSearch !== debouncedSearch) {
        setActiveSearch(debouncedSearch);
        setGames([]);
        setOffset(0);
        setHasMore(false);
        setError(null);
        setLoading(true);
        setLoadingMore(false);
    }

    // Fetch the first page for the active search term.
    useEffect(() => {
        const controller = new AbortController();

        isLoadingMoreRef.current = false;
        loadMoreControllerRef.current?.abort();

        fetchGamesPage(0, debouncedSearch, controller.signal)
            .then(data => {
                setGames(data.items);
                setHasMore(data.hasMore);
                setOffset(PAGE_SIZE);
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [debouncedSearch]);

    const loadMore = useCallback(() => {
        if (isLoadingMoreRef.current || !hasMore) return;
        isLoadingMoreRef.current = true;
        setLoadingMore(true);

        const controller = new AbortController();
        loadMoreControllerRef.current = controller;

        fetchGamesPage(offset, debouncedSearch, controller.signal)
            .then(data => {
                if (controller.signal.aborted) return;
                setGames(prev => [...prev, ...data.items]);
                setHasMore(data.hasMore);
                setOffset(prev => prev + PAGE_SIZE);
            })
            .catch(err => {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
            })
            .finally(() => {
                isLoadingMoreRef.current = false;
                if (!controller.signal.aborted) setLoadingMore(false);
            });
    }, [offset, debouncedSearch, hasMore]);

    // Intersection observer for automatic infinite scroll
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            entries => {
                const entry = entries.find(e => e.target === sentinel);
                if (entry?.isIntersecting && hasMore && !loadingMore && !loading) {
                    loadMore();
                }
            },
            { rootMargin: '200px' }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, loading, loadMore]);

    return (
        <div className="min-h-screen">
            {/* Page header */}
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-2">Games</h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                        {loading ? 'Loading…' : `${games.length} game${games.length !== 1 ? 's' : ''} loaded${hasMore ? ' so far' : ''}`}
                    </p>

                    {/* Search */}
                    <div className="mt-5 relative max-w-sm">
                        <svg
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                        </svg>
                        <input
                            type="search"
                            placeholder="Search games…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 rounded-lg text-white light:text-slate-900 placeholder-slate-500 light:placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            aria-label="Search games"
                        />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {loading && (
                    <div className="flex items-center justify-center py-24">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-label="Loading" />
                            <p className="text-slate-400 light:text-slate-600 text-sm">Loading games…</p>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="flex items-center justify-center py-24">
                        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-8 max-w-md text-center">
                            <svg className="w-10 h-10 text-red-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 4a8 8 0 100 16 8 8 0 000-16z" />
                            </svg>
                            <p className="text-red-300 font-medium mb-1">Failed to load games</p>
                            <p className="text-red-400/70 text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {!loading && !error && games.length === 0 && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <svg className="w-14 h-14 text-slate-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <p className="text-slate-400 light:text-slate-600 font-medium">
                                {search ? 'No games match your search.' : 'No games found.'}
                            </p>
                        </div>
                    </div>
                )}

                {!loading && !error && games.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {games.map(game => (
                            <GameCard key={game.id} game={game} />
                        ))}
                    </div>
                )}

                {/* Infinite-scroll sentinel / load-more indicator */}
                <div ref={sentinelRef} className="mt-8 flex justify-center">
                    {loadingMore && (
                        <div className="flex items-center gap-3 text-slate-400 light:text-slate-600 text-sm">
                            <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-label="Loading more" />
                            Loading more games…
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


export default GamesPage;
