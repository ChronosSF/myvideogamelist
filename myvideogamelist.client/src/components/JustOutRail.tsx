import { ReleaseRail } from '@/components/ReleaseRail';
import { comingSoonWhen } from '@/lib/comingSoon';
import type { JustOutGame } from '@/types/releases';

interface JustOutRailProps {
    games: JustOutGame[];
    /** `YYYY-MM-DD`: the day the page was rendered for, which decides when a date needs its year. */
    today: string;
}

/**
 * The new games of the last three months most watched on Twitch, the newest first (ADR 0073), each with the
 * day it came out — written as Coming soon writes a day, so the two panels read alike.
 */
export function JustOutRail({ games, today }: JustOutRailProps) {
    return (
        <ReleaseRail
            label="Just out"
            games={games}
            when={game => (
                <time dateTime={game.released}>{comingSoonWhen({ precision: 'day', starts: game.released }, today)}</time>
            )}
        />
    );
}
