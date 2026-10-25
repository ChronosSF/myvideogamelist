import type { ReactNode } from 'react';

interface EmptyStateProps {
    /** An outline icon's path, drawn on a 24-unit grid as the heroicons the site uses are. */
    icon: string;
    /** What is not here: "No games in Backlog yet." */
    message: string;
    /** What would put something here, when the message alone does not say. */
    detail?: ReactNode;
    /** The way to fill it, when the reader has one: a link to browse, a button to clear a filter. */
    children?: ReactNode;
    /**
     * The message as the page's heading, for an empty state that is the whole page. A paragraph
     * otherwise, as on the lists page, where the page's own heading is already above it.
     */
    titleAs?: 'h1' | 'p';
    /**
     * `page` when it is all a page has to show, as on the lists page. `section` inside a page that has
     * other things on it, where the page's size would push everything under it down for a sentence.
     */
    size?: 'page' | 'section';
}

/**
 * Somewhere with nothing in it yet, said in the lists page's voice: what is missing, and what would put
 * something there.
 *
 * Lifted out of the lists page so that every page says it one way. Nothing empty is shown as a blank, or
 * as a heading with nothing under it: a reader cannot tell a blank from a page that failed.
 */
export function EmptyState({
    icon,
    message,
    detail,
    children,
    titleAs: Title = 'p',
    size = 'page',
}: EmptyStateProps) {
    const page = size === 'page';

    return (
        <div className={`flex items-center justify-center ${page ? 'py-24' : 'py-6'}`}>
            <div className="text-center">
                <svg
                    className={`${page ? 'w-14 h-14 mb-4' : 'w-10 h-10 mb-3'} text-fg-dim mx-auto`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
                </svg>
                <Title className="text-fg-muted font-medium mb-3">{message}</Title>
                {detail !== undefined && (
                    <p className={`text-fg-muted text-sm max-w-md mx-auto${children === undefined ? '' : ' mb-4'}`}>
                        {detail}
                    </p>
                )}
                {children}
            </div>
        </div>
    );
}
