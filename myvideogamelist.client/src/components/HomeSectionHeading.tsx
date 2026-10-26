import { Link } from 'react-router';

interface HomeSectionHeadingProps {
    /** The heading's id, which its section is labelled by through `aria-labelledby`. */
    id: string;
    title: string;
    subtitle: string;
    action?: { to: string; label: string };
    /** Less room under it, for the two-week line, whose ruler hangs from the rule. */
    compact?: boolean;
}

/**
 * The heading above one of the shared sections of the home page: a heavy rule, the title set large,
 * and the line about it with the link to where the section goes on, across from it (ADR 0075).
 *
 * Lifted out of `HomePage` so that a section that decides for itself whether it has anything to
 * show — `ShowcasesAndSales`, which is not drawn when nothing is on in the reader's two weeks — can
 * use the same one rather than a copy of its classes, as `SectionHeading` was for the game page.
 */
export function HomeSectionHeading({ id, title, subtitle, action, compact = false }: HomeSectionHeadingProps) {
    return (
        <div className={`rule-heavy pt-4 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 ${compact ? 'mb-4' : 'mb-8'}`}>
            <h2 id={id} className="type-display text-4xl sm:text-5xl text-fg-strong">{title}</h2>

            <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-fg-muted">
                <span>{subtitle}</span>
                {action && (
                    <Link
                        to={action.to}
                        className="shrink-0 font-semibold text-link"
                    >
                        {action.label} <span aria-hidden="true">→</span>
                    </Link>
                )}
            </p>
        </div>
    );
}
