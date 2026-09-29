import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { PermanentFetchError, useAccountResource } from '@/hooks/useAccountResource';
import type { CuratedEvent, CuratedEventInput, ShowcaseName } from '@/types/calendarAdmin';

export interface CalendarCuration {
    /** Every curated event, past ones included, earliest first. */
    events: CuratedEvent[];
    /** Alphabetical. */
    names: ShowcaseName[];
}

/**
 * A write's outcome. A refusal carries one sentence for the form as a whole and, where the server
 * said which field it was about, that field's own message — keyed as the form's fields are.
 */
export type SaveResult =
    | { ok: true }
    | { ok: false; error: string; fieldErrors: Partial<Record<string, string>> };

/**
 * "EndsOn" from a model-validation error, or "$.endsOn" from a body that did not bind, as the form's
 * own field name.
 */
function fieldOf(key: string): string {
    const last = key.split('.').pop() ?? key;
    return last.charAt(0).toLowerCase() + last.slice(1);
}

/**
 * What the server refused and why. It answers `ValidationProblemDetails` for anything wrong with the
 * input — "The last day cannot be before the first", a name already on the list — and plain
 * `ProblemDetails` otherwise; a body that is not JSON at all is a proxy's error page.
 */
async function refusal(response: Response, fallback: string): Promise<Extract<SaveResult, { ok: false }>> {
    const fieldErrors: Partial<Record<string, string>> = {};
    try {
        const problem = (await response.json()) as {
            title?: string;
            detail?: string;
            errors?: Record<string, string[]>;
        };

        for (const [key, messages] of Object.entries(problem.errors ?? {})) {
            if (messages.length > 0) fieldErrors[fieldOf(key)] ??= messages[0];
        }

        const first = Object.values(fieldErrors)[0];
        return { ok: false, error: first ?? problem.detail ?? problem.title ?? fallback, fieldErrors };
    } catch {
        return { ok: false, error: fallback, fieldErrors };
    }
}

/** A rejected fetch is the API being unreachable, which `!response.ok` never reports. */
const UNREACHABLE: SaveResult = {
    ok: false,
    error: 'The server could not be reached. Nothing was saved.',
    fieldErrors: {},
};

function earliestFirst(a: CuratedEvent, b: CuratedEvent): number {
    return a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name);
}

function alphabetical(a: ShowcaseName, b: ShowcaseName): number {
    return a.prefix.localeCompare(b.prefix);
}

async function readList<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await apiFetch(path, { signal });

    // Being refused is not something retrying fixes: the account is not, or is no longer, an admin.
    if (response.status === 403) throw new PermanentFetchError('Only an admin can use this page.');
    if (!response.ok) throw new Error(`The calendar's data could not be loaded (${response.status}).`);

    return (await response.json()) as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * The admin page's data and the writes that change it.
 *
 * Account-scoped although the data is everybody's, because *reading* it is an admin's alone: on a
 * sign-out or a change of account what is on screen has to go with the account that was allowed to
 * see it, which is what `useAccountResource` does.
 *
 * Not optimistic, unlike the list providers. Nothing here is clicked forty times a session, and a
 * date that appeared saved and then quietly rolled back is the one mistake this page cannot afford —
 * so each write waits for the server and then changes what is shown.
 */
export function useCalendarAdmin(accountId: string | null) {
    const load = useCallback(async (signal: AbortSignal): Promise<CalendarCuration> => {
        const [events, names] = await Promise.all([
            readList<CuratedEvent[]>('/api/admin/calendar/events', signal),
            readList<ShowcaseName[]>('/api/admin/calendar/showcase-names', signal),
        ]);
        return { events, names };
    }, []);

    const resource = useAccountResource<CalendarCuration>(accountId, 'admin-calendar', load);
    const { patch } = resource;

    const addEvent = useCallback(async (input: CuratedEventInput): Promise<SaveResult> => {
        try {
            const response = await apiFetch('/api/admin/calendar/events', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify(input),
            });
            if (!response.ok) return refusal(response, 'The event could not be added.');

            const added = (await response.json()) as CuratedEvent;
            patch(data => ({ ...data, events: [...data.events, added].sort(earliestFirst) }));
            return { ok: true };
        } catch {
            return UNREACHABLE;
        }
    }, [patch]);

    const replaceEvent = useCallback(async (id: number, input: CuratedEventInput): Promise<SaveResult> => {
        try {
            const response = await apiFetch(`/api/admin/calendar/events/${id}`, {
                method: 'PUT',
                headers: JSON_HEADERS,
                body: JSON.stringify(input),
            });

            // Removed meanwhile — in another tab, most likely. Say so and take it off the page.
            if (response.status === 404) {
                patch(data => ({ ...data, events: data.events.filter(e => e.id !== id) }));
                return { ok: false, error: 'That event has been removed since this page loaded.', fieldErrors: {} };
            }
            if (!response.ok) return refusal(response, 'The event could not be saved.');

            const saved = (await response.json()) as CuratedEvent;
            patch(data => ({
                ...data,
                events: data.events.map(e => (e.id === id ? saved : e)).sort(earliestFirst),
            }));
            return { ok: true };
        } catch {
            return UNREACHABLE;
        }
    }, [patch]);

    const removeEvent = useCallback(async (id: number): Promise<SaveResult> => {
        try {
            const response = await apiFetch(`/api/admin/calendar/events/${id}`, { method: 'DELETE' });

            // A 404 is the same outcome as a success: the event is not there any more.
            if (!response.ok && response.status !== 404) return refusal(response, 'The event could not be removed.');

            patch(data => ({ ...data, events: data.events.filter(e => e.id !== id) }));
            return { ok: true };
        } catch {
            return UNREACHABLE;
        }
    }, [patch]);

    const addName = useCallback(async (prefix: string): Promise<SaveResult> => {
        try {
            const response = await apiFetch('/api/admin/calendar/showcase-names', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ prefix }),
            });
            if (!response.ok) return refusal(response, 'The name could not be added.');

            const added = (await response.json()) as ShowcaseName;
            patch(data => ({ ...data, names: [...data.names, added].sort(alphabetical) }));
            return { ok: true };
        } catch {
            return UNREACHABLE;
        }
    }, [patch]);

    const removeName = useCallback(async (id: number): Promise<SaveResult> => {
        try {
            const response = await apiFetch(`/api/admin/calendar/showcase-names/${id}`, { method: 'DELETE' });
            if (!response.ok && response.status !== 404) return refusal(response, 'The name could not be removed.');

            patch(data => ({ ...data, names: data.names.filter(n => n.id !== id) }));
            return { ok: true };
        } catch {
            return UNREACHABLE;
        }
    }, [patch]);

    return { ...resource, addEvent, replaceEvent, removeEvent, addName, removeName };
}
