import { useMemo } from 'react';
import { Link } from 'react-router';
import { ReleaseCard } from '@/components/ReleaseCard';
import { useReleaseLine } from '@/hooks/useReleaseLine';
import { startTime } from '@/lib/calendarEvents';
import { dayLabel, formatDaySpan } from '@/lib/daySpan';
import { layoutLine, type LineDay, type LineEvent } from '@/lib/releaseLine';
import { CURATED_EVENT_KIND_LABELS } from '@/types/calendarAdmin';
import './ReleaseLine.css';

function DayColumn({ day, isToday, eager }: { day: LineDay; isToday: boolean; eager: boolean }) {
    const label = dayLabel(day.day);

    // The month where the line starts and where a new one begins; the day's number is enough between.
    const date = isToday || label.date === 1 ? `${label.month} ${label.date}` : String(label.date);

    return (
        <li
            className="release-line-day"
            data-today={isToday || undefined}
            style={{ gridColumn: `${day.column} / span ${day.span}` }}
        >
            <p className="release-line-date">
                <time dateTime={day.day}>
                    <span className="sr-only">{isToday ? `Today, ${label.full}` : label.full}</span>
                    <span aria-hidden="true" className="release-line-weekday">{isToday ? 'Today' : label.weekday}</span>
                    <span aria-hidden="true">{date}</span>
                </time>
            </p>
            {day.entries.map(entry => (
                <div key={`${entry.groupName ?? ''}|${entry.releases.map(r => r.gameId).join(',')}`} className="release-line-card">
                    <ReleaseCard entry={entry} eager={eager} />
                </div>
            ))}
        </li>
    );
}

/** "Oct 15", from the string alone. */
function shortDay(day: string): string {
    const { month, date } = dayLabel(day);
    return `${month} ${date}`;
}

/**
 * A sale, a fest or a showcase, as a bar across its days: marked as what it is, with no cover (L3).
 *
 * Two lines, the name on its own: a one-day showcase is one column wide, and on one line with its
 * kind and its time the name was the part that gave way.
 */
function EventBar({ event }: { event: LineEvent }) {
    const kind = CURATED_EVENT_KIND_LABELS[event.kind];
    const time = event.startsAt === null ? null : startTime(event.startsAt);

    // A showcase says when it starts; a run of days says when it ends, since where the bar starts is
    // either its first day or the line's edge.
    const detail = time ?? (event.startsOn === event.endsOn ? null : `until ${shortDay(event.endsOn)}`);
    const when = time === null
        ? formatDaySpan(event.startsOn, event.endsOn)
        : `${dayLabel(event.startsOn).full}, ${time}`;

    return (
        <li
            className="release-line-event"
            data-kind={event.kind}
            data-continues-before={event.continuesBefore || undefined}
            data-continues-after={event.continuesAfter || undefined}
            style={{ gridColumn: `${event.columnStart} / ${event.columnEnd}`, gridRow: event.lane + 1 }}
            title={`${kind}: ${event.name} · ${when}`}
        >
            <span className="release-line-event-kind">{kind}</span>
            {event.url === null ? (
                <span className="release-line-event-name">{event.name}</span>
            ) : (
                <a className="release-line-event-name" href={event.url} target="_blank" rel="noopener noreferrer">
                    {event.name} <span className="sr-only">(opens in a new tab)</span>
                </a>
            )}
            {detail !== null && <span aria-hidden="true" className="release-line-event-detail">{detail}</span>}
            <span className="sr-only">, {when}</span>
        </li>
    );
}

/**
 * The two-week line (`specs/release-timeline-and-calendar.md` §2.1): today and the next thirteen
 * days, with what is coming for the user's own games on its day and the showcases and sales across
 * theirs. It replaces the Releasing soon rail, which covered the wishlist and the backlog only.
 *
 * Always there, empty or not, with a sentence when nothing is due (L7) — a section that comes and goes
 * is one nobody learns to look for. Its two reads fail apart: without IGDB the releases say they are
 * missing while the sales, which are ours, still show.
 *
 * A CSS grid with a column per release and a narrow one for a day with nothing on it. The days and
 * the bars are each a list, laid over the same tracks with `subgrid`, so that the page reads in day
 * order to whoever cannot see it while the bars still cross the days they cover.
 *
 * Mounted only in the signed-in hero, which never server-renders — what makes reading the reader's
 * clock and locale here safe.
 */
export function ReleaseLine({ userId }: { userId: string }) {
    const { today, releases, events } = useReleaseLine(userId);

    const layout = useMemo(
        () => layoutLine(today, releases.data ?? [], events.data),
        [today, releases.data, events.data],
    );

    const rows = ['auto', ...Array.from({ length: layout.lanes }, () => 'auto'), 'minmax(3rem, auto)'].join(' ');
    const releaseCount = layout.days.reduce((total, day) => total + day.entries.length, 0);

    let note: string | null = null;
    if (releases.loading) note = 'Looking up what is coming for your games…';
    else if (releases.error !== null) note = 'What is coming for your games could not be loaded just now.';
    else if (releaseCount === 0) note = 'Nothing connected to your games is due in the next two weeks.';

    // The showcases come from IGDB and the sales from us, so a degraded answer still has every sale.
    let eventsNote: string | null = null;
    if (events.error !== null) eventsNote = 'The showcases and sales could not be loaded just now.';
    else if (events.data?.degraded) eventsNote = 'The showcases could not be loaded just now.';

    // Covers load eagerly in the first week, which is what is in view before any scrolling.
    const eagerDays = 7;

    return (
        <section aria-labelledby="release-line-heading">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mt-8 mb-4">
                <div>
                    <h2 id="release-line-heading" className="text-lg font-semibold text-white light:text-slate-900 mb-1">
                        Coming up
                    </h2>
                    <p className="text-sm text-slate-400 light:text-slate-600">
                        The next two weeks for your games, with the showcases and sales
                    </p>
                </div>

                {/* Always shown, empty line or not (L6): the calendar is where the months after these
                    two weeks are, and what is known only to its month or year. */}
                <Link
                    to="/calendar"
                    className="shrink-0 text-sm font-medium text-blue-400 light:text-blue-600 hover:text-blue-300 light:hover:text-blue-700 transition-colors"
                >
                    The whole calendar <span aria-hidden="true">→</span>
                </Link>
            </div>

            <div
                className="release-line-scroll"
                // Scrolls on its own, so it is a named, focusable region rather than an overflow
                // container a keyboard user cannot reach — as the rails on this page are.
                tabIndex={0}
                role="region"
                aria-label="The next two weeks"
            >
                <div className="release-line" style={{ gridTemplateColumns: layout.columns, gridTemplateRows: rows }}>
                    <ol className="release-line-days" aria-label="Days">
                        {layout.days.map((day, index) => (
                            <DayColumn key={day.day} day={day} isToday={index === 0} eager={index < eagerDays} />
                        ))}
                    </ol>

                    {layout.events.length > 0 && (
                        <ul
                            className="release-line-events"
                            aria-label="Showcases and sales"
                            style={{ gridRow: `2 / span ${layout.lanes}` }}
                        >
                            {layout.events.map(event => <EventBar key={event.key} event={event} />)}
                        </ul>
                    )}

                    {note !== null && <p className="release-line-note">{note}</p>}
                </div>
            </div>

            {eventsNote !== null && <p className="release-line-events-note">{eventsNote}</p>}
        </section>
    );
}
