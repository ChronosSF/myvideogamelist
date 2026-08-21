import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation, useSearchParams } from 'react-router';
import { GameCard } from '@/components/GameCard';
import type { GameDto, PagedGamesResponse } from '@/types/game';
import { apiUrl } from '@/lib/api';
import { CACHE_GAMES_LIST, PRIVATE_NO_STORE } from '@/lib/cache';
import type { Route } from './+types/GamesPage';

const PAGE_SIZE = 20;

/** Debounce before a keystroke becomes a URL change, and therefore a loader run. */
const SEARCH_DEBOUNCE_MS = 400;

function gamesPagePath(offset: number, search: string): string {
    const params = new URLSearchParams({ offset: String(offset) });
    if (search.trim()) params.set('search', search.trim());

    return `/api/games?${params}`;
}

async function fetchGamesPage(offset: number, search: string, signal?: AbortSignal): Promise<PagedGamesResponse> {
    const response = await fetch(gamesPagePath(offset, search), { signal });
    if (!response.ok) {
        throw new Error(`Failed to load games (${response.status})`);
    }
    return response.json() as Promise<PagedGamesResponse>;
}

/**
 * Server-renders the first page of results.
 *
 * The search term is read from the query string rather than component state, which is what
 * makes this route server-renderable at all: a result set has to be addressable by URL before
 * it can be rendered without a browser, shared, or indexed.
 *
 * Only the first page is loaded here. Infinite scroll continues on the client, because pages
 * two onward exist only for someone who is already scrolling — a crawler never asks for them.
 */
export async function loader({ request }: Route.LoaderArgs) {
    const search = new URL(request.url).searchParams.get('search')?.trim() ?? '';

    // Unlike the home page, there is nothing left to show if this fails — the list *is* the
    // page. A real 502 tells a crawler to come back rather than indexing an empty result set.
    const badGateway = () => new Response('Failed to load games.', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Cache-Control': PRIVATE_NO_STORE },
    });

    let response: Response;
    try {
        response = await fetch(apiUrl(gamesPagePath(0, search)));
    } catch {
        // fetch rejects rather than returning !ok when the API is unreachable. Letting that
        // propagate would surface as an unhandled 500, which misreports whose fault it is.
        throw badGateway();
    }

    if (!response.ok) throw badGateway();

    return { page: await response.json() as PagedGamesResponse, search };
}

export function headers() {
    return { 'Cache-Control': CACHE_GAMES_LIST };
}

export function meta({ loaderData }: Route.MetaArgs) {
    const search = loaderData?.search;

    // A searched listing gets its own title, and is kept out of the index: these pages are
    // near-infinite in number and thin in content, which is what search engines call
    // "low-value add" and penalise. The unfiltered browse page stays indexable.
    if (search) {
        return [
            { title: `${search} - Browse games - MyVideoGameList` },
            { name: 'robots', content: 'noindex, follow' },
        ];
    }

    return [
        { title: 'Browse games - MyVideoGameList' },
        { name: 'description', content: 'Search and browse games across PC, PlayStation, Xbox and Nintendo, and add them to your lists.' },
    ];
}

export function GamesPage({ loaderData }: Route.ComponentProps) {
    const { page, search: activeSearch } = loaderData;

    const [searchParams, setSearchParams] = useSearchParams();
    const navigation = useNavigation();

    // The first page comes from the loader and is already in the HTML. Only pages beyond it are
    // client state, so the server-rendered results are never re-fetched just to be re-displayed.
    const [extraGames, setExtraGames] = useState<GameDto[]>([]);
    const [hasMore, setHasMore] = useState(page.hasMore);
    const [offset, setOffset] = useState(PAGE_SIZE);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isLoadingMoreRef = useRef(false);
    const loadMoreControllerRef = useRef<AbortController | null>(null);

    const [search, setSearch] = useState(activeSearch);

    // Which term this component last pushed into the URL. Used to tell our own navigation apart
    // from an external one (back button, a shared link), so a slow loader response for "zel"
    // cannot overwrite an input the user has already extended to "zelda".
    //
    // State rather than a ref because it is read during render, and a ref read during render is
    // not guaranteed to hold the value that render should see.
    const [pushedSearch, setPushedSearch] = useState(activeSearch);

    // Reset pagination when the loader returns a different result set. Adjusting state during
    // render rather than in an effect, which would commit a throwaway render of the previous
    // search's results first.
    const [lastSearch, setLastSearch] = useState(activeSearch);
    if (lastSearch !== activeSearch) {
        setLastSearch(activeSearch);
        setExtraGames([]);
        setHasMore(page.hasMore);
        setOffset(PAGE_SIZE);
        setError(null);
        setLoadingMore(false);

        if (pushedSearch !== activeSearch) setSearch(activeSearch);
    }

    // Push the debounced term into the URL. The loader re-runs on the resulting navigation, so
    // the URL — not this component — owns which results are displayed.
    useEffect(() => {
        const trimmed = search.trim();
        if (trimmed === activeSearch) return;

        const timer = setTimeout(() => {
            setPushedSearch(trimmed);

            const next = new URLSearchParams(searchParams);
            if (trimmed) next.set('search', trimmed);
            else next.delete('search');

            // replace, so typing does not add one history entry per debounce interval.
            setSearchParams(next, { replace: true, preventScrollReset: true });
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [search, activeSearch, searchParams, setSearchParams]);

    // Abandon an in-flight "load more" when the result set changes underneath it, so a late
    // page of the previous search cannot append itself to the new one.
    useEffect(() => () => {
        isLoadingMoreRef.current = false;
        loadMoreControllerRef.current?.abort();
    }, [activeSearch]);

    const games = extraGames.length > 0 ? [...page.items, ...extraGames] : page.items;

    // Only while the loader is fetching a *different* search. Without the comparison the list
    // would blank out during any navigation, including leaving for a game page.
    const pendingSearch = navigation.location
        ? new URLSearchParams(navigation.location.search).get('search')?.trim() ?? ''
        : null;
    const loading = navigation.state === 'loading' && pendingSearch !== null && pendingSearch !== activeSearch;

    const loadMore = useCallback(() => {
        if (isLoadingMoreRef.current || !hasMore) return;
        isLoadingMoreRef.current = true;
        setLoadingMore(true);

        const controller = new AbortController();
        loadMoreControllerRef.current = controller;

        fetchGamesPage(offset, activeSearch, controller.signal)
            .then(data => {
                if (controller.signal.aborted) return;
                setExtraGames(prev => [...prev, ...data.items]);
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
    }, [offset, activeSearch, hasMore]);

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
