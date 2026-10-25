import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { useFavourites } from '@/hooks/useFavourites';
import { comingSoonWhen } from '@/lib/comingSoon';
import type { ComingSoonGame } from '@/types/releases';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';

interface ComingSoonRailProps {
    games: ComingSoonGame[];
    /** `YYYY-MM-DD`: the day the page was rendered for, which decides when a date needs its year. */
    today: string;
}

/** Each cover is drawn across its card, `w-32 sm:w-36`, less the one-pixel border on either side. */
const COVER_SIZES = '(min-width: 40rem) calc(9rem - 2px), calc(8rem - 2px)';

/**
 * The new games of the next three months that the most people follow on IGDB, in the order they arrive
 * (ADR 0071) — the same strip of covers as Trending, with when and on what in place of a rank.
 *
 * The same for everybody, so it is in the shared home payload and the first HTML; the reader's own
 * favourites are marked after hydration, as on every rail of the site's (ADR 0064). Lazy covers
 * throughout: it sits below whatever the page opens with, for a visitor and for somebody signed in alike.
 */
export function ComingSoonRail({ games, today }: ComingSoonRailProps) {
    const { isFavourite } = useFavourites();

    if (games.length === 0) return null;

    return (
        <ul
            // Scrolls on its own, so it is a focusable region with a name, snapped to the gutter below `sm`
            // where the first card sits — both for the reasons TrendingRail gives.
            className="relative flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 scroll-px-4 sm:scroll-px-0 snap-x snap-mandatory scroll-smooth"
            tabIndex={0}
            aria-label="Coming soon"
        >
            {games.map(game => {
                const when = comingSoonWhen(game, today);

                return (
                    <li key={game.gameId} className="shrink-0 snap-start">
                        <Link
                            to={`/games/${game.gameId}`}
                            className="group block w-32 sm:w-36 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus rounded-xl"
                        >
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-surface border border-line group-hover:border-primary-500/60 transition-all duration-300 group-hover:-translate-y-1 shadow-lg">
                                {game.coverImageUrl && (
                                    <CoverImage
                                        url={game.coverImageUrl}
                                        alt=""
                                        sizes={COVER_SIZES}
                                        className="w-full h-full object-cover"
                                    />
                                )}

                                {isFavourite(game.gameId) && <FavouriteMark variant="cover" />}
                            </div>

                            {/* A day and a month are dates a machine can read; a quarter is not one. */}
                            <p className="mt-2 text-xs font-semibold text-primary-400">
                                {game.precision === 'quarter'
                                    ? when
                                    : <time dateTime={game.precision === 'day' ? game.starts : game.starts.slice(0, 7)}>{when}</time>}
                            </p>

                            <p className="mt-0.5 text-sm font-medium text-fg leading-snug line-clamp-2 group-hover:text-primary-400 transition-colors">
                                {game.title}
                                {isFavourite(game.gameId) && <FavouriteWords />}
                            </p>

                            {game.platforms.length > 0 && (
                                <p className="mt-0.5 text-xs text-fg-muted line-clamp-1">
                                    {game.platforms.map(p => p.abbreviation).join(', ')}
                                </p>
                            )}
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
