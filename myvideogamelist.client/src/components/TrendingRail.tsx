import { Link } from 'react-router';
import type { GameDto } from '@/types/game';

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
    if (games.length === 0) return null;

    return (
        <ul
            className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scroll-smooth"
            // The rail scrolls independently of the page, so it is a focusable region with a name
            // rather than a silent overflow container a keyboard user cannot reach.
            tabIndex={0}
            aria-label="Trending games"
        >
            {games.map((game, index) => (
                <li key={game.id} className="shrink-0 snap-start">
                    <Link
                        to={`/games/${game.id}`}
                        className="group block w-32 sm:w-36 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl"
                    >
                        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800 light:bg-slate-100 border border-slate-700/50 light:border-slate-200 group-hover:border-blue-500/60 transition-all duration-300 group-hover:-translate-y-1 shadow-lg">
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
                                className="absolute top-1.5 left-1.5 w-6 h-6 rounded-md bg-slate-950/80 backdrop-blur-sm text-xs font-bold text-white flex items-center justify-center"
                                aria-hidden="true"
                            >
                                {index + 1}
                            </span>
                        </div>

                        <p className="mt-2 text-sm font-medium text-slate-200 light:text-slate-800 leading-snug line-clamp-2 group-hover:text-blue-400 light:group-hover:text-blue-600 transition-colors">
                            {game.title}
                        </p>
                    </Link>
                </li>
            ))}
        </ul>
    );
}
