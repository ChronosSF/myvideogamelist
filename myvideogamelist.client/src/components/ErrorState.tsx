import { type ReactNode, useId } from 'react';

interface ErrorStateProps {
    /** What failed, plainly: "Failed to load lists". */
    title: string;
    /** Why, and what still works, when that is known. */
    children?: ReactNode;
    /**
     * Asks again. Offered whenever asking again could work, because without it the only way out of a
     * failed load is reloading the page.
     */
    onRetry?: () => void;
    /** A retry is on its way, so the button says so and does not ask twice. */
    retrying?: boolean;
    /**
     * The title as the page's heading, for a failure that is the whole page. A paragraph otherwise, as
     * on the lists page, where the page's own heading is already above it.
     */
    titleAs?: 'h1' | 'p';
    /** `page` when it is all a page has to show; `section` inside a page that has other things on it. */
    size?: 'page' | 'section';
    /**
     * The id of the request that failed, when the failure carries one (ADR 0059): what somebody
     * reporting it can quote, offered as the root's error page offers it.
     */
    reference?: string | null;
}

/**
 * Something that could not be loaded, said in the lists page's voice: what failed, why if it is known,
 * and a way to try again.
 *
 * Lifted out of the lists page so that every failure reads one way, and given the retry the wishlist and
 * the news pages already offered beside theirs.
 *
 * A failure that is the whole page is an alert, as theirs are, so that one replacing a page after a
 * client-side navigation is announced rather than found. One inside a section is not: the page around it
 * rendered perfectly well, and an alert would interrupt a screen reader to announce a side panel.
 *
 * While a retry is out the button keeps its place and its focus, and says so: it is marked disabled
 * rather than disabled, because a disabled button cannot hold focus, and the reader who pressed it would
 * be left on the page's body with nothing said when the retry failed.
 */
export function ErrorState({
    title,
    children,
    onRetry,
    retrying = false,
    titleAs: Title = 'p',
    size = 'page',
    reference = null,
}: ErrorStateProps) {
    const page = size === 'page';
    const titleId = useId();

    return (
        <div className={`flex items-center justify-center ${page ? 'py-24' : ''}`}>
            <div
                className={`bg-danger-900/20 border border-danger-700/50 rounded-xl max-w-md text-center ${page ? 'p-8' : 'p-5'}`}
                role={page ? 'alert' : undefined}
            >
                <svg
                    className={`${page ? 'w-10 h-10 mb-3' : 'w-8 h-8 mb-2'} text-danger-400 mx-auto`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 4a8 8 0 100 16 8 8 0 000-16z" />
                </svg>
                <Title id={titleId} className="text-danger-300 font-medium mb-1">{title}</Title>
                {children !== undefined && <p className="text-danger-300/80 text-sm">{children}</p>}
                {reference !== null && (
                    <p className="text-danger-300/80 text-xs mt-2">
                        If you report this, quote{' '}
                        <code className="font-mono select-all break-all">{reference}</code>.
                    </p>
                )}
                {onRetry !== undefined && (
                    <button
                        type="button"
                        className={`${page ? 'mt-4' : 'mt-3'} inline-flex items-center gap-1.5 px-4 py-2 bg-danger-700 hover:bg-danger-600 aria-disabled:opacity-60 aria-disabled:cursor-wait text-fg-strong text-sm font-semibold rounded-lg transition-colors`}
                        onClick={retrying ? undefined : onRetry}
                        aria-disabled={retrying || undefined}
                        // Described by what it retries, so that it is not one of several bare "Try
                        // again"s on a page whose other parts can fail on their own.
                        aria-describedby={titleId}
                    >
                        {retrying ? 'Trying again…' : 'Try again'}
                    </button>
                )}
            </div>
        </div>
    );
}
