import { Skeleton } from '@/components/Skeleton';
import { SkeletonLine as Line } from '@/components/SkeletonLine';
import { CARD_BODY, CARD_COVER, CARD_FRAME } from '@/lib/gameGrid';

/** A genre pill: a line of `text-xs` with two pixels of padding and a border, above and below. */
function Pill({ width }: { width: string }) {
    return <Skeleton className={`block h-[1.375rem] rounded-full ${width}`} />;
}

/** A platform's abbreviation: a line of `text-xs` with two pixels of padding above and below. */
function Chip() {
    return <Skeleton className="block h-5 w-9 rounded" />;
}

/**
 * A `GameCard` that has not arrived: the card's own frame, cover box and body, with a bar for each line.
 *
 * The cover's box is exact, which is most of a card. The body is the card a row of them usually ends up
 * as, because the tallest card sets a row's height: a title over two lines, the players' score, genres
 * over two rows, three lines of description and platforms over two rows. Measured on the games page on
 * 17 October 2026, the tallest body in each row came to between 289 and 297 pixels at both phone and
 * desktop widths, and this one comes to 290.
 */
export function GameCardSkeleton() {
    return (
        <div className={`${CARD_FRAME} skeleton-sheen`}>
            <div className={CARD_COVER}>
                <Skeleton className="block w-full h-full" />
            </div>

            <div className={CARD_BODY}>
                <div className="text-sm leading-snug">
                    <Line width="w-11/12" />
                    <Line width="w-2/3" />
                </div>

                {/* The score badge, a pill of `text-xs` on a line of the body's own type. */}
                <div>
                    <Skeleton className="inline-block align-middle h-5 w-20 rounded" />
                </div>

                {/* Two rows a gap apart, as the card's wrapped pills are. */}
                <div className="flex flex-col gap-1">
                    <div className="flex gap-1">
                        <Pill width="w-14" />
                        <Pill width="w-16" />
                    </div>
                    <div className="flex gap-1">
                        <Pill width="w-20" />
                    </div>
                </div>

                <div className="text-xs leading-relaxed pt-1">
                    <Line width="w-full" />
                    <Line width="w-full" />
                    <Line width="w-3/4" />
                </div>

                {/* Pinned to the foot, as the card's platforms are. */}
                <div className="flex flex-col gap-1 mt-auto pt-2 border-t border-line">
                    <div className="flex gap-1">
                        <Chip />
                        <Chip />
                        <Chip />
                    </div>
                    <div className="flex gap-1">
                        <Chip />
                    </div>
                </div>
            </div>
        </div>
    );
}
