import { ReleaseRailCard } from '@/components/ReleaseRailCard';
import { comingSoonWhen } from '@/lib/comingSoon';
import type { JustOutGame } from '@/types/releases';

interface JustOutRailProps {
    games: JustOutGame[];
    /** `YYYY-MM-DD`: the day the page was rendered for, which decides when a date needs its year. */
    today: string;
}

/**
 * The new games of the last three months most watched on Twitch, the newest first (ADR 0073), as a grid of
 * covers with when and on what under each, the newest leading at twice the size (ADR 0075). Each says the
 * day it came out as Coming soon writes a day, so the two panels read alike.
 *
 * As many columns as fit at 12.5rem, five on a desktop and two on a phone, and dense, so that the cards
 * after the lead fill the rows beside it. The same for everybody, so it is in the shared home payload and
 * the first HTML; lazy covers throughout, since it sits below whatever the page opens with.
 */
export function JustOutRail({ games, today }: JustOutRailProps) {
    if (games.length === 0) return null;

    return (
        <ul
            className="grid grid-flow-dense gap-x-6 gap-y-10 grid-cols-[repeat(auto-fill,minmax(min(12.5rem,42%),1fr))]"
            aria-label="Just out"
        >
            {games.map((game, index) => (
                <ReleaseRailCard
                    key={game.gameId}
                    game={game}
                    lead={index === 0}
                    when={<time dateTime={game.released}>{comingSoonWhen({ precision: 'day', starts: game.released }, today)}</time>}
                />
            ))}
        </ul>
    );
}
