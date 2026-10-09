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
    /** The width of the page's own content, so that the title lines up with what is under it. */
    width?: keyof typeof WIDTHS;
    /** Smaller, for a page that is a step in something rather than a place: an import's review. */
    compact?: boolean;
    /** Anything else the header holds: a search box, a row of tabs, a second line. */
    children?: ReactNode;
}

/**
 * The band across the top of a page: its name and a line about it, over a tint of the primary that
 * fades into the page. One component in place of the nine copies of its classes there were.
 */
export function PageHeader({ title, description, width = '7xl', compact = false, children }: PageHeaderProps) {
    return (
        <div className="bg-gradient-to-b from-primary-950/60 to-page border-b border-line">
            <div className={`${WIDTHS[width]} mx-auto px-4 sm:px-6 lg:px-8 ${compact ? 'py-8' : 'py-10'}`}>
                <h1 className={`${compact ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl'} font-bold text-fg-strong mb-1`}>
                    {title}
                </h1>
                {description !== undefined && (
                    <p className={`text-fg-muted ${compact ? 'text-sm' : 'text-sm sm:text-base'}`}>{description}</p>
                )}
                {children}
            </div>
        </div>
    );
}
