import { GameCardSkeleton } from '@/components/GameCardSkeleton';
import { GAME_GRID } from '@/lib/gameGrid';

/**
 * The games grid before its cards arrive, in the grid's own columns, so the cards land where their
 * shapes were. Silent on its own: the page puts it in a `LoadingState` that says what is loading.
 *
 * @param count
 * How many cards it stands for: a page of results where that is known, two rows at the widest where it
 * is not.
 */
export function GameGridSkeleton({ count }: { count: number }) {
    return (
        <div className={GAME_GRID}>
            {Array.from({ length: count }, (_, index) => <GameCardSkeleton key={index} />)}
        </div>
    );
}
