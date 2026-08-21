import { useCallback, useEffect, useState } from 'react';

export interface UseHiddenPlatformsResult {
    hiddenIds: Set<number>;
    loading: boolean;
    saving: boolean;
    error: string | null;
    setHiddenIds: (value: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
    save: () => Promise<void>;
}

export function useHiddenPlatforms(authenticated: boolean): UseHiddenPlatformsResult {
    const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(authenticated);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset when the auth state flips. Adjusting state during render rather than inside the
    // effect avoids committing a render that still shows the previous user's preferences,
    // and keeps the effect free of synchronous setState calls.
    const [lastAuthenticated, setLastAuthenticated] = useState(authenticated);
    if (lastAuthenticated !== authenticated) {
        setLastAuthenticated(authenticated);
        setHiddenIds(new Set());
        setError(null);
        setLoading(authenticated);
    }

    useEffect(() => {
        if (!authenticated) return;

        const controller = new AbortController();

        fetch('/api/user/hidden-platforms', { credentials: 'include', signal: controller.signal })
            .then(r => {
                if (!r.ok) throw new Error(`Failed to load hidden platforms (${r.status})`);
                return r.json() as Promise<number[]>;
            })
            .then(ids => setHiddenIds(new Set(ids)))
            .catch(err => {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Unexpected error');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [authenticated]);

    const save = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/user/hidden-platforms', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platformIds: [...hiddenIds] }),
            });
            if (!res.ok) throw new Error(`Failed to save (${res.status})`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unexpected error');
            throw err;
        } finally {
            setSaving(false);
        }
    }, [hiddenIds]);

    return { hiddenIds, loading, saving, error, setHiddenIds, save };
}
