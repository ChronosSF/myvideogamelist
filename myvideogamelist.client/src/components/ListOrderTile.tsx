import { memo } from 'react';
import type { ListEntryDto } from '@/types/list';
import type { TagDto } from '@/types/tag';
import type { ReorderHandles } from '@/hooks/useReorder';
import type { ListsPending } from '@/contexts/ListsContext';
import { usePendingIn } from '@/hooks/useListPending';
import { ListTile } from '@/components/ListTile';
import { ReorderHandle } from '@/components/ReorderHandle';

interface ListOrderTileProps {
    entry: ListEntryDto;
    /** Whether the cover loads with the page: true for the grid's first row. */
    eager: boolean;
    tagsOf: (entry: ListEntryDto) => TagDto[];
    /** The lists' per-game locks (`ListsContextValue.pending`). */
    locks: ListsPending;
    /** `useReorder`'s steady `handles`. */
    handles: ReorderHandles;
    /** Whether the game is the one being moved. */
    lifted: boolean;
    /** Where the game stands, counted from one, as it is drawn now. */
    rank: number;
}

/**
 * A game on the lists page's grid while the list is shown in its hand order: its numbered handle over its
 * card. Memoised, and it reads its game's lock itself from the locks it is handed, as `ListTableRow` does, so
 * that a save or another render of the page draws again only the tiles whose game, place or lock changed
 * (`docs/decisions/0086-*`). The handle cannot be picked up while the game's own save is out.
 */
export const ListOrderTile = memo(function ListOrderTile({
    entry,
    eager,
    tagsOf,
    locks,
    handles,
    lifted,
    rank,
}: ListOrderTileProps) {
    const { game } = entry;
    const pending = usePendingIn(locks, game.id);

    return (
        <div className="reorder-tile" role="listitem" {...handles.item(game.id, lifted)}>
            <ReorderHandle
                handle={handles.handle(game.id, game.title, { lifted, movable: !pending })}
                rank={rank}
                variant="overlay"
            />
            <ListTile entry={entry} eager={eager} tagsOf={tagsOf} />
        </div>
    );
});
