import { useEffect, useState } from 'react';
import type { PlatformDto } from '@/types/game';

export interface UseActivePlatformsResult {
    platforms: PlatformDto[];
    loading: boolean;
    error: string | null;
}

/**
 * The platforms the API considers active, fetched only when something actually needs them.
 *
 * The profile's playtime breakdown carries bare IGDB platform ids, because `/api/user/stats` must
 * not make an IGDB call (ADR 0023). Most of those ids are already resolvable from the games in the
 * user's lists — but a game they have since removed, or one the lists failed to load, leaves an id
 * with no name. This is the second place to look before falling back to printing the id.
 *
 * `enabled` is what keeps that from being a request every profile view makes: it is false when
 * every id already has a name.
 */
export function useActivePlatforms(enabled: boolean): UseActivePlatformsResult {
    const [platforms, setPlatforms] = useState<PlatformDto[]>([]);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);

    // Adjusted during render rather than from the effect, which would commit one frame claiming
    // not to be loading while the request is already out — and trips
    // react-hooks/set-state-in-effect.
    const [lastEnabled, setLastEnabled] = useState(enabled);
    if (lastEnabled !== enabled) {
        setLastEnabled(enabled);
        setLoading(enabled);
        setError(null);
    }

    useEffect(() => {
        if (!enabled) return;

        const controller = new AbortController();

        fetch('/api/platforms/active', { signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error(`Failed to load platform names (${response.status})`);
                return response.json() as Promise<PlatformDto[]>;
            })
            .then(data => {
                if (controller.signal.aborted) return;
                setPlatforms(data);
                setError(null);
            })
            .catch(err => {
                // A rejection is the unreachable-API case, which `!response.ok` never reports.
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Failed to load platform names.');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [enabled]);

    return { platforms, loading, error };
}
