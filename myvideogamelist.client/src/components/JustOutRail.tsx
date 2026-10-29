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
 * Two columns on a phone, three from `sm`, four from `lg` and six from `xl`, never five, and dense, so that
 * the cards after the lead fill the rows beside it. The lead takes four cells and the other eight one each,
 * and twelve fill each of those widths with nothing left over: the server sends nine (`JustOut.MaxShown`)
 * for that, and a width of five would leave a hole in the last row. At six the lead is a third of the
 * width, small enough that a dull cover does not set the whole panel's tone. The same for everybody, so it
 * is in the shared home payload and the first HTML; lazy covers throughout, since it sits below whatever
 * the page opens with.
 */
export function JustOutRail({ games, today }: JustOutRailProps) {
    if (games.length === 0) return null;

    return (
        <ul
            className="grid grid-flow-dense gap-x-6 gap-y-10 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
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
