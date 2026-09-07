import { useEffect, useState } from 'react';
import type { CommunityTimes } from '@/types/playthrough';

/**
 * How long MVGL members report a game taking, fetched on the client after hydration.
 *
 * Deliberately not in the route loader. The game page is edge-cached for an hour
 * (`docs/decisions/0013-*`), and the person most likely to look at this row is the one who has
 * just logged a playthrough of their own — serving them an hour-old figure of their own data
 * would read as the write having failed. Fetching it here also keeps a public page's
 * time-to-first-byte off a query that crawlers do not need, exactly as `GameNewsPanel` does for
 * Steam.
 *
 * Returns null on failure and says nothing about it. A community row that did not load is not
 * worth an error banner on a page that rendered perfectly well; the row simply is not there.
 */
export function useCommunityTimes(gameId: number): CommunityTimes | null {
    const [times, setTimes] = useState<CommunityTimes | null>(null);
    const [lastGameId, setLastGameId] = useState(gameId);

    // Clear the previous game's figures when navigating straight from one game page to another.
    // Adjusted during render rather than in the effect: resetting in the effect would show the
    // last game's medians under the new title for one commit, and trips
    // react-hooks/set-state-in-effect.
    if (lastGameId !== gameId) {
        setLastGameId(gameId);
        setTimes(null);
    }

    useEffect(() => {
        const controller = new AbortController();

        // No credentials: this is an aggregate over everybody and names nobody, so it is served
        // to signed-out visitors too.
        fetch(`/api/games/${gameId}/community-times`, { signal: controller.signal })
            .then(response => (response.ok ? (response.json() as Promise<CommunityTimes>) : null))
            .then(data => {
                if (controller.signal.aborted) return;
                setTimes(data);
            })
            .catch(() => {
                // Swallowed by design, and `catch` rather than only `!response.ok` because an
                // unreachable API makes `fetch` reject rather than return a bad response.
            });

        return () => controller.abort();
    }, [gameId]);

    return times;
}
