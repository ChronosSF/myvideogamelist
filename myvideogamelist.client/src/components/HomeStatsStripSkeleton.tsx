import { LoadingState } from '@/components/LoadingState';
import { SkeletonLine } from '@/components/SkeletonLine';

/**
 * The home page's strip of three figures before they have arrived, in the strip's own boxes: a figure and
 * its label in each (ADR 0070).
 */
export function HomeStatsStripSkeleton() {
    return (
        <LoadingState label="Loading your numbers…">
            <dl className="home-strip">
                {['w-24', 'w-20', 'w-28'].map(label => (
                    <div key={label} className="home-strip-item skeleton-sheen">
                        <dt><SkeletonLine width={label} /></dt>
                        <dd><SkeletonLine width="w-10" /></dd>
                    </div>
                ))}
            </dl>
        </LoadingState>
    );
}
