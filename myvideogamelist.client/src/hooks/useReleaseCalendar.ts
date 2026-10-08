import { useCallback } from 'react';
import { useAccountResource } from '@/hooks/useAccountResource';
import type { LineRead } from '@/hooks/useReleaseLine';
import { apiFetch } from '@/lib/api';
import { localToday } from '@/lib/daySpan';
import { calendarWindow } from '@/lib/releaseCalendar';
import type { CalendarEvents, ReleaseEntry, UndatedEntry } from '@/types/releases';

/** One of the calendar's reads, as the calendar needs it. */
export interface CalendarRead<T> extends LineRead<T> {
    /** Asks again, after a failure. */
    reload: () => void;
}

export interface UseReleaseCalendarResult {
    /** Today, on the reader's own calendar. The calendar opens on its month. */
    today: string;
    releases: CalendarRead<ReleaseEntry[]>;
    events: CalendarRead<CalendarEvents>;
    undated: CalendarRead<UndatedEntry[]>;
}

/**
 * What the calendar draws (`specs/release-timeline-and-calendar.md` §2.2): the user's releases over
 * the month it opens on and the twelve after it, to the day and to a month, a quarter or a year; the
 * showcases and sales over the same days; and the games announced with no date at all.
 *
 * The whole year in one read rather than a read per month, so that moving between months asks nothing:
 * the API takes up to 400 days for exactly this, and keeps IGDB's answer for an hour.
 *
 * Three reads, each failing on its own as the line's two do (§8.1): without IGDB the releases are
 * missing and say so, and the sales, which are ours, still show. Each goes through
 * `useAccountResource` and so takes the account id (C2), and today is read from the reader's clock
 * during render — safe only because the calendar is drawn for a signed-in reader, which is learned from
 * a fetch and so never server-rendered. The releases and the events are scoped to the window, which
 * moves when the month does.
 *
 * @param accountId Whose calendar it is, or null when nobody is signed in, which reads nothing.
 */
export function useReleaseCalendar(accountId: string | null): UseReleaseCalendarResult {
    const today = localToday();
    const { from, to } = calendarWindow(today);
    const window = `from=${from}&to=${to}`;

    const loadReleases = useCallback(async (signal: AbortSignal): Promise<ReleaseEntry[]> => {
        const response = await apiFetch(`/api/user/releases?${window}&precision=any`, { signal });
        if (!response.ok) throw new Error(`What is coming for your games could not be loaded (${response.status}).`);
        return (await response.json()) as ReleaseEntry[];
    }, [window]);

    const loadEvents = useCallback(async (signal: AbortSignal): Promise<CalendarEvents> => {
        const response = await apiFetch(`/api/calendar/events?${window}`, { signal });
        if (!response.ok) throw new Error(`The showcases and sales could not be loaded (${response.status}).`);
        return (await response.json()) as CalendarEvents;
    }, [window]);

    const loadUndated = useCallback(async (signal: AbortSignal): Promise<UndatedEntry[]> => {
        const response = await apiFetch('/api/user/releases/undated', { signal });
        if (!response.ok) throw new Error(`What is announced with no date could not be loaded (${response.status}).`);
        return (await response.json()) as UndatedEntry[];
    }, []);

    const releases = useAccountResource<ReleaseEntry[]>(accountId, `release-calendar|${window}`, loadReleases);
    const events = useAccountResource<CalendarEvents>(accountId, `calendar-events|${window}`, loadEvents);
    const undated = useAccountResource<UndatedEntry[]>(accountId, 'release-undated', loadUndated);

    return {
        today,
        releases: { data: releases.data, loading: releases.loading, error: releases.error, reload: releases.reload },
        events: { data: events.data, loading: events.loading, error: events.error, reload: events.reload },
        undated: { data: undated.data, loading: undated.loading, error: undated.error, reload: undated.reload },
    };
}
