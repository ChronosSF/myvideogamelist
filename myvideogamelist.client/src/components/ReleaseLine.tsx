import { useMemo } from 'react';
import { CoverImage } from '@/components/CoverImage';
import { ReleaseAgendaDay } from '@/components/ReleaseAgendaDay';
import { ReleaseAgendaEvent } from '@/components/ReleaseAgendaEvent';
import { ReleaseLineHeading } from '@/components/ReleaseLineHeading';
import { useReleaseLine } from '@/hooks/useReleaseLine';
import { startTime } from '@/lib/calendarEvents';
import { dayLabel, daysAway, weekdayAndDay } from '@/lib/daySpan';
import { RELEASE_COVER_SIZES } from '@/lib/releaseCard';
import { LINE_COLUMNS, layoutLine, lineAgenda, type LineDay, type LineEvent, type LineLayout } from '@/lib/releaseLine';
import { CURATED_EVENT_KIND_LABELS } from '@/types/calendarAdmin';
import './ReleaseAgenda.css';
import './ReleaseLine.css';

/**
 * The two weeks as a picture: fourteen equal days, a bar across the days of each sale, fest and showcase,
 * and a small cover on the day of each release (L1, L3). Hidden from assistive technology, because the list
 * under it says all of it in words, with the links; read twice, it would be every event twice.
 */
function Ruler({ layout }: { layout: LineLayout }) {
    const rows = ['auto', ...Array.from({ length: layout.lanes }, () => 'auto'), 'minmax(2.75rem, auto)'].join(' ');

    return (
        <div className="release-ruler" aria-hidden="true" style={{ gridTemplateColumns: LINE_COLUMNS, gridTemplateRows: rows }}>
            {layout.days.map(day => <RulerDay key={day.day} day={day} />)}

            {layout.events.map(event => (
                <span
                    key={event.key}
                    className="release-ruler-bar"
                    data-kind={event.kind}
                    style={{ gridColumn: `${event.first + 1} / ${event.last + 2}`, gridRow: event.lane + 2 }}
                >
                    {CURATED_EVENT_KIND_LABELS[event.kind]} · {event.name}
                </span>
            ))}

            {layout.days.filter(day => day.entries.length > 0).map(day => {
                const releases = day.entries.flatMap(entry => entry.releases);
                const cover = releases.find(r => r.coverImageUrl !== null)?.coverImageUrl ?? null;
                return (
                    <span key={day.day} className="release-ruler-mark" style={{ gridColumn: day.index + 1, gridRow: -2 }}>
                        <span className="release-ruler-cover">
                            {/* The row's size rather than the mark's own 2.25rem, so that the two fetch one file. */}
                            {cover !== null && <CoverImage url={cover} alt="" sizes={RELEASE_COVER_SIZES} eager />}
                        </span>
                        {releases.length > 1 && <span className="release-ruler-count">{releases.length}</span>}
                    </span>
                );
            })}
        </div>
    );
}

/**
 * A day: its column, down the whole ruler so that its rule runs under the bars and the marks, and its label
 * in the first row, a grid item of its own so that the row is as tall as the label is.
 */
function RulerDay({ day }: { day: LineDay }) {
    const { weekday, month, date } = dayLabel(day.day);
    const today = day.index === 0;

    return (
        <>
            <span
                className="release-ruler-day"
                data-today={today || undefined}
                data-week-start={(weekday === 'Mon' && !today) || undefined}
                style={{ gridColumn: day.index + 1 }}
            />
            <span className="release-ruler-label" data-today={today || undefined} style={{ gridColumn: day.index + 1 }}>
                <span className="release-ruler-weekday">{today ? 'Today' : weekday}</span>
                <span className="release-ruler-date">{date}</span>
                <span className="release-ruler-month">{today || date === 1 ? month : ' '}</span>
            </span>
        </>
    );
}

/**
 * A sale, a fest or a showcase in the list, said as the line says when: one running today is on now, and
 * says until when; one to come says the day it starts and its end. A showcase is an hour rather than a run
 * of days, so it says its day and its time on the reader's clock, today included.
 */
function EventItem({ event, today }: { event: LineEvent; today: string }) {
    const time = event.startsAt === null ? null : startTime(event.startsAt);
    const oneDay = event.startsOn === event.endsOn;
    const on = time === null && event.first === 0;

    let label: string;
    let detail: string;
    if (time !== null) {
        label = event.first === 0 ? 'Today' : weekdayAndDay(event.startsOn);
        detail = time;
    } else if (on) {
        label = 'On now';
        detail = oneDay || event.endsOn === today ? 'Today only' : `until ${weekdayAndDay(event.endsOn)}`;
    } else {
        label = weekdayAndDay(event.startsOn);
        detail = oneDay ? daysAway(event.first) : `until ${weekdayAndDay(event.endsOn)}`;
    }

    return <ReleaseAgendaEvent event={event} label={label} detail={detail} on={on ? 'label' : undefined} />;
}

/**
 * The two-week line (`specs/release-timeline-and-calendar.md` §2.1): today and the next thirteen days, as a
 * ruler with a mark on the day of each release and the showcases and sales across their days, and under it
 * the same things as a list in day order, each release with why it is there (ADR 0075). A day with nothing
 * on it is a column of the ruler and no line of the list, so two quiet weeks cost one line of words.
 *
 * Always there, empty or not, with a sentence when nothing is due (L7) — a section that comes and goes
 * is one nobody learns to look for. Its two reads fail apart: without IGDB the releases say they are
 * missing while the sales, which are ours, still show.
 *
 * Mounted only once `/api/auth/me` has named the reader, which no server render has — what makes reading
 * the reader's clock and locale here safe. The server draws `ReleaseLineSkeleton` in its place (ADR 0074).
 */
export function ReleaseLine({ userId }: { userId: string }) {
    const { today, releases, events } = useReleaseLine(userId);

    const layout = useMemo(
        () => layoutLine(today, releases.data ?? [], events.data),
        [today, releases.data, events.data],
    );
    const agenda = useMemo(() => lineAgenda(layout), [layout]);

    const releaseCount = layout.days.reduce((total, day) => total + day.entries.length, 0);

    let note: string | null = null;
    if (releases.loading) note = 'Looking up what is coming for your games…';
    else if (releases.error !== null) note = 'What is coming for your games could not be loaded just now.';
    else if (releaseCount === 0) note = 'Nothing connected to your games is due in the next two weeks.';

    // The showcases come from IGDB and the sales from us, so a degraded answer still has every sale.
    let eventsNote: string | null = null;
    if (events.error !== null) eventsNote = 'The showcases and sales could not be loaded just now.';
    else if (events.data?.degraded) eventsNote = 'The showcases could not be loaded just now.';

    return (
        <section aria-labelledby="release-line-heading">
            <ReleaseLineHeading />

            <Ruler layout={layout} />

            {agenda.length > 0 && (
                <ol className="release-agenda" aria-label="The next two weeks">
                    {agenda.map(item => item.type === 'event'
                        ? <EventItem key={item.key} event={item.event} today={today} />
                        : <ReleaseAgendaDay key={item.key} day={item.day.day} entries={item.day.entries} today={today} />)}
                </ol>
            )}

            {note !== null && <p className="release-agenda-note">{note}</p>}
            {eventsNote !== null && <p className="release-line-events-note">{eventsNote}</p>}
        </section>
    );
}
