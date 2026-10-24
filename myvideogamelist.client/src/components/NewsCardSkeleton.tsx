import { Skeleton } from '@/components/Skeleton';
import { SkeletonLine } from '@/components/SkeletonLine';

/**
 * A `NewsCard` that has not arrived, in the card's own frame: the cover's box, the line naming the game
 * and the source, a title over two lines and the excerpt's two. That is the tallest a card gets — the
 * excerpt is clamped to two lines, and the cover is shorter than the words beside it — and the taller
 * of two cards sets a row's height.
 */
export function NewsCardSkeleton() {
    return (
        <div className="flex gap-4 p-4 rounded-xl bg-surface/60 border border-line skeleton-sheen">
            <Skeleton className="block shrink-0 w-14 h-20 rounded-lg" />

            <div className="min-w-0 flex-1">
                <div className="mb-1.5 text-xs">
                    <SkeletonLine width="w-1/3" />
                </div>
                <div className="font-semibold leading-snug">
                    <SkeletonLine width="w-11/12" />
                    <SkeletonLine width="w-1/2" />
                </div>
                <div className="mt-1.5 text-sm leading-relaxed">
                    <SkeletonLine width="w-full" />
                    <SkeletonLine width="w-4/5" />
                </div>
            </div>
        </div>
    );
}
