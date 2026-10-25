import { ReleaseRail } from '@/components/ReleaseRail';
import { comingSoonWhen } from '@/lib/comingSoon';
import type { ComingSoonGame } from '@/types/releases';

interface ComingSoonRailProps {
    games: ComingSoonGame[];
    /** `YYYY-MM-DD`: the day the page was rendered for, which decides when a date needs its year. */
    today: string;
}

/**
 * The new games of the next three months that the most people follow on IGDB, in the order they arrive
 * (ADR 0071), each with when it comes out to the precision IGDB knows.
 */
export function ComingSoonRail({ games, today }: ComingSoonRailProps) {
    return (
        <ReleaseRail
            label="Coming soon"
            games={games}
            // A day and a month are dates a machine can read; a quarter is not one.
            when={game => game.precision === 'quarter'
                ? comingSoonWhen(game, today)
                : <time dateTime={game.precision === 'day' ? game.starts : game.starts.slice(0, 7)}>{comingSoonWhen(game, today)}</time>}
        />
    );
}
