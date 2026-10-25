import type { ReactNode } from 'react';
import { ReleaseRailCard, type ReleaseRailGame } from '@/components/ReleaseRailCard';

interface ReleaseRailProps<T extends ReleaseRailGame> {
    /** The rail's accessible name. */
    label: string;
    games: T[];
    /** The line over each title: when the game comes out, or came out. */
    when: (game: T) => ReactNode;
}

/**
 * A strip of covers with when and on what under each: the home page's Coming soon panel and its Just out
 * panel (ADR 0071, 0073), one forward from today and the other back.
 *
 * The same for everybody, so it is in the shared home payload and the first HTML. Lazy covers throughout:
 * it sits below whatever the page opens with, for a visitor and for somebody signed in alike.
 */
export function ReleaseRail<T extends ReleaseRailGame>({ label, games, when }: ReleaseRailProps<T>) {
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
            {games.map(game => <ReleaseRailCard key={game.gameId} game={game} when={when(game)} />)}
        </ul>
    );
}
