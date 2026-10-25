import { CoverImage } from '@/components/CoverImage';

/**
 * A game's cover at thumbnail size, or the space one would take. A review can run to hundreds of rows,
 * each a thumbnail a few rems wide, which is where loading the smallest size IGDB has saves the most.
 *
 * The placeholder is a `span` rather than a `div` because this sits inside a button wherever a game
 * is offered to be chosen, and a button holds phrasing content only.
 *
 * @param sizes The width the classes draw it at, as an `<img sizes>` value.
 */
export function GameCover({ url, className, sizes }: { url?: string | null; className: string; sizes: string }) {
    return url
        ? <CoverImage url={url} alt="" sizes={sizes} className={`${className} object-cover rounded shrink-0`} />
        : <span className={`${className} block rounded bg-raised/60 shrink-0`} aria-hidden="true" />;
}
