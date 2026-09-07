import type { ActivityMonth } from '@/types/stats';
import { formatMonth, isYearStart } from '@/lib/stats';

const SERIES = [
    { key: 'started', label: 'Started', className: 'started' },
    { key: 'finished', label: 'Finished', className: 'finished' },
    { key: 'dropped', label: 'Dropped', className: 'dropped' },
] as const;

/**
 * Games started, finished and dropped per month.
 *
 * All three, rather than the two that make the neater chart, because the question it answers is
 * whether the user finishes what they start — and dropping a game is one of the two ways of
 * answering it. Leaving it out would make a month of clearing the backlog by abandoning it look
 * like a month of doing nothing.
 *
 * The months come from the server already trimmed to where the event log begins, so an empty
 * column here means a quiet month rather than one that predates any records.
 */
export function ActivityChart({ months }: { months: ActivityMonth[] }) {
    const tallest = Math.max(
        1,
        ...months.map(month => Math.max(month.started, month.finished, month.dropped)),
    );

    const anything = months.some(m => m.started + m.finished + m.dropped > 0);

    return (
        <div>
            <ul className="profile-legend">
                {SERIES.map(series => (
                    <li key={series.key}>
                        <span className={`profile-swatch ${series.className}`} aria-hidden="true" />
                        {series.label}
                    </li>
                ))}
            </ul>

            {/* Scrolls rather than compressing: twelve months of three bars each has a width below
                which the bars stop being readable, and a squashed chart is worse than a scrolled one. */}
            <div className="profile-chart-scroll">
                <ol className="profile-chart" aria-label="Games started, finished and dropped each month">
                    {months.map(month => (
                        <li key={month.month} className="profile-chart-month">
                            <div className="profile-chart-bars" aria-hidden="true">
                                {SERIES.map(series => {
                                    const count = month[series.key];
                                    const height = count === 0 ? 0 : Math.max(6, (count / tallest) * 100);
                                    return (
                                        <span
                                            key={series.key}
                                            className={`profile-chart-bar ${series.className}`}
                                            style={{ height: `${height}%` }}
                                        />
                                    );
                                })}
                            </div>
                            <span className="profile-chart-tick" aria-hidden="true">
                                {formatMonth(month.month)}
                                {/* The year only where it changes, so twelve labels do not repeat it. */}
                                {isYearStart(month.month) && (
                                    <span className="profile-chart-year">{month.month.slice(0, 4)}</span>
                                )}
                            </span>
                            <span className="sr-only">
                                {`${month.month}: started ${month.started}, finished ${month.finished}, dropped ${month.dropped}`}
                            </span>
                        </li>
                    ))}
                </ol>
            </div>

            {!anything && (
                <p className="profile-caption">
                    Nothing moved between lists in these months.
                </p>
            )}
        </div>
    );
}
