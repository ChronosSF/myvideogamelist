import { ReleaseCard, type CardEntry } from '@/components/ReleaseCard';
import { dayLabel, daysAway, daysBetween, weekdayAndDay } from '@/lib/daySpan';
import { releaseEntryKey } from '@/lib/releaseCard';
import './ReleaseAgenda.css';

interface ReleaseAgendaDayProps {
    /** `YYYY-MM-DD`. */
    day: string;
    /** What releases that day, each saying why it is there. */
    entries: readonly CardEntry[];
    /** `YYYY-MM-DD`, on the reader's own calendar: what decides "Tomorrow", "In 4 days" or out already. */
    today: string;
}

/**
 * A day with something releasing on it, in a list of what is on (ADR 0075): the day and how far off it is,
 * then its releases as `ReleaseCard` rows, each with why it is there (L4, K5) — the same on the two-week
 * line and the calendar. The releases are a list of their own, named by the whole date, so a screen reader
 * hears which day they are due on.
 */
export function ReleaseAgendaDay({ day, entries, today }: ReleaseAgendaDayProps) {
    const label = dayLabel(day);
    const away = daysBetween(today, day);

    return (
        <li className="release-agenda-item" data-past={away < 0 || undefined}>
            <p className="release-agenda-when">
                <time dateTime={day} className="release-agenda-day" data-on={away === 0 || undefined}>
                    <span className="sr-only">{away === 0 ? `Today, ${label.full}` : label.full}</span>
                    <span aria-hidden="true">{weekdayAndDay(day)}</span>
                </time>
                <span className="release-agenda-detail">{away < 0 ? 'Already out' : daysAway(away)}</span>
            </p>
            <ul className="release-agenda-body release-agenda-releases" aria-label={`Due on ${label.full}`}>
                {entries.map(entry => (
                    <li key={releaseEntryKey(entry)}>
                        <ReleaseCard entry={entry} />
                    </li>
                ))}
            </ul>
        </li>
    );
}
