import { startTime, type DayEvent } from '@/lib/calendarEvents';
import { dayLabel, formatDaySpan } from '@/lib/daySpan';
import { CURATED_EVENT_KIND_LABELS, storeLabel } from '@/types/calendarAdmin';
import './ReleaseAgenda.css';

interface ReleaseAgendaEventProps {
    event: DayEvent;
    /** The large words: a day, a run of days, or "On now". */
    label: string;
    /** Under them, smaller: how far off it is, until when, or its time on the reader's clock. */
    detail: string;
    /** Which of the two says that it is on now, which is drawn in the accent. */
    on?: 'label' | 'detail';
    /** Over before today: still listed where it happened, quieter than what is to come. */
    past?: boolean;
}

/**
 * A sale, a fest or a showcase in a list of what is on (ADR 0075): when, what it is and who runs it, and its
 * name, linked to where it is announced or streams. The two-week line and the calendar each say when in
 * words of their own and hand them in; the rest, and what a screen reader hears, is this, in both.
 */
export function ReleaseAgendaEvent({ event, label, detail, on, past = false }: ReleaseAgendaEventProps) {
    const time = event.startsAt === null ? null : startTime(event.startsAt);
    const when = time === null ? formatDaySpan(event.startsOn, event.endsOn) : `${dayLabel(event.startsOn).full}, ${time}`;

    return (
        <li className="release-agenda-item" data-kind={event.kind} data-past={past || undefined}>
            <p className="release-agenda-when">
                <span className="release-agenda-day" data-on={on === 'label' || undefined}>{label}</span>
                <span className="release-agenda-detail" data-on={on === 'detail' || undefined}>{detail}</span>
            </p>
            <div className="release-agenda-body">
                <p className="release-agenda-kind">
                    {CURATED_EVENT_KIND_LABELS[event.kind]}
                    {event.store !== null && <> · {storeLabel(event.store)}</>}
                </p>
                {event.url === null ? (
                    <p className="release-agenda-name">{event.name}</p>
                ) : (
                    <a className="release-agenda-name" href={event.url} target="_blank" rel="noopener noreferrer">
                        {event.name} <span className="sr-only">(opens in a new tab)</span>
                    </a>
                )}
                <span className="sr-only">, {when}</span>
            </div>
        </li>
    );
}
