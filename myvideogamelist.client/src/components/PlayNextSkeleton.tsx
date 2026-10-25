import { LoadingState } from '@/components/LoadingState';
import { Skeleton } from '@/components/Skeleton';
import { SkeletonLine } from '@/components/SkeletonLine';

/**
 * The Play next card before the backlog has arrived, in the card's own frame: the cover's box, the title,
 * the line under it and the two buttons (ADR 0070).
 */
export function PlayNextSkeleton() {
    return (
        <LoadingState label="Loading a pick from your backlog…">
            <div className="play-next skeleton-sheen">
                <Skeleton className="block shrink-0 w-[5.5rem] aspect-[3/4] rounded-lg" />

                <div className="play-next-body flex-1">
                    <p className="play-next-title"><SkeletonLine width="w-48" /></p>
                    <p className="play-next-meta"><SkeletonLine width="w-56" /></p>
                    <div className="play-next-actions">
                        <Skeleton className="block h-8 w-28 rounded-lg" />
                        <Skeleton className="block h-8 w-24 rounded-lg" />
                    </div>
                </div>
            </div>
        </LoadingState>
    );
}
