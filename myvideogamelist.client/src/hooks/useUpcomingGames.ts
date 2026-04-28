import { useEffect, useState } from 'react';
import type { GameDto } from '@/types/game';

export interface UseUpcomingGamesResult {
    games: GameDto[];
    loading: boolean;
    error: string | null;
}

export function useUpcomingGames(): UseUpcomingGamesResult {
    const [games, setGames] = useState<GameDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        fetch('/api/games/upcoming', { signal: controller.signal })
            .then(r => {
                if (!r.ok) throw new Error(`Failed to load upcoming releases (${r.status})`);
                return r.json() as Promise<GameDto[]>;
            })
            .then(data => setGames(data))
            .catch(err => {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, []);

    return { games, loading, error };
}
