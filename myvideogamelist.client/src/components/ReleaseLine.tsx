import { useMemo } from 'react';
import { Link } from 'react-router';
import { useReleaseLine } from '@/hooks/useReleaseLine';
import { dayLabel, formatDaySpan } from '@/lib/daySpan';
import { layoutLine, type LineDay, type LineEvent } from '@/lib/releaseLine';
import { entryReason, platformNames, showsPlatformsApart } from '@/lib/releaseReason';
import { CURATED_EVENT_KIND_LABELS } from '@/types/calendarAdmin';
import type { ConnectedRelease, ReleaseEntry } from '@/types/releases';
import './ReleaseLine.css';

/**
 * A showcase's start on the reader's clock, in their own locale — "9:00 PM", "21:00". Safe only
 * because the line is never server-rendered (see `useReleaseLine`): on the server it would format in
 * Node's locale and timezone, and the page would not hydrate.
 */
function startTime(startsAt: string): string {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(startsAt));
}

function Cover({ release, eager }: { release: ConnectedRelease; eager: boolean }) {
    return (
        <div className="release-line-cover">
            {release.coverImageUrl && (
                <img src={release.coverImageUrl} alt="" loading={eager ? 'eager' : 'lazy'} />
            )}
        </div>
    );
}

/** One release, or a group of them (F6), on its day: a cover, a name, and why it is there (L4, L5). */
function EntryCard({ entry, eager }: { entry: ReleaseEntry; eager: boolean }) {
    const [first] = entry.releases;
    const count = entry.releases.length;

    if (count === 1) {
        return (
            <div className="release-line-card">
                <Link to={`/games/${first.gameId}`} className="release-line-link">
                    <Cover release={first} eager={eager} />
                    <p className="release-line-title">{first.title}</p>
                </Link>
                {first.earlyAccess && <p className="release-line-badge">Early access</p>}
                {showsPlatformsApart(first) && (
                    <p className="release-line-platforms">{platformNames(first.platforms)}</p>
                )}
                <p className="release-line-reason">{entryReason(entry)}</p>
            </div>
        );
    }

    // A group is named after its series or its game and shown with its first cover; what is in it is
    // one click away rather than eight covers wide.
    const cover = entry.releases.find(r => r.coverImageUrl !== null) ?? first;
    return (
        <div className="release-line-card">
            <div className="release-line-stack">
                <Cover release={cover} eager={eager} />
            </div>
            <p className="release-line-title">{entry.groupName ?? first.title}</p>
            <p className="release-line-count">{count} releases</p>
            <p className="release-line-reason">{entryReason(entry)}</p>
            <details className="release-line-group">
                <summary>Show all {count}</summary>
                <ul>
                    {entry.releases.map(release => (
                        <li key={release.gameId}>
                            <Link to={`/games/${release.gameId}`}>{release.title}</Link>
                            {release.platforms.length > 0 && <span> · {platformNames(release.platforms)}</span>}
                        </li>
                    ))}
                </ul>
            </details>
        </div>
    );
}

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
                <EntryCard
                    key={`${entry.groupName ?? ''}|${entry.releases.map(r => r.gameId).join(',')}`}
                    entry={entry}
                    eager={eager}
                />
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
            <h2 id="release-line-heading" className="text-lg font-semibold text-white light:text-slate-900 mt-8 mb-1">
                Coming up
            </h2>
            <p className="text-sm text-slate-400 light:text-slate-600 mb-4">
                The next two weeks for your games, with the showcases and sales
            </p>

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
