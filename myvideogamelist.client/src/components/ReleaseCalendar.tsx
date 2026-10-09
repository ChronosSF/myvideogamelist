import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ReleaseCard, type CardEntry } from '@/components/ReleaseCard';
import { useReleaseCalendar, type CalendarRead } from '@/hooks/useReleaseCalendar';
import { startTime } from '@/lib/calendarEvents';
import { dayLabel, formatDaySpan } from '@/lib/daySpan';
import {
    calendarMonths,
    layoutMonth,
    monthBands,
    monthName,
    monthTotals,
    undatedBands,
    type CalendarBar,
    type CalendarDay,
    type MonthLayout,
} from '@/lib/releaseCalendar';
import { CURATED_EVENT_KIND_LABELS } from '@/types/calendarAdmin';
import './ReleaseCalendar.css';

/** How many entries a band shows before "Show all": about two rows at full width. */
const SHOWN_AT_FIRST = 12;

function entryKey(entry: CardEntry): string {
    return `${entry.groupName ?? ''}|${entry.releases.map(r => r.gameId).join(',')}`;
}

/** A list of entries that shows the first few and keeps the rest one click away. */
function EntryList({ entries, undated = false, label }: { entries: readonly CardEntry[]; undated?: boolean; label: string }) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? entries : entries.slice(0, SHOWN_AT_FIRST);

    return (
        <>
            <ul className="calendar-entry-list" aria-label={label}>
                {shown.map(entry => (
                    <li key={entryKey(entry)}>
                        <ReleaseCard entry={entry} undated={undated} />
                    </li>
                ))}
            </ul>
            {entries.length > SHOWN_AT_FIRST && (
                <button
                    type="button"
                    className="calendar-more"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(open => !open)}
                >
                    {expanded ? 'Show fewer' : `Show all ${entries.length}`}
                </button>
            )}
        </>
    );
}

interface BandProps {
    /** Unique on the page: the band is named by its heading. */
    id: string;
    label: string;
    /** After the label, quieter: the months a quarter is. */
    detail?: string | null;
    entries: readonly CardEntry[];
    /** Whether IGDB has no date for any of it, which its cards' reasons say (K4). */
    undated?: boolean;
}

/**
 * Entries under a name: in a month, what is known only to its month, quarter or year (K3), never put on a
 * day IGDB has not named; in the undated list, what is announced with no date and is one kind of thing to
 * the user's games — their DLC, say (K4).
 *
 * How many posters it has is how wide it asks to be, which decides whether it shares a row with the band
 * beside it — a sum only the stylesheet can do, since it is about the width of the screen.
 */
function Band({ id, label, detail = null, entries, undated = false }: BandProps) {
    return (
        <section
            className="calendar-band"
            aria-labelledby={id}
            style={{ '--band-entries': entries.length } as React.CSSProperties}
        >
            <h3 id={id} className="calendar-band-label">
                {label}
                {/* The space outside the span: inside it, it is lost from the region's name. */}
                {detail !== null && <> <span className="calendar-band-months">· {detail}</span></>}
            </h3>
            <EntryList entries={entries} undated={undated} label={label} />
        </section>
    );
}

function DayCell({ day, layout, today }: { day: CalendarDay; layout: MonthLayout; today: string }) {
    const label = dayLabel(day.day);
    const week = layout.weeks[day.week];
    const isToday = day.day === today;

    return (
        <li
            className="calendar-day"
            data-today={isToday || undefined}
            data-past={day.day < today || undefined}
            data-has-entries={day.entries.length > 0 || undefined}
            style={{ gridColumn: day.column, gridRow: `${week.row} / span ${week.lanes + 2}` }}
        >
            <p className="calendar-date">
                <time dateTime={day.day}>
                    <span className="sr-only">{isToday ? `Today, ${label.full}` : label.full}</span>
                    {/* A paper calendar's number in the grid. Where the month is a list, a diary's: the
                        number large, with its weekday and month beside it. */}
                    <span aria-hidden="true" className="calendar-date-number">{label.date}</span>
                    <span aria-hidden="true" className="calendar-date-words">
                        <span className="calendar-date-weekday">{isToday ? 'Today' : label.longWeekday}</span>
                        <span className="calendar-date-month">{label.longMonth}</span>
                    </span>
                </time>
            </p>
            {day.entries.length > 0 && (
                <ul className="calendar-day-entries" aria-label={`Due on ${label.full}`}>
                    {day.entries.map(entry => (
                        <li key={entryKey(entry)}>
                            <ReleaseCard entry={entry} />
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

/** "Oct 15", from the string alone. */
function shortDay(day: string): string {
    const { month, date } = dayLabel(day);
    return `${month} ${date}`;
}

/**
 * One week's piece of a sale, a fest or a showcase, as a bar across its days: marked as what it is,
 * with no cover (K2). Only an event's first piece this month is read out, with all of its dates; the
 * rest are drawing, and carry no link, since a link nobody can be told about is one a keyboard should
 * not stop on.
 */
function Bar({ bar, layout }: { bar: CalendarBar; layout: MonthLayout }) {
    const kind = CURATED_EVENT_KIND_LABELS[bar.kind];
    const time = bar.startsAt === null ? null : startTime(bar.startsAt);

    // A showcase says when it starts; a run of days says when it ends, since where the bar starts is
    // either its first day or the edge of the week.
    const detail = time ?? (bar.startsOn === bar.endsOn ? null : `until ${shortDay(bar.endsOn)}`);
    const when = time === null
        ? formatDaySpan(bar.startsOn, bar.endsOn)
        : `${dayLabel(bar.startsOn).full}, ${time}`;

    return (
        <li
            className="calendar-bar"
            data-kind={bar.kind}
            data-first={bar.first || undefined}
            data-continues-before={bar.continuesBefore || undefined}
            data-continues-after={bar.continuesAfter || undefined}
            aria-hidden={bar.first ? undefined : true}
            style={{
                gridColumn: `${bar.columnStart} / ${bar.columnEnd}`,
                gridRow: layout.weeks[bar.week].row + 1 + bar.lane,
            }}
            title={`${kind}: ${bar.name} · ${when}`}
        >
            <span className="calendar-bar-kind">{kind}</span>
            {bar.url !== null && bar.first ? (
                <a className="calendar-bar-name" href={bar.url} target="_blank" rel="noopener noreferrer">
                    {bar.name} <span className="sr-only">(opens in a new tab)</span>
                </a>
            ) : (
                <span className="calendar-bar-name">{bar.name}</span>
            )}
            {detail !== null && <span aria-hidden="true" className="calendar-bar-detail">{detail}</span>}
            <span className="sr-only">, {when}</span>
        </li>
    );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The month as a grid of weeks, Monday first: a cell per day with what releases on it (K2), and the
 * sales and showcases as bars across their days, a piece per week. The days and the bars are two lists
 * laid over the same tracks with `subgrid`, as on the two-week line, so the month reads in day order to
 * whoever cannot see it while the bars still cross the days they cover. Below `md` the same lists are a
 * list of the days that have something on them, under the month's sales and showcases.
 */
function MonthGrid({ month, layout, today }: { month: string; layout: MonthLayout; today: string }) {
    const { name } = monthName(month);

    return (
        <>
            <div className="calendar-weekdays" aria-hidden="true">
                {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid" style={{ gridTemplateRows: layout.rows }}>
                {/* The days of the months either side, so that every week is whole. */}
                <div className="calendar-pads" aria-hidden="true">
                    {layout.pads.map(pad => (
                        <div
                            key={pad.day}
                            className="calendar-pad"
                            style={{
                                gridColumn: pad.column,
                                gridRow: `${layout.weeks[pad.week].row} / span ${layout.weeks[pad.week].lanes + 2}`,
                            }}
                        >
                            {dayLabel(pad.day).date}
                        </div>
                    ))}
                </div>

                <ol className="calendar-days" aria-label={`Days in ${name}`}>
                    {layout.days.map(day => <DayCell key={day.day} day={day} layout={layout} today={today} />)}
                </ol>

                {layout.bars.length > 0 && (
                    <ul className="calendar-bars" aria-label={`Showcases and sales in ${name}`}>
                        {layout.bars.map(bar => <Bar key={bar.pieceKey} bar={bar} layout={layout} />)}
                    </ul>
                )}
            </div>
        </>
    );
}

/** Where a month is: the calendar's own address for the month it opens on, so that it has one. */
function monthHref(months: readonly string[], month: string): string {
    return month === months[0] ? '/calendar' : `/calendar?month=${month}`;
}

/** The calendar's thirteen months, each with how much is on its days, and the way between them (K1). */
function Months({ months, month, totals }: { months: string[]; month: string; totals: Map<string, number> }) {
    return (
        <nav className="calendar-months" aria-label="Months">
            <ol>
                {months.map((m, index) => {
                    const { short, year } = monthName(m);
                    const count = totals.get(m) ?? 0;
                    // The year where the list starts, where a new one begins, and at its end, whose month
                    // has the same name as its first.
                    const showYear = index === 0 || index === months.length - 1 || m.endsWith('-01');

                    return (
                        <li key={m}>
                            <Link
                                to={monthHref(months, m)}
                                preventScrollReset
                                className="calendar-month"
                                aria-current={m === month ? 'page' : undefined}
                            >
                                <span className="calendar-month-name">
                                    {short}
                                    {showYear && <> <span className="calendar-month-year">{year}</span></>}
                                </span>
                                <span className="calendar-month-count">
                                    <span aria-hidden="true">{count === 0 ? '–' : count}</span>
                                    <span className="sr-only">
                                        {count === 0 ? ', nothing on its days' : `, ${count} ${count === 1 ? 'entry' : 'entries'}`}
                                    </span>
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

/** A month either side, or nothing where the calendar ends. */
function Step({ months, to, direction }: { months: readonly string[]; to: string | null; direction: 'previous' | 'next' }) {
    const arrow = direction === 'previous' ? '‹' : '›';
    if (to === null) return <span className="calendar-step" aria-hidden="true" data-off>{arrow}</span>;

    return (
        <Link
            to={monthHref(months, to)}
            preventScrollReset
            className="calendar-step"
            aria-label={`${direction === 'previous' ? 'Previous' : 'Next'} month, ${monthName(to).label}`}
        >
            {arrow}
        </Link>
    );
}

/** A sentence in place of what could not be shown, and a way to ask again. */
function Failure({ read, children }: { read: CalendarRead<unknown>; children: React.ReactNode }) {
    return (
        <p className="calendar-note" role="alert">
            {children}{' '}
            <button type="button" className="calendar-retry" onClick={read.reload}>Try again</button>
        </p>
    );
}

/**
 * The release calendar (`specs/release-timeline-and-calendar.md` §2.2): a month at a time from this one
 * to a year ahead, with what is coming for the user's games on its day, what is known only to the month,
 * the quarter or the year in a band for it, the showcases and sales across their days, and the games
 * announced with no date at all.
 *
 * The month is in the address, `?month=2026-11`, so that a month can be linked to and the back button
 * steps back through them. A month the calendar does not reach opens the first.
 *
 * Mounted only for a signed-in reader, which is learned from a fetch and so never server-rendered —
 * what makes reading the reader's clock and locale here safe.
 */
export function ReleaseCalendar({ userId }: { userId: string }) {
    const { today, releases, events, undated } = useReleaseCalendar(userId);
    const [params] = useSearchParams();

    const months = calendarMonths(today);
    const asked = params.get('month');
    const month = asked !== null && months.includes(asked) ? asked : months[0];
    const index = months.indexOf(month);

    const entries = releases.data;
    const layout = useMemo(() => layoutMonth(month, entries ?? [], events.data), [month, entries, events.data]);
    const bands = useMemo(() => monthBands(month, entries ?? []), [month, entries]);
    const totals = useMemo(() => monthTotals(entries ?? []), [entries]);
    const undatedGroups = useMemo(() => undatedBands(undated.data ?? []), [undated.data]);

    const { label } = monthName(month);
    const onDays = layout.days.reduce((total, day) => total + day.entries.length, 0);

    let note: React.ReactNode = null;
    if (releases.loading) {
        note = <p className="calendar-note" role="status">Looking up what is coming for your games…</p>;
    } else if (releases.error !== null) {
        note = <Failure read={releases}>What is coming for your games could not be loaded just now.</Failure>;
    } else if (onDays === 0 && bands.length === 0) {
        note = <p className="calendar-note">Nothing connected to your games is due in {label}.</p>;
    }

    // The showcases come from IGDB and the sales from us, so a degraded answer still has every sale.
    let eventsNote: React.ReactNode = null;
    if (events.error !== null) {
        eventsNote = <Failure read={events}>The showcases and sales could not be loaded just now.</Failure>;
    } else if (events.data?.degraded) {
        eventsNote = <p className="calendar-note">The showcases could not be loaded just now.</p>;
    }

    const previous = index > 0 ? months[index - 1] : null;
    const next = index < months.length - 1 ? months[index + 1] : null;

    return (
        <div className="calendar">
            <Months months={months} month={month} totals={totals} />

            <section aria-labelledby="calendar-month-heading">
                <div className="calendar-head">
                    <h2 id="calendar-month-heading" className="calendar-month-heading">{label}</h2>
                    <div className="calendar-steps">
                        <Step months={months} to={previous} direction="previous" />
                        <Step months={months} to={next} direction="next" />
                    </div>
                </div>

                {note}
                {eventsNote}

                {/* The grid first, under the month's name: the days are what the calendar is for, and what
                    is known only to a period is the less certain part of the month. */}
                <MonthGrid month={month} layout={layout} today={today} />

                {bands.length > 0 && (
                    <div className="calendar-bands">
                        {/* Keyed by its period, so that a band opened in one month is still open in the next
                            month it is in. */}
                        {bands.map(band => (
                            <Band
                                key={`${band.precision}|${band.starts}`}
                                id={`calendar-band-${band.precision}`}
                                label={band.label}
                                detail={band.months}
                                entries={band.entries}
                            />
                        ))}
                    </div>
                )}
            </section>

            <section className="calendar-undated" aria-labelledby="calendar-undated-heading">
                <h2 id="calendar-undated-heading" className="calendar-section-heading">Announced, no date</h2>
                <p className="calendar-section-lead">Connected to your games, with no date anywhere yet.</p>
                {undated.loading && <p className="calendar-note" role="status">Looking for what is announced…</p>}
                {undated.error !== null && (
                    <Failure read={undated}>What is announced with no date could not be loaded just now.</Failure>
                )}
                {undated.data !== null && undated.data.length === 0 && (
                    <p className="calendar-note">Nothing connected to your games is waiting on a date.</p>
                )}
                {/* In bands for what each is to the user's game, laid out as the month's are: a list with no
                    dates has nothing else to order it by. */}
                {undatedGroups.length > 0 && (
                    <div className="calendar-bands">
                        {undatedGroups.map(band => (
                            <Band
                                key={band.kind}
                                id={`calendar-undated-${band.kind}`}
                                label={band.label}
                                entries={band.entries}
                                undated
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
