import { Link } from 'react-router';

interface HomeSectionHeadingProps {
    /** The heading's id, which its section is labelled by through `aria-labelledby`. */
    id: string;
    title: string;
    subtitle: string;
    action?: { to: string; label: string };
}

/**
 * The heading above one of the shared sections of the home page: a title, a line under it, and
 * optionally a link to where the section goes on.
 *
 * Lifted out of `HomePage` so that a section that decides for itself whether it has anything to
 * show — `ShowcasesAndSales`, which is not drawn when nothing is on in the reader's two weeks — can
 * use the same one rather than a copy of its classes, as `SectionHeading` was for the game page.
 */
export function HomeSectionHeading({ id, title, subtitle, action }: HomeSectionHeadingProps) {
    return (
        <div className="flex items-end justify-between gap-4 mb-5">
            <div>
                <h2 id={id} className="text-xl sm:text-2xl font-bold text-fg-strong">{title}</h2>
                <p className="text-sm text-fg-muted mt-1">{subtitle}</p>
            </div>

            {action && (
                <Link
                    to={action.to}
                    className="shrink-0 text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors"
                >
                    {action.label} <span aria-hidden="true">→</span>
                </Link>
            )}
        </div>
    );
}
