import { useMemo } from 'react';
import { CoverImage } from '@/components/CoverImage';
import { ReleaseCard } from '@/components/ReleaseCard';
import { ReleaseLineHeading } from '@/components/ReleaseLineHeading';
import { useReleaseLine } from '@/hooks/useReleaseLine';
import { startTime } from '@/lib/calendarEvents';
import { dayLabel, formatDaySpan } from '@/lib/daySpan';
import { LINE_COLUMNS, layoutLine, lineAgenda, type LineDay, type LineEvent, type LineLayout } from '@/lib/releaseLine';
import { CURATED_EVENT_KIND_LABELS, storeLabel } from '@/types/calendarAdmin';
import './ReleaseAgenda.css';
import './ReleaseLine.css';

/** A cover in the list is drawn across `ReleaseCard`'s row column, 3.5rem, less its border. */
const ROW_COVER_SIZES = 'calc(3.5rem - 2px)';

/** A mark on the ruler is at most 2.25rem wide, and a day's column on a phone is narrower than that. */
const MARK_SIZES = '2.25rem';

/** "Thu, Nov 5", from the string alone. */
function shortDate(day: string): string {
    const { weekday, month, date } = dayLabel(day);
    return `${weekday}, ${month} ${date}`;
}

/** How far a day is from today, in words: "Today", "Tomorrow", "In 10 days". */
function fromToday(index: number): string {
    if (index === 0) return 'Today';
    if (index === 1) return 'Tomorrow';
    return `In ${index} days`;
}

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
                    data-continues-before={event.continuesBefore || undefined}
                    data-continues-after={event.continuesAfter || undefined}
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
                            {cover !== null && <CoverImage url={cover} alt="" sizes={MARK_SIZES} eager />}
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

/** A sale, a fest or a showcase in the list: when, what it is, and its name, linked where it is announced. */
function EventItem({ event, today }: { event: LineEvent; today: string }) {
    const kind = CURATED_EVENT_KIND_LABELS[event.kind];
    const time = event.startsAt === null ? null : startTime(event.startsAt);

    // A sale or a fest running today is on now, and says until when; one to come says the day it starts and
    // its end. A showcase is an hour rather than a run of days, so it says its day and its time on the
    // reader's clock, today included.
    const oneDay = event.startsOn === event.endsOn;
    const on = time === null && event.first === 0;
    let label: string;
    let detail: string;
    if (time !== null) {
        label = event.first === 0 ? 'Today' : shortDate(event.startsOn);
        detail = time;
    } else if (on) {
        label = 'On now';
        detail = oneDay || event.endsOn === today ? 'Today only' : `until ${shortDate(event.endsOn)}`;
    } else {
        label = shortDate(event.startsOn);
        detail = oneDay ? fromToday(event.first) : `until ${shortDate(event.endsOn)}`;
    }

    const when = time === null ? formatDaySpan(event.startsOn, event.endsOn) : `${dayLabel(event.startsOn).full}, ${time}`;

    return (
        <li className="release-agenda-item" data-kind={event.kind}>
            <p className="release-agenda-when">
                <span className="release-agenda-day" data-on={on || undefined}>{label}</span>
                <span className="release-agenda-detail">{detail}</span>
            </p>
            <div className="release-agenda-body">
                <p className="release-agenda-kind">
                    {kind}
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

/** A day with something releasing on it: the day, and each release as a row, saying why it is there (L4). */
function DayItem({ day }: { day: LineDay }) {
    return (
        <li className="release-agenda-item">
            <p className="release-agenda-when">
                <time dateTime={day.day}>
                    <span className="release-agenda-day">{shortDate(day.day)}</span>
                </time>
                <span className="release-agenda-detail">{fromToday(day.index)}</span>
            </p>
            <div className="release-agenda-body release-agenda-releases">
                {day.entries.map(entry => (
                    <ReleaseCard
                        key={`${entry.groupName ?? ''}|${entry.releases.map(r => r.gameId).join(',')}`}
                        entry={entry}
                        layout="row"
                        sizes={ROW_COVER_SIZES}
                        eager
                    />
                ))}
            </div>
        </li>
    );
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
                        : <DayItem key={item.key} day={item.day} />)}
                </ol>
            )}

            {note !== null && <p className="release-line-note">{note}</p>}
            {eventsNote !== null && <p className="release-line-events-note">{eventsNote}</p>}
        </section>
    );
}
