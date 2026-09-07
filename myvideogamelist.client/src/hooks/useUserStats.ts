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
 * No account-change guard, unlike the two list providers (ADR 0022, decision 8). Those live at the
 * root and survive a sign-out, which is what let one account's data reach the next one. This is
 * only ever mounted inside the signed-in half of the profile route, so signing out unmounts it and
 * the next account starts from a fresh hook. **If it is ever lifted somewhere that outlives a
 * sign-out, it needs that guard**, because the fetch would then be in flight across the change.
 */
export function useUserStats(): UseUserStatsResult {
    const [stats, setStats] = useState<UserStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
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
    }, [reloadToken]);

    const reload = useCallback(() => {
        setLoading(true);
        setReloadToken(token => token + 1);
    }, []);

    return { stats, loading, error, reload };
}
