import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ReleaseAgendaDay } from '@/components/ReleaseAgendaDay';
import { ReleaseAgendaEvent } from '@/components/ReleaseAgendaEvent';
import { ReleaseCard, type CardEntry } from '@/components/ReleaseCard';
import { useReleaseCalendar, type CalendarRead } from '@/hooks/useReleaseCalendar';
import { startTime, type DayEvent } from '@/lib/calendarEvents';
import { dayLabel, daysAway, daysBetween, shortSpan, weekdayAndDay } from '@/lib/daySpan';
import { releaseEntryKey } from '@/lib/releaseCard';
import {
    calendarMonths,
    eventKindsOn,
    layoutMonth,
    monthAgenda,
    monthBands,
    monthName,
    monthTotals,
    undatedBands,
    type CalendarDay,
    type MonthLayout,
} from '@/lib/releaseCalendar';
import './ReleaseAgenda.css';
import './ReleaseCalendar.css';

/** How many entries a band shows before "Show all": about four rows of them at full width. */
const SHOWN_AT_FIRST = 12;

/** A list of entries that shows the first few and keeps the rest one click away. */
function EntryList({ entries, undated = false, label }: { entries: readonly CardEntry[]; undated?: boolean; label: string }) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? entries : entries.slice(0, SHOWN_AT_FIRST);

    return (
        <>
            <ul className="release-agenda-releases" aria-label={label}>
                {shown.map(entry => (
                    <li key={releaseEntryKey(entry)}>
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
    /** Whether IGDB has no date for any of it, which its rows' reasons say (K4). */
    undated?: boolean;
}

/**
 * Entries under a name: in a month, what is known only to its month, quarter or year (K3), never put on a
 * day IGDB has not named; in the undated list, what is announced with no date and is one kind of thing to
 * the user's games — their DLC, say (K4). As rows, as many across as fit (ADR 0075).
 */
function Band({ id, label, detail = null, entries, undated = false }: BandProps) {
    return (
        <section className="calendar-band" aria-labelledby={id}>
            <h3 id={id} className="calendar-band-label">
                {label}
                {/* The space outside the span: inside it, it is lost from the region's name. */}
                {detail !== null && <> <span className="calendar-band-months">· {detail}</span></>}
            </h3>
            <EntryList entries={entries} undated={undated} label={label} />
        </section>
    );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The month as a small paper calendar beside its list (ADR 0075): the days in their weeks, Monday first,
 * with a dot under a day something releases on and a rule of its kind's colour under each day of a sale,
 * a fest or a showcase. A picture of the list beside it, which says all of it in words, so hidden from
 * assistive technology.
 */
function MonthIndex({ layout, today }: { layout: MonthLayout; today: string }) {
    return (
        <div className="calendar-index" aria-hidden="true">
            <div className="calendar-index-weekdays">
                {WEEKDAYS.map((day, index) => <span key={index}>{day}</span>)}
            </div>
            <div className="calendar-index-days">
                {layout.pads.map(pad => (
                    <span
                        key={pad.day}
                        className="calendar-index-day"
                        data-pad
                        style={{ gridColumn: pad.column, gridRow: pad.week + 1 }}
                    >
                        {dayLabel(pad.day).date}
                    </span>
                ))}
                {layout.days.map(day => <IndexDay key={day.day} day={day} layout={layout} today={today} />)}
            </div>
        </div>
    );
}

function IndexDay({ day, layout, today }: { day: CalendarDay; layout: MonthLayout; today: string }) {
    const kinds = eventKindsOn(day.day, layout);

    return (
        <span
            className="calendar-index-day"
            data-today={day.day === today || undefined}
            data-past={day.day < today || undefined}
            style={{ gridColumn: day.column, gridRow: day.week + 1 }}
        >
            {dayLabel(day.day).date}
            {day.entries.length > 0 && <span className="calendar-index-dot" />}
            {kinds.length > 0 && (
                <span className="calendar-index-marks">
                    {kinds.map((kind, index) => <span key={index} className="calendar-index-mark" data-kind={kind} />)}
                </span>
            )}
        </span>
    );
}

/** The index's key: what its marks are. */
function IndexKey() {
    return (
        <p className="calendar-key" aria-hidden="true">
            <span><span className="calendar-key-mark" data-kind="sale" />Sale</span>
            <span><span className="calendar-key-mark" data-kind="fest" />Fest</span>
            <span><span className="calendar-key-mark" data-kind="showcase" />Showcase</span>
            <span><span className="calendar-key-dot" />Release</span>
        </p>
    );
}

/**
 * A sale, a fest or a showcase in the month's list, once, with all of its dates (K2): its days, and whether
 * it has ended, is on now or is still to come; a showcase, its time on the reader's clock.
 */
function EventItem({ event, today }: { event: DayEvent; today: string }) {
    const time = event.startsAt === null ? null : startTime(event.startsAt);
    const label = event.startsOn === event.endsOn ? weekdayAndDay(event.startsOn) : shortSpan(event.startsOn, event.endsOn);
    const ended = time === null && event.endsOn < today;
    const on = time === null && !ended && event.startsOn <= today;

    let detail: string;
    if (time !== null) detail = time;
    else if (ended) detail = 'Ended';
    else if (on) detail = 'On now';
    else detail = daysAway(daysBetween(today, event.startsOn));

    return <ReleaseAgendaEvent event={event} label={label} detail={detail} on={on ? 'detail' : undefined} past={ended} />;
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
        <p className="release-agenda-note" role="alert">
            {children}{' '}
            <button type="button" className="calendar-retry" onClick={read.reload}>Try again</button>
        </p>
    );
}

/**
 * The release calendar (`specs/release-timeline-and-calendar.md` §2.2): a month at a time from this one
 * to a year ahead, as a small index of its days beside the list of what is on them — the showcases and
 * sales once each, and the releases under their day — then what is known only to the month, the quarter or
 * the year in a band for it, and the games announced with no date at all (ADR 0075).
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
    const agenda = useMemo(() => monthAgenda(month, layout), [month, layout]);
    const bands = useMemo(() => monthBands(month, entries ?? []), [month, entries]);
    const totals = useMemo(() => monthTotals(entries ?? []), [entries]);
    const undatedGroups = useMemo(() => undatedBands(undated.data ?? []), [undated.data]);

    const { label, name, year } = monthName(month);
    const onDays = layout.days.reduce((total, day) => total + day.entries.length, 0);

    let note: React.ReactNode = null;
    if (releases.loading) {
        note = <p className="release-agenda-note" role="status">Looking up what is coming for your games…</p>;
    } else if (releases.error !== null) {
        note = <Failure read={releases}>What is coming for your games could not be loaded just now.</Failure>;
    } else if (onDays === 0 && bands.length === 0) {
        note = <p className="release-agenda-note">Nothing connected to your games is due in {label}.</p>;
    }

    // The showcases come from IGDB and the sales from us, so a degraded answer still has every sale. Asking
    // again is worth offering for either: the server keeps IGDB's events only when IGDB answers.
    let eventsNote: React.ReactNode = null;
    if (events.error !== null) {
        eventsNote = <Failure read={events}>The showcases and sales could not be loaded just now.</Failure>;
    } else if (events.data?.degraded) {
        eventsNote = <Failure read={events}>The showcases could not be loaded just now.</Failure>;
    }

    const previous = index > 0 ? months[index - 1] : null;
    const next = index < months.length - 1 ? months[index + 1] : null;

    return (
        <div className="calendar">
            <Months months={months} month={month} totals={totals} />

            <section className="calendar-sheet" aria-labelledby="calendar-month-heading">
                {/* The month at a glance, and beside it the month in words: the index is the paper
                    calendar's grid, the list is where each thing is read and linked (ADR 0075). */}
                <div className="calendar-month-glance">
                    <div className="calendar-head">
                        <h2 id="calendar-month-heading" className="calendar-month-heading">
                            {/* The space outside the span: inside it, it is lost from the heading's name. */}
                            {name} <span className="calendar-month-heading-year">{year}</span>
                        </h2>
                        <div className="calendar-steps">
                            <Step months={months} to={previous} direction="previous" />
                            <Step months={months} to={next} direction="next" />
                        </div>
                    </div>
                    <MonthIndex layout={layout} today={today} />
                    <IndexKey />
                </div>

                <div className="calendar-month-words">
                    {note}
                    {eventsNote}

                    {agenda.length > 0 && (
                        <ol className="release-agenda" aria-label={`What is on in ${name}`}>
                            {agenda.map(item => item.type === 'event'
                                ? <EventItem key={item.key} event={item.event} today={today} />
                                : <ReleaseAgendaDay key={item.key} day={item.day.day} entries={item.day.entries} today={today} />)}
                        </ol>
                    )}

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
                </div>
            </section>

            <section className="calendar-undated" aria-labelledby="calendar-undated-heading">
                <h2 id="calendar-undated-heading" className="calendar-section-heading">Announced, no date</h2>
                <p className="calendar-section-lead">Connected to your games, with no date anywhere yet.</p>
                {undated.loading && <p className="release-agenda-note" role="status">Looking for what is announced…</p>}
                {undated.error !== null && (
                    <Failure read={undated}>What is announced with no date could not be loaded just now.</Failure>
                )}
                {undated.data !== null && undated.data.length === 0 && (
                    <p className="release-agenda-note">Nothing connected to your games is waiting on a date.</p>
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
