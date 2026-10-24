/**
 * IGDB's cover art at the size it is drawn.
 *
 * The API sends every cover as `t_cover_big`, 264 pixels wide, because that is the largest any card
 * draws one. IGDB serves the same image at other sizes from the same path with a different `t_` segment,
 * so a smaller one is a rewrite of the URL rather than a field on the DTO, as `ScreenshotGallery` does
 * for screenshots.
 *
 * The three sizes below were each loaded from images.igdb.com before they went in here, for fifteen
 * covers taken at random from `CachedGames` on 17 October 2026, and every one came back at exactly these
 * dimensions: 90×120, 180×240 and 264×352, all three by four. `t_cover_small_2x` is IGDB's retina
 * variant of the small size, and it is the one most of the rails end up with.
 *
 * **`t_cover_big_2x`, 528 wide, is deliberately not offered.** A retina screen would take it for every
 * card wider than about 130 pixels, at roughly three times the bytes of the cover it gets today. The
 * point of the srcset is that a small card stops downloading a big cover, and nothing here should make a
 * card download a bigger one than it does now. Sharper covers on retina screens are a decision of their
 * own, with their own byte budget.
 */

const COVER_BIG = /^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/)t_cover_big(\/[^/?#]+)$/;

/** Smallest first, which is the order a srcset is read in. */
const COVER_SIZES = [
    { segment: 't_cover_small', width: 90 },
    { segment: 't_cover_small_2x', width: 180 },
    { segment: 't_cover_big', width: 264 },
] as const;

/**
 * The size the API's own URL is, for the `width` and `height` attributes that reserve an image's box
 * before it loads. Every size above has these proportions, so they describe whichever one is chosen.
 */
export const COVER_WIDTH = 264;
export const COVER_HEIGHT = 352;

/**
 * A `srcset` offering the cover at each size, or undefined for a URL that is not IGDB's `t_cover_big`.
 *
 * Undefined rather than a guess: anything else is left to load exactly as it was given, since a rewrite
 * of a URL this does not recognise would be a broken image rather than a smaller one.
 */
export function coverSrcSet(url: string): string | undefined {
    const match = COVER_BIG.exec(url);
    if (match === null) return undefined;

    const [, base, file] = match;
    return COVER_SIZES.map(size => `${base}${size.segment}${file} ${size.width}w`).join(', ');
}
