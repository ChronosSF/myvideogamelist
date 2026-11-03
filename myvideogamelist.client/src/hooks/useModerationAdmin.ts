import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { PermanentFetchError, useAccountResource } from '@/hooks/useAccountResource';
import type { ModerationQueue, ProfileFields } from '@/types/moderation';

/** An admin's act: done, or the sentence that says why not. */
export type ModerationResult = { ok: true } | { ok: false; error: string };

/** A rejected fetch is the API out of reach, which `!response.ok` never reports. */
const UNREACHABLE: ModerationResult = { ok: false, error: 'The server could not be reached. Nothing was changed.' };

/** What an act's refusal means, by its status: the API answers these with no sentence of its own. */
function refused(status: number, gone: string): ModerationResult {
    if (status === 403) return { ok: false, error: 'Only an admin can do this.' };
    if (status === 404) return { ok: false, error: gone };
    if (status === 409) {
        return {
            ok: false,
            error: 'Its owner saved their profile just now, so nothing was cleared. Look at what they saved, then choose again.',
        };
    }
    return { ok: false, error: `That did not work (${status}). Nothing was changed.` };
}

/** The queue without one reported review, as an act on it leaves it. */
function withoutReview(reviewId: number) {
    return (queue: ModerationQueue): ModerationQueue => ({
        ...queue,
        reviews: queue.reviews.filter(r => r.reviewId !== reviewId),
        reviewsTotal: Math.max(0, queue.reviewsTotal - (queue.reviews.some(r => r.reviewId === reviewId) ? 1 : 0)),
    });
}

/** The queue without one reported profile, as an act on it leaves it. */
function withoutProfile(accountId: string) {
    return (queue: ModerationQueue): ModerationQueue => ({
        ...queue,
        profiles: queue.profiles.filter(p => p.accountId !== accountId),
        profilesTotal: Math.max(0, queue.profilesTotal - (queue.profiles.some(p => p.accountId === accountId) ? 1 : 0)),
    });
}

/**
 * The admin page's moderation card: what readers reported and what was hidden, and the acts an admin may
 * take on them (ADR 0076).
 *
 * Account-scoped, as the page's other data is: reading members' words is an admin's alone, so what is on
 * screen goes with the account that was allowed to see it. Every act takes its item off the list at once
 * and then reads the queue again, which is what brings a review just hidden into the hidden list, with the
 * moment the server gave it.
 */
export function useModerationAdmin(accountId: string | null) {
    const load = useCallback(async (signal: AbortSignal): Promise<ModerationQueue> => {
        const response = await apiFetch('/api/admin/moderation', { signal });

        // Not something retrying fixes: the account is not, or is no longer, an admin.
        if (response.status === 403) throw new PermanentFetchError('Only an admin can use this page.');
        if (!response.ok) throw new Error(`The reports could not be loaded (${response.status}).`);

        return (await response.json()) as ModerationQueue;
    }, []);

    const resource = useAccountResource<ModerationQueue>(accountId, 'moderation', load);
    const { patch, reload } = resource;

    /** Sends one act; on success applies `local` and reads the queue again, and on a 404 reads it again too. */
    const act = useCallback(
        async (path: string, init: RequestInit, gone: string, local: (queue: ModerationQueue) => ModerationQueue) => {
            let response: Response;
            try {
                response = await apiFetch(path, init);
            } catch {
                return UNREACHABLE;
            }

            if (response.ok) {
                patch(local);
                reload();
                return { ok: true } as const;
            }

            // Gone, or changed by its owner: what is on screen is out of date either way.
            if (response.status === 404 || response.status === 409) reload();
            return refused(response.status, gone);
        },
        [patch, reload],
    );

    const hideReview = useCallback(
        (reviewId: number) => act(
            `/api/admin/moderation/reviews/${reviewId}/hidden`,
            { method: 'PUT' },
            'That review is not there any more: its author has deleted it.',
            withoutReview(reviewId),
        ),
        [act],
    );

    const showReview = useCallback(
        (reviewId: number) => act(
            `/api/admin/moderation/reviews/${reviewId}/hidden`,
            { method: 'DELETE' },
            'That review is not hidden any more, or its author has deleted it.',
            queue => ({
                ...queue,
                hidden: queue.hidden.filter(h => h.reviewId !== reviewId),
                hiddenTotal: Math.max(0, queue.hiddenTotal - (queue.hidden.some(h => h.reviewId === reviewId) ? 1 : 0)),
            }),
        ),
        [act],
    );

    const dismissReview = useCallback(
        (reviewId: number) => act(
            `/api/admin/moderation/reviews/${reviewId}/reports`,
            { method: 'DELETE' },
            'Those reports are not there any more.',
            withoutReview(reviewId),
        ),
        [act],
    );

    const clearProfile = useCallback(
        (accountId: string, fields: ProfileFields) => act(
            `/api/admin/moderation/profiles/${encodeURIComponent(accountId)}/clear`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) },
            'That account is not there any more.',
            withoutProfile(accountId),
        ),
        [act],
    );

    const dismissProfile = useCallback(
        (accountId: string) => act(
            `/api/admin/moderation/profiles/${encodeURIComponent(accountId)}/reports`,
            { method: 'DELETE' },
            'Those reports are not there any more.',
            withoutProfile(accountId),
        ),
        [act],
    );

    return { ...resource, hideReview, showReview, dismissReview, clearProfile, dismissProfile };
}

export type UseModerationAdminResult = ReturnType<typeof useModerationAdmin>;
