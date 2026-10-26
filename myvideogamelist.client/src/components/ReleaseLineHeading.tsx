import { Link } from 'react-router';

/**
 * The two-week line's heading and its way to the calendar: the line's own, and its skeleton's while the
 * line cannot be drawn yet, so the two never say different things. Set as the home page's other sections
 * are (`HomeSectionHeading`), with the heavy rule the ruler hangs from.
 */
export function ReleaseLineHeading() {
    return (
        <div className="border-t-2 border-fg-strong pt-4 mb-4 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <h2 id="release-line-heading" className="type-display text-4xl sm:text-5xl text-fg-strong">
                Coming up
            </h2>

            <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-fg-muted">
                <span>The next two weeks for your games, with the showcases and sales</span>
                {/* Always shown, empty line or not (L6): the calendar is where the months after these
                    two weeks are, and what is known only to its month or year. */}
                <Link
                    to="/calendar"
                    className="shrink-0 font-semibold text-fg-strong underline decoration-line-strong underline-offset-4 hover:decoration-fg-strong transition-colors"
                >
                    The whole calendar <span aria-hidden="true">→</span>
                </Link>
            </p>
        </div>
    );
}
