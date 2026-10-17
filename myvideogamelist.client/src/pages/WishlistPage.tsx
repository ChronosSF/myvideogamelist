import { Link } from 'react-router';
import { GameCard } from '@/components/GameCard';
import { GameGridSkeleton } from '@/components/GameGridSkeleton';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonLine } from '@/components/SkeletonLine';
import { useWishlist } from '@/hooks/useWishlist';
import { useAuth } from '@/hooks/useAuth';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { GAME_GRID, GAME_GRID_FIRST_ROW } from '@/lib/gameGrid';
import { NOINDEX } from '@/lib/seo';

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
        // What a crawler is served here is the signed-out shell, which is a page about nothing.
        NOINDEX,
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
    const { user, loading: authLoading } = useAuth();
    const { items, loading, error, mutationError, reload } = useWishlist();

    // Nobody is signed in or out until auth has answered: the server render never knows, and the
    // first client render has to match it. Checking `user` alone told every signed-in visitor to
    // sign in before showing them their wishlist.
    const signedIn = !authLoading && user !== null;
    const signedOut = !authLoading && user === null;
    const waiting = authLoading || (signedIn && loading);

    return (
        <div className="min-h-screen">
            <PageHeader
                title="My Wishlist"
                description="Games you want. Separate from your lists, so a game can sit here and in Backlog at the same time."
            >
                {items.length > 0 ? (
                    <p className="text-fg-faint text-xs mt-3">
                        {items.length} {items.length === 1 ? 'game' : 'games'}, most recently
                        added first.
                    </p>
                ) : waiting && (
                    // The count's line, held while the wishlist loads: it appears above the grid
                    // when the games do, and would push the grid down by its height if it came
                    // with them.
                    <p className="text-xs mt-3" aria-hidden="true">
                        <SkeletonLine width="w-56" />
                    </p>
                )}
            </PageHeader>

            {/* A failed toggle is shown beside the wishlist, never instead of it: the rollback has
                already put the list back, so hiding it would discard something perfectly good. */}
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

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {signedOut && (
                    <div className="flex items-center justify-center py-24">
                        <p className="text-fg-muted font-medium">
                            Sign in to keep a wishlist.
                        </p>
                    </div>
                )}

                {/* Auth's wait as well as the fetch's. The wishlist is asked for the moment auth
                    answers, so the two read as one loading state rather than two in a row. */}
                {waiting && (
                    <LoadingState label="Loading your wishlist…">
                        <GameGridSkeleton count={GAME_GRID_FIRST_ROW * 2} />
                    </LoadingState>
                )}

                {signedIn && !loading && error && (
                    <div className="flex items-center justify-center py-24" role="alert">
                        <div className="bg-danger-900/20 border border-danger-700/50 rounded-xl p-8 max-w-md text-center">
                            <p className="text-danger-300 font-medium mb-1">Failed to load wishlist</p>
                            <p className="text-danger-400/70 text-sm mb-4">{error}</p>
                            {/* Not decoration. Every wishlist control stays disabled while the
                                load is unresolved, because membership is unknown — so without a
                                retry the only way back is reloading the page. */}
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

                {signedIn && !loading && !error && items.length === 0 && (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <svg className="w-14 h-14 text-fg-dim mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                            <p className="text-fg-muted font-medium mb-3">
                                Nothing on your wishlist yet.
                            </p>
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-on-primary text-sm font-semibold rounded-lg transition-colors"
                            >
                                Browse games
                            </Link>
                        </div>
                    </div>
                )}

                {signedIn && !loading && !error && items.length > 0 && (
                    <div className={GAME_GRID}>
                        {items.map((item, index) => (
                            <GameCard key={item.game.id} game={item.game} eager={index < GAME_GRID_FIRST_ROW} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default WishlistPage;
