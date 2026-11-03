import { startTime, type DayEvent } from '@/lib/calendarEvents';
import { daysBetween, localToday } from '@/lib/daySpan';
import { eventWhen, panelEvents } from '@/lib/showcasesAndSales';
import { useHydrated } from '@/lib/useHydrated';
import { CURATED_EVENT_KIND_LABELS, storeLabel } from '@/types/calendarAdmin';
import type { CalendarEvents } from '@/types/releases';
import './ShowcasesAndSales.css';

function EventCard({ event, today, hydrated }: { event: DayEvent; today: string; hydrated: boolean }) {
    const when = eventWhen(today, event);

    // A showcase's start on the reader's own clock (E4), once there is a reader's clock to read, and
    // only while it is still to come: for a show already running the countdown has said enough.
    const startsAt = hydrated && daysBetween(today, event.startsOn) >= 0 ? event.startsAt : null;
    const time = startsAt === null ? null : startTime(startsAt);

    const days = [when.days, time].filter(part => part !== null).join(', ');

    // The instant once the time is shown, and otherwise the one day the words name, if they name one.
    const dateTime = startsAt ?? when.dateTime;

    return (
        <li className="showcases-item" data-kind={event.kind}>
            <p className="showcases-kind">
                {CURATED_EVENT_KIND_LABELS[event.kind]}
                {event.store !== null && (
                    <>
                        <span aria-hidden="true"> · </span>
                        <span className="sr-only">, </span>
                        {storeLabel(event.store)}
                    </>
                )}
            </p>

            {event.url === null ? (
                <p className="showcases-name">{event.name}</p>
            ) : (
                <a className="showcases-name" href={event.url} target="_blank" rel="noopener noreferrer">
                    {event.name} <span className="sr-only">(opens in a new tab)</span>
                </a>
            )}

            <p className="showcases-when">
                <span className="showcases-countdown">{when.countdown}</span>
                {days !== '' && (
                    <>
                        <span aria-hidden="true"> · </span>
                        <span className="sr-only">, </span>
                        {dateTime === null ? <span>{days}</span> : <time dateTime={dateTime}>{days}</time>}
                    </>
                )}
            </p>
        </li>
    );
}

/**
 * The showcases and sales of the next two weeks, for everybody the two-week line does not show them to
 * (`specs/release-timeline-and-calendar.md` §2.3) — "Summer Game Fest starts in 2 days". The line's
 * events on their own: the same two weeks, the same sources, counted down rather than laid on days.
 *
 * Server-rendered from the shared `/api/home`, so it has to be one render for every reader until the
 * page hydrates. Until then its days are UTC's, the day the loader ran on, and a showcase gives no
 * time; once hydrated they are the reader's own, and so is the clock a showcase's start is read on.
 * The two differ for hours of every day somewhere — an evening in the Americas, a morning in Asia — and
 * then the countdowns change as the page hydrates, and an event at either edge of the two weeks comes
 * or goes: the reader's fortnight starts a day before or after UTC's. Nothing the server renders can
 * know which, and drawing the panel only in the browser would move the page for every reader instead.
 *
 * Not drawn when nothing is on, like the panels below it, and silent about what failed: when IGDB could
 * not be asked it shows the sales it has, as the page shows the covers it has without the news.
 *
 * A strip between rules rather than a section of its own (ADR 0075): two weeks of shows and sales is a line
 * of news under the welcome, and set as large as Coming soon it read as the page's main business.
 *
 * @param today The day the loader ran on, in UTC, which stands in for the reader's until hydration.
 */
export function ShowcasesAndSales({ events, today }: { events: CalendarEvents; today: string }) {
    const hydrated = useHydrated();
    const day = hydrated ? localToday() : today;
    const shown = panelEvents(day, events, hydrated ? 'local' : 'utc');

    if (shown.length === 0) return null;

    return (
        <section className="showcases" aria-labelledby="showcases-heading">
            <div className="showcases-heading">
                <h2 id="showcases-heading" className="showcases-title">Showcases and sales</h2>
                <p className="showcases-subtitle">The big shows and the store-wide sales in the next two weeks</p>
            </div>

            <ul className="showcases-list">
                {shown.map(event => <EventCard key={event.key} event={event} today={day} hydrated={hydrated} />)}
            </ul>
        </section>
    );
}
