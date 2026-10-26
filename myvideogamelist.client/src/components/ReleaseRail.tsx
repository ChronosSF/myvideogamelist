import type { ReactNode } from 'react';
import { ReleaseRailCard, type ReleaseRailGame } from '@/components/ReleaseRailCard';

interface ReleaseRailProps<T extends ReleaseRailGame> {
    /** The grid's accessible name. */
    label: string;
    games: T[];
    /** The line over each title: when the game comes out, or came out. */
    when: (game: T) => ReactNode;
}

/**
 * A grid of covers with when and on what under each, the first of them twice the size: the home page's Just
 * out panel (ADR 0073), newest first, so the newest leads (ADR 0075).
 *
 * As many columns as fit at 12.5rem, five on a desktop and two on a phone, and dense, so that the cards
 * after the lead fill the rows beside it. The same for everybody, so it is in the shared home payload and
 * the first HTML; lazy covers throughout, since it sits below whatever the page opens with.
 */
export function ReleaseRail<T extends ReleaseRailGame>({ label, games, when }: ReleaseRailProps<T>) {
    if (games.length === 0) return null;

    return (
        <ul
            className="grid grid-flow-dense gap-x-6 gap-y-10 grid-cols-[repeat(auto-fill,minmax(min(12.5rem,42%),1fr))]"
            aria-label={label}
        >
            {games.map((game, index) => (
                <ReleaseRailCard key={game.gameId} game={game} when={when(game)} lead={index === 0} />
            ))}
        </ul>
    );
}
