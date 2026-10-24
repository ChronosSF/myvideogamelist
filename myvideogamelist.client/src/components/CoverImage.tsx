import { COVER_HEIGHT, COVER_WIDTH, coverSrcSet } from '@/lib/coverArt';

interface CoverImageProps {
    /** As the API sent it: IGDB's `t_cover_big`, which is also what loads where no smaller size is offered. */
    url: string;
    alt: string;
    /**
     * How wide the image is drawn, in CSS pixels, as an `<img sizes>` value: what the browser picks a
     * size from before it has laid anything out. It has to be worked out from the box the image is drawn
     * in, which is why every caller states its own. Under `object-cover` in a box that is not three by
     * four, that is the width the image is scaled to, not the box's.
     */
    sizes: string;
    /**
     * For a cover in view before any scrolling, which may well be the page's largest first paint: loaded
     * with the page rather than when it is reached. A lazily loaded largest paint is slower, not faster —
     * the browser holds a lazy image until layout says where it is, which is after it could have started.
     */
    eager?: boolean;
    className?: string;
}

/**
 * A game's cover, at the smallest of IGDB's sizes that fills the box it is drawn in.
 *
 * The `width` and `height` reserve the box before the image arrives. Every place this is drawn sizes it
 * with CSS as well, so they change nothing that is rendered there; they are what keeps the space if that
 * CSS ever changes. A cover below the fold is lazy and decodes off the main thread.
 *
 * A lazy cover's `sizes` starts with `auto`: it is fetched only once it has been laid out, so a browser
 * that knows the keyword picks by the width it really is drawn at, and one that does not skips it for
 * the caller's own value. An eager cover is chosen before layout, so it has only the caller's value.
 */
export function CoverImage({ url, alt, sizes, eager = false, className }: CoverImageProps) {
    const srcSet = coverSrcSet(url);

    return (
        <img
            src={url}
            srcSet={srcSet}
            // Only beside a srcset, which is the one thing it tells the browser how to choose from.
            sizes={srcSet === undefined ? undefined : eager ? sizes : `auto, ${sizes}`}
            alt={alt}
            width={COVER_WIDTH}
            height={COVER_HEIGHT}
            loading={eager ? 'eager' : 'lazy'}
            decoding={eager ? undefined : 'async'}
            className={className}
        />
    );
}
