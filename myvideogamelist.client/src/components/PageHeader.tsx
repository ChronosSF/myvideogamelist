import type { ReactNode } from 'react';

/** Written out whole, so that Tailwind finds each class in the source. */
const WIDTHS = {
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
} as const;

interface PageHeaderProps {
    title: ReactNode;
    description?: ReactNode;
    /** The small capitals over the title, naming the part of the site the page is in: "Your lists". */
    kicker?: ReactNode;
    /** The width of the page's own content, so that the title lines up with what is under it. */
    width?: keyof typeof WIDTHS;
    /** Smaller, for a page that is a step in something rather than a place: an import's review. */
    compact?: boolean;
    /** Anything else the header holds: a search box, a row of tabs, a second line. */
    children?: ReactNode;
}

/**
 * The top of a page: its name set large in the display type, a line about it, and whatever the page
 * puts under them. No band or tint behind it (ADR 0075): the title is the masthead, and what follows
 * opens with a rule of its own. One component in place of the nine copies of its classes there were.
 */
export function PageHeader({ title, description, kicker, width = '7xl', compact = false, children }: PageHeaderProps) {
    return (
        <div className={`${WIDTHS[width]} mx-auto px-4 sm:px-6 lg:px-8 ${compact ? 'pt-8 pb-6' : 'pt-10 sm:pt-14 pb-8'}`}>
            {kicker !== undefined && <p className="type-kicker text-fg-muted mb-3">{kicker}</p>}
            <h1 className={`type-display text-fg-strong text-balance ${compact ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-6xl'}`}>
                {title}
            </h1>
            {description !== undefined && (
                <p className={`mt-3 max-w-2xl text-fg-muted ${compact ? 'text-sm' : 'text-base'}`}>{description}</p>
            )}
            {children}
        </div>
    );
}
