import { Link } from 'react-router';
import { GameCard } from '@/components/GameCard';
import { useWishlist } from '@/hooks/useWishlist';
import { useAuth } from '@/hooks/useAuth';
import { PRIVATE_NO_STORE } from '@/lib/cache';

/**
 * The wishlist is one user's data, so it is never cacheable. Declared here rather than inherited
 * from the root default, so that relaxing the root cannot silently make this page shared.
 */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'My wishlist - MyVideoGameList' },
        { name: 'description', content: 'Games you want, whatever list they are in.' },
    ];
}

/**
 * Tiles only, ordered newest first.
 *
 * No toolbar and no table view, deliberately: a wishlist item has no score and no status, so four
 * of the table's columns would be empty and its sort options would be meaningless. "When did I
 * start wanting this" is the only ordering the axis has, and it is the default.
 */
export function WishlistPage() {
    const { user } = useAuth();
    const { items, loading, error } = useWishlist();

    return (
        <div className="min-h-screen">
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">
                        My Wishlist
                    </h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                        Games you want. Separate from your lists, so a game can sit here and in
                        Backlog at the same time.
                    </p>
                    {items.length > 0 && (
                        <p className="text-slate-500 light:text-slate-400 text-xs mt-3">
                            {items.length} {items.length === 1 ? 'game' : 'games'}, most recently
                            added first.
                        </p>
                    )}
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {!user && (
                    <div className="flex items-center justify-center py-24">
                        <p className="text-slate-400 light:text-slate-600 font-medium">
                            Sign in to keep a wishlist.
                        </p>
                    </div>
                )}

                {user && loading && (
                    <div className="flex items-center justify-center py-24">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-label="Loading" />
                            <p className="text-slate-400 light:text-slate-600 text-sm">Loading your wishlist…</p>
                        </div>
                    </div>
                )}

                {user && !loading && error && (
                    <div className="flex items-center justify-center py-24" role="alert">
                        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-8 max-w-md text-center">
                            <p className="text-red-300 font-medium mb-1">Failed to load wishlist</p>
                            <p className="text-red-400/70 text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {user && !loading && !error && items.length === 0 && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <svg className="w-14 h-14 text-slate-700 light:text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                            <p className="text-slate-400 light:text-slate-600 font-medium mb-3">
                                Nothing on your wishlist yet.
                            </p>
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
                            >
                                Browse Games
                            </Link>
                        </div>
                    </div>
                )}

                {user && !loading && !error && items.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {items.map(item => (
                            <GameCard key={item.game.id} game={item.game} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default WishlistPage;
