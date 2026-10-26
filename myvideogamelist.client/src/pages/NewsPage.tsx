import { Link } from 'react-router';
import { LoadingState } from '@/components/LoadingState';
import { NewsCard } from '@/components/NewsCard';
import { NewsCardSkeleton } from '@/components/NewsCardSkeleton';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { useTrackedNews } from '@/hooks/useTrackedNews';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';

/**
 * Which games the news is about says what somebody tracks, so the page is theirs alone and never
 * cacheable. Declared here rather than inherited from the root default, so that relaxing the root
 * cannot silently make it shared.
 */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'News for your games - MyVideoGameList' },
        { name: 'description', content: 'Patch notes and announcements from Steam for the games you track.' },
        // What a crawler is served here is the signed-out shell, which is a page about nothing.
        NOINDEX,
    ];
}

/**
 * Steam news across everything the user tracks, newest first (ROADMAP N6).
 *
 * The home page's news rail is about the games everybody is playing; this is about the user's own.
 * The API decides which of their games are asked about — in progress first, then the wishlist, the
 * backlog, and finished and dropped games last — because the aggregate behind it follows a bounded
 * number of games and keeps the ones it is given first.
 */
export function NewsPage() {
    const { user, loading: authLoading } = useAuth();
    const { news, loading, error, reload } = useTrackedNews(user?.id ?? null);

    // Nobody is signed in or out until auth has answered: the server render never knows, and the
    // first client render has to match it.
    const signedIn = !authLoading && user !== null;
    const signedOut = !authLoading && user === null;
    const ready = signedIn && !loading && error === null && news !== null;

    return (
        <div className="min-h-screen">
            <PageHeader
                title="News for your games"
                description="Patch notes and announcements from Steam for the games in your lists and on your wishlist."
            />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {signedOut && (
                    <div className="flex items-center justify-center py-24">
                        <p className="text-fg-muted font-medium">
                            Sign in to see news for the games you track.
                        </p>
                    </div>
                )}

                {/* Auth's wait as well as the fetch's, so the two read as one loading state. Drawn in
                    the list's own grid, three rows of it. */}
                {(authLoading || (signedIn && loading)) && (
                    <LoadingState label="Loading news for your games…">
                        <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2 border-t-2 border-fg-strong">
                            {Array.from({ length: 6 }, (_, index) => <NewsCardSkeleton key={index} />)}
                        </div>
                    </LoadingState>
                )}

                {signedIn && !loading && error !== null && (
                    <div className="flex items-center justify-center py-24" role="alert">
                        <div className="bg-danger-900/20 border border-danger-700/50 rounded-xl p-8 max-w-md text-center">
                            <p className="text-danger-300 font-medium mb-1">Failed to load news</p>
                            <p className="text-danger-400/70 text-sm mb-4">{error}</p>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-danger-700 hover:bg-danger-600 text-fg-strong text-sm font-semibold rounded-lg transition-colors"
                                onClick={reload}
                            >
                                Try again
                            </button>
                        </div>
                    </div>
                )}

                {/* One explanation for every way of arriving here with nothing, because the API
                    cannot tell them apart and neither can the reader: tracking nothing, tracking only
                    games Steam does not sell, and a quiet week all look the same. */}
                {ready && news.length === 0 && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center max-w-md">
                            <p className="text-fg-soft font-medium mb-2">
                                No news for your games right now.
                            </p>
                            <p className="text-fg-muted text-sm mb-5">
                                News comes from Steam, so a game with no Steam page never has any. Add
                                what you are playing or waiting for, and its patch notes will turn up
                                here.
                            </p>
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-on-primary text-sm font-bold rounded-sm transition-colors"
                            >
                                Browse games
                            </Link>
                        </div>
                    </div>
                )}

                {ready && news.length > 0 && (
                    <>
                        {/* grid-cols-1 rather than an implicit column, for the home rail's reason: an
                            implicit one sizes to its content, and a card's truncated source line counts
                            at full length — wider than a phone. */}
                        <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2 border-t-2 border-fg-strong">
                            {news.map(item => (
                                <NewsCard key={item.id} item={item} />
                            ))}
                        </div>

                        {/* Says what the list is not, since it is not everything. */}
                        <p className="mt-6 text-xs text-fg-faint">
                            What you are playing counts first, then your wishlist and backlog. When
                            there are more games than can be followed at once, finished and dropped
                            games are the ones left out.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}

export default NewsPage;
