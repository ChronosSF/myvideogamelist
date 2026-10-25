import { LoadingState } from '@/components/LoadingState';
import { Skeleton } from '@/components/Skeleton';
import { SkeletonLine } from '@/components/SkeletonLine';

/** As many cards as the rail shows in a desktop's first screen, which is as many as a skeleton needs. */
const CARDS = 4;

/**
 * The Continue playing rail before the lists have arrived, in its cards' own boxes: a cover, a line of
 * title, and the Mark finished button under it (ADR 0070).
 */
export function ContinuePlayingSkeleton() {
    return (
        <LoadingState label="Loading the games you are playing…">
            <div className="flex gap-4 overflow-hidden pb-4">
                {Array.from({ length: CARDS }, (_, card) => (
                    <div key={card} className="shrink-0 w-32 sm:w-36 skeleton-sheen">
                        <Skeleton className="block aspect-[3/4] rounded-xl" />
                        <div className="mt-2 text-sm leading-snug">
                            <SkeletonLine width="w-3/4" />
                        </div>
                        {/* The button's height: its padding, a line of its type and its border. */}
                        <Skeleton className="block mt-2 h-[1.875rem] rounded-lg" />
                    </div>
                ))}
            </div>
        </LoadingState>
    );
}
