interface ScreenshotGalleryProps {
    /** Full IGDB screenshot URLs, already sized by the API. */
    screenshots: string[];
    /** Used to build meaningful alternative text. */
    gameTitle: string;
}

/**
 * IGDB serves every image size off the same path, differing only in the `t_<size>` segment, so
 * the full-resolution variant is derivable from the one the API sent rather than needing a
 * second field on the DTO.
 */
function fullSizeUrl(url: string): string {
    return url.replace('/t_screenshot_big/', '/t_1080p/');
}

/**
 * Screenshots for a game, as a grid that links each image to its full-resolution version.
 *
 * A plain link rather than a lightbox on purpose: a modal needs focus trapping, an escape key
 * handler and scroll locking to be usable, and a half-built one is worse than a new tab.
 */
export function ScreenshotGallery({ screenshots, gameTitle }: ScreenshotGalleryProps) {
    if (screenshots.length === 0) return null;

    return (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {screenshots.map((url, index) => (
                <li key={url}>
                    <a
                        href={fullSizeUrl(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block rounded-lg overflow-hidden border border-slate-700/50 light:border-slate-200 hover:border-blue-500/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
                    >
                        <img
                            src={url}
                            alt={`${gameTitle} screenshot ${index + 1} of ${screenshots.length}`}
                            loading="lazy"
                            className="w-full aspect-video object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                    </a>
                </li>
            ))}
        </ul>
    );
}
