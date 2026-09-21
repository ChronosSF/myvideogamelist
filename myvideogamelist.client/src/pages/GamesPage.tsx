import { useCallback, useEffect, useRef, useState } from 'react';
import { data, useNavigation, useSearchParams } from 'react-router';
import { GameCard } from '@/components/GameCard';
import { GameBrowseFilters } from '@/components/GameBrowseFilters';
import type { GameDto, GenreDto, PagedGamesResponse, PlatformDto } from '@/types/game';
import { apiUrl } from '@/lib/api';
import { CACHE_GAMES_LIST, PRIVATE_NO_STORE } from '@/lib/cache';
import { pageMeta, siteConfig } from '@/lib/seo';
import {
    type GameBrowse,
    browseFrom,
    browseParams,
    gamesApiPath,
    isFiltered,
    yearsFrom,
} from '@/lib/gameBrowse';
import type { Route } from './+types/GamesPage';

const PAGE_SIZE = 20;

/** Debounce before a keystroke becomes a URL change, and therefore a loader run. */
const SEARCH_DEBOUNCE_MS = 400;

async function fetchGamesPage(offset: number, browse: GameBrowse, signal?: AbortSignal): Promise<PagedGamesResponse> {
    const response = await fetch(gamesApiPath(offset, browse), { signal });
    if (!response.ok) {
        throw new Error(`Failed to load games (${response.status})`);
    }
    return response.json() as Promise<PagedGamesResponse>;
}

/** A list the filters offer, or null when it could not be fetched — that filter is then left out. */
async function optionsFrom<T>(result: PromiseSettledResult<Response>): Promise<T[] | null> {
    if (result.status !== 'fulfilled' || !result.value.ok) return null;
    try {
        return await result.value.json() as T[];
    } catch {
        return null;
    }
}

/**
 * Server-renders the first page of results, for whatever the URL asks for.
 *
 * The search term, the order and the filters are all read from the query string rather than from
 * component state, which is what makes this route server-renderable at all: a result set has to be
 * addressable by URL before it can be rendered without a browser, shared, or indexed.
 *
 * Only the first page is loaded here. Infinite scroll continues on the client, because pages
 * two onward exist only for someone who is already scrolling — a crawler never asks for them.
 *
 * The genres and platforms the filters offer come alongside. Either can fail without taking the
 * games with it; the page then renders without that one filter, and uncached, so the gap is not
 * pinned at the edge.
 */
export async function loader({ request }: Route.LoaderArgs) {
    const browse = browseFrom(new URL(request.url).searchParams);

    // Unlike the home page, there is nothing left to show if this fails — the list *is* the
    // page. A real 502 tells a crawler to come back rather than indexing an empty result set.
    const badGateway = () => new Response('Failed to load games.', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Cache-Control': PRIVATE_NO_STORE },
    });

    // `allSettled`, so the options can fail on their own. fetch rejects rather than returning !ok
    // when the API is unreachable, and a rejection here must not surface as an unhandled 500.
    const [gamesResult, genresResult, platformsResult] = await Promise.allSettled([
        fetch(apiUrl(gamesApiPath(0, browse))),
        fetch(apiUrl('/api/genres')),
        fetch(apiUrl('/api/platforms/active')),
    ]);

    if (gamesResult.status === 'rejected' || !gamesResult.value.ok) throw badGateway();

    const page = await gamesResult.value.json() as PagedGamesResponse;
    const genres = await optionsFrom<GenreDto>(genresResult);
    const platforms = await optionsFrom<PlatformDto>(platformsResult);

    return data(
        {
            page,
            browse,
            genres,
            platforms,
            // The server's year, so the year select renders the same options on both sides of
            // hydration even across midnight on New Year's Eve.
            currentYear: new Date().getUTCFullYear(),
            // For `meta`, which also runs in the browser and cannot read the environment there.
            site: siteConfig(),
        },
        {
            headers: {
                'Cache-Control': genres === null || platforms === null ? PRIVATE_NO_STORE : CACHE_GAMES_LIST,
            },
        },
    );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return { 'Cache-Control': loaderHeaders.get('Cache-Control') ?? CACHE_GAMES_LIST };
}

export function meta({ loaderData, location }: Route.MetaArgs) {
    const search = loaderData?.browse.search ?? '';

    // A searched, sorted or filtered listing is kept out of the index: these pages are near-infinite
    // in number and thin in content, which is what search engines call "low-value add" and
    // penalise. The unfiltered browse page stays indexable, and is the one URL without a query.
    //
    // Decided on the query string itself, not on the browse parsed from it. The parse drops whatever
    // it cannot use, so `?sort=bogus`, `?platform=0` and a spelled-out `?sort=rating` all read as the
    // plain catalogue — and each would be indexed as one more copy of it.
    //
    // No canonical URL beside it. Pointing a `noindex` page at the catalogue would say both "this is
    // not worth indexing" and "this is a copy of that", and a crawler given both may believe either.
    if (location.search !== '') {
        return [
            { title: search ? `${search} - Browse games - MyVideoGameList` : 'Browse games - MyVideoGameList' },
            { name: 'robots', content: 'noindex, follow' },
        ];
    }

    return pageMeta({
        site: loaderData.site,
        title: 'Browse games - MyVideoGameList',
        description: 'Search and browse games across PC, PlayStation, Xbox and Nintendo, and add them to your lists.',
        path: '/games',
    });
}

export function GamesPage({ loaderData }: Route.ComponentProps) {
    const { page, browse, genres, platforms, currentYear } = loaderData;
    const activeSearch = browse.search;

    // Everything that picks a result set, as one string. It is what the pagination resets on and
    // what a pending navigation is compared against.
    const activeKey = browseParams(browse).toString();

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
    // result set first.
    const [lastKey, setLastKey] = useState(activeKey);
    if (lastKey !== activeKey) {
        setLastKey(activeKey);
        setExtraGames([]);
        setHasMore(page.hasMore);
        setOffset(PAGE_SIZE);
        setError(null);
        setLoadingMore(false);

        // A term this component did not push — the back button, a shared link — replaces the box,
        // and becomes what counts as pushed, or the guard in the effect below would refuse to push
        // that same term again if it were typed back in later.
        if (pushedSearch !== activeSearch) {
            setSearch(activeSearch);
            setPushedSearch(activeSearch);
        }
    }

    // Push the debounced term into the URL. The loader re-runs on the resulting navigation, so
    // the URL — not this component — owns which results are displayed.
    useEffect(() => {
        const trimmed = search.trim();
        // Already in the URL, or already on its way there — a filter change carries the typed term
        // with it, and pushing it a second time would only run the same loader twice.
        if (trimmed === activeSearch || trimmed === pushedSearch) return;

        const timer = setTimeout(() => {
            setPushedSearch(trimmed);

            const next = new URLSearchParams(searchParams);
            if (trimmed) next.set('search', trimmed);
            else next.delete('search');

            // replace, so typing does not add one history entry per debounce interval.
            setSearchParams(next, { replace: true, preventScrollReset: true });
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [search, activeSearch, pushedSearch, searchParams, setSearchParams]);

    // The browse a navigation is on its way to, when one is out. `browse` is the last loader result
    // that *landed*, so it is a step behind from the click that starts a navigation until it settles.
    const pendingBrowse = navigation.location && navigation.location.pathname === '/games'
        ? browseFrom(new URLSearchParams(navigation.location.search))
        : null;

    /**
     * A change of order or filter, applied to the URL at once.
     *
     * Carries the term in the box rather than the one in the URL, so a filter picked before the
     * search debounce fires does not throw away what was typed. A new history entry, unlike typing:
     * each filter is a deliberate step somebody may want to go back from.
     *
     * Built on the browse that is on its way when there is one. Built on `browse`, a second filter
     * chosen while the first was still loading would be applied to the listing as it was before
     * it — dropping the first filter, which the reader had already watched the page start on.
     */
    const changeBrowse = (changes: Partial<GameBrowse>) => {
        const trimmed = search.trim();
        setPushedSearch(trimmed);
        setSearchParams(
            browseParams({ ...(pendingBrowse ?? browse), search: trimmed, ...changes }),
            { preventScrollReset: true },
        );
    };

    const clearFilters = () => changeBrowse({ platform: null, genre: null, year: null, minScore: null });

    // Abandon an in-flight "load more" when the result set changes underneath it, so a late
    // page of the previous browse cannot append itself to the new one.
    useEffect(() => () => {
        isLoadingMoreRef.current = false;
        loadMoreControllerRef.current?.abort();
    }, [activeKey]);

    const games = extraGames.length > 0 ? [...page.items, ...extraGames] : page.items;

    // Only while the loader is fetching a *different* result set. Without the comparison the list
    // would blank out during any navigation, including leaving for a game page.
    const pendingKey = pendingBrowse === null ? null : browseParams(pendingBrowse).toString();
    const loading = navigation.state === 'loading' && pendingKey !== null && pendingKey !== activeKey;

    const loadMore = useCallback(() => {
        if (isLoadingMoreRef.current || !hasMore) return;
        isLoadingMoreRef.current = true;
        setLoadingMore(true);

        const controller = new AbortController();
        loadMoreControllerRef.current = controller;

        fetchGamesPage(offset, browse, controller.signal)
            .then(data => {
                if (controller.signal.aborted) return;
                // An order with ties can hand the same game back on two neighbouring pages, since
                // IGDB pages by offset over a single sort field. Shown once, not twice under one key.
                setExtraGames(prev => {
                    const seen = new Set([...page.items, ...prev].map(game => game.id));
                    return [...prev, ...data.items.filter(game => !seen.has(game.id))];
                });
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
    }, [offset, browse, hasMore, page.items]);

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

    const narrowed = activeSearch !== '' || isFiltered(browse);

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

                    <GameBrowseFilters
                        browse={browse}
                        platforms={platforms}
                        genres={genres}
                        years={yearsFrom(currentYear)}
                        onChange={changeBrowse}
                        onClear={clearFilters}
                    />
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
                        <div className="text-center max-w-md">
                            <svg className="w-14 h-14 text-slate-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <p className="text-slate-400 light:text-slate-600 font-medium">
                                {activeSearch ? 'No games match your search.' : narrowed ? 'No games match these filters.' : 'No games found.'}
                            </p>
                            {/* The one empty page the reader cannot explain from what they chose: a
                                year's games rarely have eight critic reviews until long after release,
                                so Top rated for a recent year is empty by construction. */}
                            {!activeSearch && browse.sort === 'rating' && isFiltered(browse) && (
                                <p className="text-slate-500 light:text-slate-500 text-sm mt-2">
                                    Top rated only ranks games with at least eight critic reviews, which
                                    recent and niche games often do not have yet. Popular or Newest
                                    reach further.
                                </p>
                            )}
                            {isFiltered(browse) && (
                                <button
                                    type="button"
                                    className="mt-4 text-blue-400 light:text-blue-700 text-sm font-semibold hover:underline"
                                    onClick={clearFilters}
                                >
                                    Clear filters
                                </button>
                            )}
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
