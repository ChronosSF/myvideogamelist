import { useCallback, useEffect, useState } from 'react';
import type { UserStats } from '@/types/stats';

export interface UseUserStatsResult {
    stats: UserStats | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

/**
 * The signed-in user's own profile statistics.
 *
 * Fetched here rather than in a route loader because the profile is private and never indexed, so
 * a server render earns nothing — and the route's `private, no-store` policy means a loader
 * response would be refetched on every navigation regardless.
 *
 * @param accountId
 * Whose figures these are, or null when nobody is signed in. **Required, and it is the
 * account-change guard.** This used to have none, on the argument that it was only ever mounted
 * inside the signed-in half of the profile route and so was unmounted by a sign-out — with a note
 * saying it would need one the day it was lifted anywhere that outlives a sign-out. The home page
 * is that day. The guard is the same shape ADR 0022 settled on for the two list providers: the
 * account is held in state beside the data it protects and compared during render, so it cannot
 * lag a commit the way a ref written from an effect does.
 */
export function useUserStats(accountId: string | null): UseUserStatsResult {
    const [stats, setStats] = useState<UserStats | null>(null);
    // Signed out means nothing is being fetched, so "loading" would be a lie that never
    // resolves — the effect below returns early in that case.
    const [loading, setLoading] = useState(accountId !== null);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [account, setAccount] = useState(accountId);

    // Adjusted during render rather than in an effect — React's documented pattern for resetting
    // state when a prop changes, and the only one with no window in which the previous account's
    // figures are on screen under the new account's name. An effect would commit that frame first.
    if (account !== accountId) {
        setAccount(accountId);
        setStats(null);
        setError(null);
        setLoading(accountId !== null);
    }

    useEffect(() => {
        // Nobody signed in, so there is nothing to ask for. Without this the hook would spend a
        // request on a guaranteed 401 every time it mounts on a signed-out page.
        if (accountId === null) return;

        const controller = new AbortController();

        fetch('/api/user/stats', { credentials: 'include', signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error(`Failed to load your stats (${response.status})`);
                return response.json() as Promise<UserStats>;
            })
            .then(data => {
                if (controller.signal.aborted) return;
                setStats(data);
                setError(null);
            })
            .catch(err => {
                // A rejection is the unreachable-API case, which `!response.ok` never reports.
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Failed to load your stats.');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
        // `accountId` is a dependency as well as the reset above: the reset clears what is on
        // screen, and this is what fetches the new account's figures. Neither alone is enough —
        // clearing without refetching leaves an empty page, and refetching without clearing leaves
        // the old numbers up until the new ones arrive.
    }, [reloadToken, accountId]);

    const reload = useCallback(() => {
        setLoading(true);
        setReloadToken(token => token + 1);
    }, []);

    return { stats, loading, error, reload };
}
