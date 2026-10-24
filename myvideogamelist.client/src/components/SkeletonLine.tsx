import { Skeleton } from '@/components/Skeleton';

/**
 * One line of text that has not arrived: as tall as a line of whatever type the element around it sets,
 * with a bar across part of it. `h-lh` is that type's line height, so a stack of these inside the
 * classes the real text has comes to the real text's height by construction.
 */
export function SkeletonLine({ width }: { width: string }) {
    return (
        <span className="flex h-lh items-center">
            <Skeleton className={`block h-[0.75em] rounded-sm ${width}`} />
        </span>
    );
}
