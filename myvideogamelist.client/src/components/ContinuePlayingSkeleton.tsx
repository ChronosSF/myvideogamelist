import { LoadingState } from '@/components/LoadingState';
import { Skeleton } from '@/components/Skeleton';
import { SkeletonLine } from '@/components/SkeletonLine';

/** As many rows as a desktop shows on one line of the list, which is as many as a skeleton needs. */
const ROWS = 4;

/**
 * The Continue playing list before the lists have arrived, in its rows' own boxes: a cover, a line of
 * title, and the Mark finished button under it (ADR 0070).
 */
export function ContinuePlayingSkeleton() {
    return (
        <LoadingState label="Loading the games you are playing…">
            <div className="continue-list">
                {Array.from({ length: ROWS }, (_, row) => (
                    <div key={row} className="continue-item skeleton-sheen">
                        <Skeleton className="block aspect-[3/4] rounded-sm" />
                        <div>
                            <div className="continue-title"><SkeletonLine width="w-3/4" /></div>
                            {/* The button's height: its padding, a line of its type and its border. */}
                            <Skeleton className="block mt-2 h-[1.75rem] w-28 rounded-sm" />
                        </div>
                    </div>
                ))}
            </div>
        </LoadingState>
    );
}
