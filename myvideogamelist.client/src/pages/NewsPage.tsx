import { Link } from 'react-router';
import { NewsCard } from '@/components/NewsCard';
import { useAuth } from '@/hooks/useAuth';
import { useTrackedNews } from '@/hooks/useTrackedNews';
import { PRIVATE_NO_STORE } from '@/lib/cache';

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
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">
                        News for your games
                    </h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                        Patch notes and announcements from Steam for the games in your lists and on
                        your wishlist.
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {signedOut && (
                    <div className="flex items-center justify-center py-24">
                        <p className="text-slate-400 light:text-slate-600 font-medium">
                            Sign in to see news for the games you track.
                        </p>
                    </div>
                )}

                {/* Auth's wait as well as the fetch's, so the two read as one loading state. */}
                {(authLoading || (signedIn && loading)) && (
                    <div className="flex items-center justify-center py-24">
                        <div className="flex flex-col items-center gap-4" role="status">
                            <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
                            <p className="text-slate-400 light:text-slate-600 text-sm">Loading news for your games…</p>
                        </div>
                    </div>
                )}

                {signedIn && !loading && error !== null && (
                    <div className="flex items-center justify-center py-24" role="alert">
                        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-8 max-w-md text-center">
                            <p className="text-red-300 light:text-red-700 font-medium mb-1">Failed to load news</p>
                            <p className="text-red-400/70 light:text-red-700/80 text-sm mb-4">{error}</p>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
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
                            <p className="text-slate-300 light:text-slate-700 font-medium mb-2">
                                No news for your games right now.
                            </p>
                            <p className="text-slate-400 light:text-slate-600 text-sm mb-5">
                                News comes from Steam, so a game with no Steam page never has any. Add
                                what you are playing or waiting for, and its patch notes will turn up
                                here.
                            </p>
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
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
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                            {news.map(item => (
                                <NewsCard key={item.id} item={item} />
                            ))}
                        </div>

                        {/* Says what the list is not, since it is not everything. */}
                        <p className="mt-6 text-xs text-slate-500 light:text-slate-600">
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
