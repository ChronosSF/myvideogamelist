import { Link } from 'react-router';

/**
 * The two-week line's heading and its way to the calendar: the line's own, and its skeleton's while the
 * line cannot be drawn yet, so the two never say different things.
 */
export function ReleaseLineHeading() {
    return (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mt-8 mb-4">
            <div>
                <h2 id="release-line-heading" className="text-lg font-semibold text-fg-strong mb-1">
                    Coming up
                </h2>
                <p className="text-sm text-fg-muted">
                    The next two weeks for your games, with the showcases and sales
                </p>
            </div>

            {/* Always shown, empty line or not (L6): the calendar is where the months after these
                two weeks are, and what is known only to its month or year. */}
            <Link
                to="/calendar"
                className="shrink-0 text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors"
            >
                The whole calendar <span aria-hidden="true">→</span>
            </Link>
        </div>
    );
}
