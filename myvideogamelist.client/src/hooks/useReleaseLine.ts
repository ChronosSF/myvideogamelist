import { useCallback } from 'react';
import { useAccountResource } from '@/hooks/useAccountResource';
import { apiFetch } from '@/lib/api';
import { addDays, localToday } from '@/lib/daySpan';
import { LINE_DAYS } from '@/lib/releaseLine';
import type { CalendarEvents, ReleaseEntry } from '@/types/releases';

/** One of the line's two reads, as the line needs it. */
export interface LineRead<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
}

export interface UseReleaseLineResult {
    /** The line's first day: today, on the reader's own calendar. */
    today: string;
    releases: LineRead<ReleaseEntry[]>;
    events: LineRead<CalendarEvents>;
}

/**
 * What the two-week line draws (`specs/release-timeline-and-calendar.md` §2.1): the user's releases
 * known to the day, and the showcases and sales beside them.
 *
 * Two reads, each failing on its own, because the spec has them fail apart: when IGDB is down the
 * releases are missing and say so, and the sales, which are ours, still show (§8.1).
 *
 * Both go through `useAccountResource` and so take the account id, as `useUserStats` does (C2): the
 * home page outlives a sign-out, and one account's releases must never be drawn under another's
 * name. The events are the same for everybody, but they are drawn inside a signed-in section, and
 * going through the same guard costs nothing.
 *
 * Today is read from the reader's clock during render. That is safe only because the line is in the
 * signed-in half of the home page, which never server-renders: who is signed in is learned from a
 * fetch. The day is part of what each read is scoped to, so a page left open past midnight asks
 * again for the new two weeks the next time it renders.
 *
 * @param accountId Whose line it is, or null when nobody is signed in, which reads nothing.
 */
export function useReleaseLine(accountId: string | null): UseReleaseLineResult {
    const today = localToday();
    const window = `from=${today}&to=${addDays(today, LINE_DAYS)}`;

    // `precision` is left at the API's default, `day`: the line shows nothing known only to a month,
    // a quarter or a year (L2).
    const loadReleases = useCallback(async (signal: AbortSignal): Promise<ReleaseEntry[]> => {
        const response = await apiFetch(`/api/user/releases?${window}`, { signal });
        if (!response.ok) throw new Error(`What is coming for your games could not be loaded (${response.status}).`);
        return (await response.json()) as ReleaseEntry[];
    }, [window]);

    const loadEvents = useCallback(async (signal: AbortSignal): Promise<CalendarEvents> => {
        const response = await apiFetch(`/api/calendar/events?${window}`, { signal });
        if (!response.ok) throw new Error(`The showcases and sales could not be loaded (${response.status}).`);
        return (await response.json()) as CalendarEvents;
    }, [window]);

    const releases = useAccountResource<ReleaseEntry[]>(accountId, `release-line|${today}`, loadReleases);
    const events = useAccountResource<CalendarEvents>(accountId, `calendar-events|${today}`, loadEvents);

    return {
        today,
        releases: { data: releases.data, loading: releases.loading, error: releases.error },
        events: { data: events.data, loading: events.loading, error: events.error },
    };
}
