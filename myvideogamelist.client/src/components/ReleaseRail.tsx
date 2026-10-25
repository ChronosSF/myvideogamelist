import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { useFavourites } from '@/hooks/useFavourites';
import type { PlatformDto } from '@/types/game';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';

/** What a card of the rail needs of a game, which both of the home page's release panels have. */
export interface ReleaseRailGame {
    gameId: number;
    title: string;
    coverImageUrl: string | null;
    platforms: PlatformDto[];
}

interface ReleaseRailProps<T extends ReleaseRailGame> {
    /** The rail's accessible name. */
    label: string;
    games: T[];
    /** The line over the title: when the game comes out, or came out. */
    when: (game: T) => ReactNode;
}

/** Each cover is drawn across its card, `w-32 sm:w-36`, less the one-pixel border on either side. */
const COVER_SIZES = '(min-width: 40rem) calc(9rem - 2px), calc(8rem - 2px)';

/**
 * A strip of covers with when and on what under each: the home page's Coming soon panel and its Just out
 * panel (ADR 0071, 0073), one forward from today and the other back.
 *
 * The same for everybody, so it is in the shared home payload and the first HTML; the reader's own
 * favourites are marked after hydration, as on every rail of the site's (ADR 0064). Lazy covers
 * throughout: it sits below whatever the page opens with, for a visitor and for somebody signed in alike.
 */
export function ReleaseRail<T extends ReleaseRailGame>({ label, games, when }: ReleaseRailProps<T>) {
    const { isFavourite } = useFavourites();

    if (games.length === 0) return null;

    return (
        <ul
            // Positioned, so that the visually hidden words beside a favourite's title are placed inside it
            // rather than against the page, which a cover scrolled out of view would widen. Snapped to the
            // gutter below `sm`, where the first card sits: snapped to the rail's own edge, it scrolled
            // itself before the first paint, which ends a page's LCP measurement with nothing recorded
            // (issue 315). It scrolls on its own, so it is a focusable region with a name.
            className="relative flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 scroll-px-4 sm:scroll-px-0 snap-x snap-mandatory scroll-smooth"
            tabIndex={0}
            aria-label={label}
        >
            {games.map(game => (
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

                        <p className="mt-2 text-xs font-semibold text-primary-400">{when(game)}</p>

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
            ))}
        </ul>
    );
}
