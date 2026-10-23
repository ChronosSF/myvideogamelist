import { Link } from 'react-router';
import type { GameDto } from '@/types/game';
import { useFavourites } from '@/hooks/useFavourites';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';

interface TrendingRailProps {
    games: GameDto[];
}

/**
 * A horizontally scrolling strip of cover art.
 *
 * Covers are the point: this replaced three abstract "Track / Discover / Rate" icon cards,
 * because showing a live catalogue is more convincing than describing one (ROADMAP §3.2).
 */
export function TrendingRail({ games }: TrendingRailProps) {
    // The reader's own, marked after hydration on a rail that is the same for everybody (ADR 0064).
    const { isFavourite } = useFavourites();

    if (games.length === 0) return null;

    return (
        <ul
            className="relative flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 scroll-px-4 sm:scroll-px-0 snap-x snap-mandatory scroll-smooth"
            // Positioned, so that the visually hidden words beside a favourite's title are placed inside
            // it. Placed against the page instead, those of a cover scrolled out of view widened the
            // page by the rail's overflow, and a phone could scroll it sideways — as the lists' table
            // and the two-week line once did (ListTable.css, ReleaseLine.css).
            // Snapped to the gutter below `sm`, where the first card sits. Snapped to the rail's own
            // edge, that card's snap position was sixteen pixels in, so the rail scrolled itself there
            // before the first paint — and Chrome counts that as a scroll, which ends the page's LCP
            // measurement with nothing recorded (issue 315).
            // The rail scrolls independently of the page, so it is a focusable region with a name
            // rather than a silent overflow container a keyboard user cannot reach.
            tabIndex={0}
            aria-label="Trending games"
        >
            {games.map((game, index) => (
                <li key={game.id} className="shrink-0 snap-start">
                    <Link
                        to={`/games/${game.id}`}
                        className="group block w-32 sm:w-36 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-xl"
                    >
                        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-surface border border-line group-hover:border-primary-500/60 transition-all duration-300 group-hover:-translate-y-1 shadow-lg">
                            {game.coverImageUrl && (
                                <img
                                    src={game.coverImageUrl}
                                    alt=""
                                    /* The first few are above the fold on most screens; the rest
                                       are scrolled to, so they can wait. */
                                    loading={index < 6 ? 'eager' : 'lazy'}
                                    className="w-full h-full object-cover"
                                />
                            )}

                            <span
                                className="absolute top-1.5 left-1.5 w-6 h-6 rounded-md bg-sunken/80 backdrop-blur-sm text-xs font-bold text-fg-strong flex items-center justify-center"
                                aria-hidden="true"
                            >
                                {index + 1}
                            </span>

                            {isFavourite(game.id) && <FavouriteMark variant="cover" />}
                        </div>

                        <p className="mt-2 text-sm font-medium text-fg leading-snug line-clamp-2 group-hover:text-primary-400 transition-colors">
                            {game.title}
                            {isFavourite(game.id) && <FavouriteWords />}
                        </p>
                    </Link>
                </li>
            ))}
        </ul>
    );
}
