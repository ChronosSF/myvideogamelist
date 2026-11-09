import { memo } from 'react';
import type { ListEntryDto } from '@/types/list';
import type { TagDto } from '@/types/tag';
import { GameCard } from '@/components/GameCard';
import { TagChips } from '@/components/TagChips';

interface ListTileProps {
    entry: ListEntryDto;
    /** Whether the cover loads with the page: true for the grid's first row. */
    eager: boolean;
    /** A row's tags, resolved and in name order. Held steady by the page while the tags are. */
    tagsOf: (entry: ListEntryDto) => TagDto[];
}

/**
 * A game on the lists page's grid: its card, with its tags under the title.
 *
 * Memoised, so that drawing the next chunk of a long list (`useDrawLimit`) renders the cards it adds and
 * none of those already drawn — a card is fifty-odd elements, and redrawing six hundred of them for every
 * sixty more is what made the foot of a long list slow to reach. The card still follows the lists, the
 * wishlist and the favourites through their contexts, which a memo does not stand in the way of, and a
 * card whose game changed is a new `entry` and is drawn again.
 */
export const ListTile = memo(function ListTile({ entry, eager, tagsOf }: ListTileProps) {
    return (
        <GameCard game={entry.game} eager={eager}>
            <TagChips tags={tagsOf(entry)} max={3} />
        </GameCard>
    );
});
