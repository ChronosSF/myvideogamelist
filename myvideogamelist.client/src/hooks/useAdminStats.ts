import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { PermanentFetchError, useAccountResource } from '@/hooks/useAccountResource';
import type { AdminStats } from '@/types/adminStats';

/**
 * The admin page's statistics (ADR 0051).
 *
 * Account-scoped, as the calendar's curation is, although the figures are everybody's: reading them
 * is an admin's alone, so what is on screen goes with the account that was allowed to see it.
 */
export function useAdminStats(accountId: string | null) {
    const load = useCallback(async (signal: AbortSignal): Promise<AdminStats> => {
        const response = await apiFetch('/api/admin/stats', { signal });

        // Being refused is not something retrying fixes: the account is not, or is no longer, an admin.
        if (response.status === 403) throw new PermanentFetchError('Only an admin can use this page.');
        if (!response.ok) throw new Error(`The statistics could not be counted (${response.status}).`);

        return (await response.json()) as AdminStats;
    }, []);

    return useAccountResource<AdminStats>(accountId, 'admin-stats', load);
}
