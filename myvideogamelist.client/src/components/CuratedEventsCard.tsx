import { useState } from 'react';
import { CuratedEventForm } from '@/components/CuratedEventForm';
import type { SaveResult } from '@/hooks/useCalendarAdmin';
import { formatDaySpan, localToday } from '@/lib/daySpan';
import {
    CURATED_EVENT_KIND_LABELS,
    type CuratedEvent,
    type CuratedEventInput,
    storeLabel,
} from '@/types/calendarAdmin';

interface CuratedEventsCardProps {
    events: CuratedEvent[];
    addEvent: (input: CuratedEventInput) => Promise<SaveResult>;
    replaceEvent: (id: number, input: CuratedEventInput) => Promise<SaveResult>;
    removeEvent: (id: number) => Promise<SaveResult>;
}

/**
 * The store sales, fests and showcases entered by hand (spec §6), with the form that adds them.
 *
 * What is still to come is listed first and the past is folded away beneath it, because nothing is
 * deleted by age: an old sale costs nothing to keep, and it is the record of when that store last
 * ran one. Rendered only for a signed-in admin, which is to say only in the browser — so reading
 * today's date here cannot disagree with a server render.
 */
export function CuratedEventsCard({ events, addEvent, replaceEvent, removeEvent }: CuratedEventsCardProps) {
    const [editingId, setEditingId] = useState<number | null>(null);
    const [confirmingId, setConfirmingId] = useState<number | null>(null);
    const [removingId, setRemovingId] = useState<number | null>(null);
    const [removeError, setRemoveError] = useState<string | null>(null);

    const today = localToday();
    const upcoming = events.filter(e => e.endsOn >= today);
    // Most recent first, since the one somebody looks for among old events is usually the last.
    const past = events.filter(e => e.endsOn < today).reverse();

    const handleReplace = async (id: number, input: CuratedEventInput) => {
        const result = await replaceEvent(id, input);
        if (result.ok) setEditingId(null);
        return result;
    };

    const handleRemove = async (id: number) => {
        setRemovingId(id);
        setRemoveError(null);
        const result = await removeEvent(id);
        setRemovingId(null);
        setConfirmingId(null);
        if (!result.ok) setRemoveError(result.error);
    };

    const row = (event: CuratedEvent) => {
        if (editingId === event.id) {
            return (
                <li key={event.id}>
                    <CuratedEventForm
                        event={event}
                        onSubmit={input => handleReplace(event.id, input)}
                        onCancel={() => setEditingId(null)}
                    />
                </li>
            );
        }

        const confirming = confirmingId === event.id;
        const removing = removingId === event.id;

        return (
            <li key={event.id}>
                <div className="admin-row">
                    <div className="min-w-0">
                        <div className="admin-row-name">{event.name}</div>
                        <div className="admin-row-meta">
                            <span className="admin-kind">{CURATED_EVENT_KIND_LABELS[event.kind]}</span>
                            {event.store !== null && <>{storeLabel(event.store)} · </>}
                            {formatDaySpan(event.startsOn, event.endsOn)} ·{' '}
                            <a href={event.url} target="_blank" rel="noopener noreferrer">
                                Announcement<span className="sr-only"> for {event.name} (opens in a new tab)</span>
                            </a>
                        </div>
                    </div>

                    {confirming ? (
                        <div className="admin-actions" role="group" aria-label={`Remove ${event.name}?`}>
                            <button
                                type="button"
                                className="admin-btn admin-btn-danger"
                                onClick={() => void handleRemove(event.id)}
                                disabled={removing}
                            >
                                {removing ? 'Removing…' : 'Remove'}
                            </button>
                            <button
                                type="button"
                                className="admin-btn admin-btn-quiet"
                                onClick={() => setConfirmingId(null)}
                                disabled={removing}
                            >
                                Keep
                            </button>
                        </div>
                    ) : (
                        <div className="admin-actions">
                            <button
                                type="button"
                                className="admin-btn admin-btn-quiet"
                                onClick={() => setEditingId(event.id)}
                                aria-label={`Edit ${event.name}`}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                className="admin-btn admin-btn-danger"
                                onClick={() => setConfirmingId(event.id)}
                                aria-label={`Remove ${event.name}`}
                            >
                                Remove
                            </button>
                        </div>
                    )}
                </div>
            </li>
        );
    };

    return (
        <section className="admin-card" aria-labelledby="admin-events-heading">
            <h2 id="admin-events-heading" className="admin-card-title">Sales and events</h2>
            <p className="admin-hint">
                Store-wide sales, Steam&apos;s Next Fest, and showcases IGDB does not have yet. Days, not
                times: stores start their sales at different hours in different places, so enter the days
                they announced.
            </p>

            <CuratedEventForm onSubmit={addEvent} />

            {removeError !== null && <p className="admin-error" role="alert">{removeError}</p>}

            {upcoming.length > 0 ? (
                <ul className="admin-list" aria-label="Current and upcoming">
                    {upcoming.map(row)}
                </ul>
            ) : (
                <p className="admin-hint mt-5">Nothing current or coming up.</p>
            )}

            {past.length > 0 && (
                <details className="admin-past">
                    <summary>Past events ({past.length})</summary>
                    <ul className="admin-list" aria-label="Past">
                        {past.map(row)}
                    </ul>
                </details>
            )}
        </section>
    );
}
