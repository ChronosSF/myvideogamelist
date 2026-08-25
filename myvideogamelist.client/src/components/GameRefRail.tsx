import { Link } from 'react-router';
import type { GameRefDto } from '@/types/game';

interface GameRefRailProps {
    games: GameRefDto[];
    /** Names the scroll region for keyboard and screen-reader users. */
    label: string;
}

/**
 * A horizontally scrolling strip of related games — similar titles, DLC, expansions.
 *
 * Deliberately not `TrendingRail`: that one takes a full `GameDto` and stamps a popularity rank
 * on each cover, neither of which applies to a related-games list.
 */
export function GameRefRail({ games, label }: GameRefRailProps) {
    if (games.length === 0) return null;

    return (
        <ul
            className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x scroll-smooth"
            // Scrolls independently of the page, so it is a named, focusable region rather than a
            // silent overflow container a keyboard user cannot reach.
            tabIndex={0}
            aria-label={label}
        >
            {games.map(game => (
                <li key={game.id} className="shrink-0 snap-start">
                    <Link
                        to={`/games/${game.id}`}
                        className="group block w-28 sm:w-32 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl"
                    >
                        <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800 light:bg-slate-100 border border-slate-700/50 light:border-slate-200 group-hover:border-blue-500/60 transition-all duration-300 group-hover:-translate-y-1 shadow-lg">
                            {game.coverImageUrl ? (
                                <img
                                    src={game.coverImageUrl}
                                    alt=""
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-600 light:text-slate-400">
                                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                                    </svg>
                                </div>
                            )}
                        </div>

                        <p className="mt-2 text-xs sm:text-sm font-medium text-slate-200 light:text-slate-800 leading-snug line-clamp-2 group-hover:text-blue-400 light:group-hover:text-blue-600 transition-colors">
                            {game.name}
                        </p>
                    </Link>
                </li>
            ))}
        </ul>
    );
}
