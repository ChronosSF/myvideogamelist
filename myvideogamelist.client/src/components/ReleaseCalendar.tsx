import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAddToBacklog } from '@/hooks/useAddToBacklog';
import { useFavouriteToggle } from '@/hooks/useFavouriteToggle';
import { useReleaseCalendar, type CalendarRead } from '@/hooks/useReleaseCalendar';
import { startTime } from '@/lib/calendarEvents';
import { dayLabel, formatDaySpan } from '@/lib/daySpan';
import {
    calendarMonths,
    layoutMonth,
    monthBands,
    monthName,
    monthTotals,
    type CalendarBar,
    type CalendarDay,
    type MonthBand,
    type MonthLayout,
} from '@/lib/releaseCalendar';
import { entryReason, platformNames, showsPlatformsApart } from '@/lib/releaseReason';
import { CURATED_EVENT_KIND_LABELS } from '@/types/calendarAdmin';
import type { ConnectedRelease, ReleaseEntry } from '@/types/releases';
import './ReleaseCalendar.css';

/** How many entries a band or the undated list shows before "Show all": two rows at full width. */
const SHOWN_AT_FIRST = 10;

/** One thing the calendar draws: an entry with a date, or one announced with none. */
type Drawn = Pick<ReleaseEntry, 'groupName' | 'releases'>;

function entryKey(entry: Drawn): string {
    return `${entry.groupName ?? ''}|${entry.releases.map(r => r.gameId).join(',')}`;
}

/**
 * IGDB's cover at the size the calendar draws it, which is a thumbnail: the API sends the big one, three
 * times as wide, for the line's cards.
 */
function coverAt(url: string, size: 't_cover_small' | 't_cover_small_2x'): string {
    return url.replace('/t_cover_big/', `/${size}/`);
}

function Thumb({ release }: { release: ConnectedRelease }) {
    const url = release.coverImageUrl;
    return (
        <span className="calendar-thumb">
            {url && (
                <img
                    src={coverAt(url, 't_cover_small')}
                    srcSet={`${coverAt(url, 't_cover_small')} 1x, ${coverAt(url, 't_cover_small_2x')} 2x`}
                    alt=""
                    loading="lazy"
                />
            )}
        </span>
    );
}

/** The rosette the game page marks a favourite with: never a star, which is the user's own score (ADR 0021). */
function Rosette({ filled }: { filled: boolean }) {
    return (
        <svg fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15a6 6 0 100-12 6 6 0 000 12zM8.2 13.7L7 21l5-3 5 3-1.2-7.3"
            />
        </svg>
    );
}

/** Whether a card's reason already says the game is a favourite: "A favourite of yours". */
function reasonSaysFavourite(release: ConnectedRelease): boolean {
    const { reason } = release;
    return reason.relation === 'itself' && reason.membership === 'favourite' && reason.gameId === release.gameId;
}

/**
 * One release on its own: its cover, its name, why it is there (K5), and what can be done with it from
 * here — put it in the Backlog, or make it a favourite.
 */
function ReleaseItem({ entry, release, undated }: { entry: Drawn; release: ConnectedRelease; undated: boolean }) {
    const backlog = useAddToBacklog(release);
    const favourite = useFavouriteToggle(release);

    return (
        <div className="calendar-entry">
            <div className="calendar-entry-art">
                {/* Out of the tab order and hidden from screen readers: the title is the same link. */}
                <Link to={`/games/${release.gameId}`} tabIndex={-1} aria-hidden="true" className="calendar-entry-cover">
                    <Thumb release={release} />
                </Link>
                {(backlog.canAdd || favourite.canToggle) && (
                    // One pill for both, on the cover's foot, rather than a circle each: two circles on a
                    // cover this small would be busier than the cover. Shown as the lists' controls are,
                    // and kept up while a change is on its way.
                    <div
                        className="calendar-entry-actions"
                        data-busy={backlog.pending || (favourite.canToggle && favourite.pending) || undefined}
                    >
                        {backlog.canAdd && (
                            <button
                                type="button"
                                className="calendar-entry-action"
                                disabled={backlog.pending}
                                onClick={backlog.add}
                                // The visible words of the line's button first, for voice control; the
                                // title after, so that a screen reader can tell one card's from the next.
                                aria-label={`Add to ${backlog.backlog}: ${release.title}`}
                                title={`Add to ${backlog.backlog}`}
                            >
                                +
                            </button>
                        )}
                        {favourite.canToggle && (
                            <button
                                type="button"
                                className="calendar-entry-action"
                                data-kind="favourite"
                                disabled={favourite.pending}
                                onClick={favourite.toggle}
                                aria-pressed={favourite.favourite}
                                aria-label={`Favourite: ${release.title}`}
                                title={favourite.favourite ? 'Remove from favourites' : 'Add to favourites'}
                            >
                                <Rosette filled={favourite.favourite} />
                            </button>
                        )}
                    </div>
                )}
            </div>
            <div className="calendar-entry-text">
                <Link to={`/games/${release.gameId}`} className="calendar-entry-title">{release.title}</Link>
                {release.earlyAccess && <p className="calendar-entry-badge">Early access</p>}
                {showsPlatformsApart(release) && (
                    <p className="calendar-entry-platforms">{platformNames(release.platforms)}</p>
                )}
                <p className="calendar-entry-reason">{entryReason(entry, { undated })}</p>
                {backlog.listedIn !== null && <p className="calendar-entry-listed">In {backlog.listedIn}</p>}
                {/* Said in words, as the Backlog is, since the toggle that shows it is up only on hover —
                    except where the reason says it already. */}
                {favourite.favourite && !reasonSaysFavourite(release) && (
                    <p className="calendar-entry-favourite">One of your favourites</p>
                )}
                {backlog.failed && (
                    <p className="calendar-entry-error" role="alert">Could not add it to {backlog.backlog}.</p>
                )}
                {favourite.failed && (
                    <p className="calendar-entry-error" role="alert">Could not change your favourites.</p>
                )}
            </div>
        </div>
    );
}

/** One release in a group's list: its name, where it arrives, and the same two actions, inline. */
function GroupMember({ release }: { release: ConnectedRelease }) {
    const backlog = useAddToBacklog(release);
    const favourite = useFavouriteToggle(release);

    return (
        <li>
            <Link to={`/games/${release.gameId}`}>{release.title}</Link>
            {release.platforms.length > 0 && <span> · {platformNames(release.platforms)}</span>}
            {backlog.canAdd && (
                <button
                    type="button"
                    className="calendar-entry-add-inline"
                    disabled={backlog.pending}
                    onClick={backlog.add}
                    aria-label={`Add to ${backlog.backlog}: ${release.title}`}
                    title={`Add to ${backlog.backlog}`}
                >
                    +
                </button>
            )}
            {favourite.canToggle && (
                <button
                    type="button"
                    className="calendar-entry-add-inline"
                    data-kind="favourite"
                    disabled={favourite.pending}
                    onClick={favourite.toggle}
                    aria-pressed={favourite.favourite}
                    aria-label={`Favourite: ${release.title}`}
                    title={favourite.favourite ? 'Remove from favourites' : 'Add to favourites'}
                >
                    <Rosette filled={favourite.favourite} />
                </button>
            )}
            {backlog.listedIn !== null && <span className="calendar-entry-listed"> · In {backlog.listedIn}</span>}
            {backlog.failed && <span className="calendar-entry-error" role="alert"> · Could not add it.</span>}
            {favourite.failed && (
                <span className="calendar-entry-error" role="alert"> · Could not change your favourites.</span>
            )}
        </li>
    );
}

/**
 * A release, or a group of them (F6): named after its series or its game, with what is in it one click
 * away, as on the line.
 */
function Entry({ entry, undated = false }: { entry: Drawn; undated?: boolean }) {
    const [first] = entry.releases;
    const count = entry.releases.length;

    if (count === 1) return <ReleaseItem entry={entry} release={first} undated={undated} />;

    const cover = entry.releases.find(r => r.coverImageUrl !== null) ?? first;
    return (
        <div className="calendar-entry">
            <div className="calendar-entry-art">
                <span className="calendar-entry-stack">
                    <Thumb release={cover} />
                </span>
            </div>
            <div className="calendar-entry-text">
                <p className="calendar-entry-title">{entry.groupName ?? first.title}</p>
                <p className="calendar-entry-platforms">{count} releases</p>
                <p className="calendar-entry-reason">{entryReason(entry, { undated })}</p>
                <details className="calendar-entry-group">
                    <summary>Show all {count}</summary>
                    <ul>
                        {entry.releases.map(release => <GroupMember key={release.gameId} release={release} />)}
                    </ul>
                </details>
            </div>
        </div>
    );
}

/** A list of entries that shows the first few and keeps the rest one click away. */
function EntryList({ entries, undated = false, label }: { entries: readonly Drawn[]; undated?: boolean; label: string }) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? entries : entries.slice(0, SHOWN_AT_FIRST);

    return (
        <>
            <ul className="calendar-entry-list" aria-label={label}>
                {shown.map(entry => (
                    <li key={entryKey(entry)}>
                        <Entry entry={entry} undated={undated} />
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

/**
 * What is known only to the month, the quarter or the year the month is in (K3): never put on a day IGDB
 * has not named, so a band for the period. Keyed by its period, so that a band opened in one month is
 * still open in the next month it is in.
 */
function Band({ band }: { band: MonthBand }) {
    const id = `calendar-band-${band.precision}`;

    return (
        <section className="calendar-band" data-precision={band.precision} aria-labelledby={id}>
            <h3 id={id} className="calendar-band-label">
                {band.label}
                {/* The space outside the span: inside it, it is lost from the region's name. */}
                {band.months !== null && <> <span className="calendar-band-months">· {band.months}</span></>}
            </h3>
            <EntryList entries={band.entries} label={band.label} />
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
                    {/* A paper calendar's number in the grid; the whole of it where the month is a list. */}
                    <span aria-hidden="true" className="calendar-date-number">{label.date}</span>
                    <span aria-hidden="true" className="calendar-date-full">
                        {isToday ? 'Today' : label.weekday}, {label.month} {label.date}
                    </span>
                </time>
            </p>
            {day.entries.length > 0 && (
                <ul className="calendar-day-entries" aria-label={`Due on ${label.full}`}>
                    {day.entries.map(entry => (
                        <li key={entryKey(entry)}>
                            <Entry entry={entry} />
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
                        {bands.map(band => <Band key={`${band.precision}|${band.starts}`} band={band} />)}
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
                {undated.data !== null && undated.data.length > 0 && (
                    <EntryList entries={undated.data} undated label="Announced, no date" />
                )}
            </section>
        </div>
    );
}
