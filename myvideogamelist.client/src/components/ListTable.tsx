import type { ListEntryDto } from '@/types/list';
import type { TagDto } from '@/types/tag';
import { type SortKey, type SortState, SORT_OPTIONS, sortOption } from '@/lib/listSort';
import { ListTableRow } from '@/components/ListTableRow';
import type { Reorder } from '@/hooks/useReorder';
import './ListTable.css';

interface ListTableProps {
    entries: ListEntryDto[];
    sort: SortState;
    onSortChange: (sort: SortState) => void;
    onScoreChange: (gameId: number, score: number | null) => void;
    onRemove: (gameId: number) => void;
    isPending: (gameId: number) => boolean;
    /** Which games are the reader's favourites, marked after their titles (`docs/decisions/0064-*`). */
    isFavourite: (gameId: number) => boolean;
    /** Names the table for screen readers — "Playing", "Backlog" and so on. */
    listName: string;
    /**
     * Given while the list is shown in its hand order and can be rearranged: each row gets a handle in
     * a first column, and `entries` is already in the order to draw, a game being moved included.
     */
    reorder?: Reorder;
    /** A row's tags, resolved and in name order, drawn under its title. */
    tagsFor?: (entry: ListEntryDto) => TagDto[];
}

/** Columns that double as sort controls, in display order. */
const SORTABLE: { key: SortKey; className: string }[] = [
    { key: 'title', className: 'col-title' },
    { key: 'score', className: 'col-score' },
    { key: 'rating', className: 'col-rating' },
    { key: 'critic_score', className: 'col-critic' },
    { key: 'release_date', className: 'col-released' },
    { key: 'added', className: 'col-added' },
];

/**
 * The condensed view: one row per game, with the poster kept as a small thumbnail so the list is
 * still scannable by cover art rather than by title alone.
 *
 * The column headers are the sort control — a table that shows a sortable column and makes you
 * use a dropdown elsewhere to sort by it reads as broken. The toolbar's sort select and these
 * headers drive the same state.
 */
export function ListTable({
    entries,
    sort,
    onSortChange,
    onScoreChange,
    onRemove,
    isPending,
    isFavourite,
    listName,
    reorder,
    tagsFor,
}: ListTableProps) {
    const sortBy = (key: SortKey) => {
        // Clicking the active column flips direction; a new column starts in whichever direction
        // reads as "best first" for that field.
        if (sort.key === key) onSortChange({ key, descending: !sort.descending });
        else onSortChange({ key, descending: sortOption(key).defaultDescending });
    };

    return (
        <div className="list-table-scroll">
            <table className="list-table">
                <caption className="sr-only">{listName}</caption>
                <thead>
                    <tr>
                        {/* The table is in this column's order whenever it is drawn, so it says so as
                            the other columns do when they are the sort. */}
                        {reorder && (
                            <th scope="col" className="col-order" aria-sort="ascending">
                                <span aria-hidden="true">#</span>
                                <span className="sr-only">Order</span>
                            </th>
                        )}
                        <th scope="col" className="col-cover"><span className="sr-only">Cover</span></th>
                        {SORTABLE.map(({ key, className }) => {
                            const active = sort.key === key;
                            return (
                                <th
                                    key={key}
                                    scope="col"
                                    className={className}
                                    aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                                >
                                    <button type="button" onClick={() => sortBy(key)}>
                                        {SORT_OPTIONS.find(option => option.key === key)?.columnLabel}
                                        <span className={`list-table-caret${active ? ' active' : ''}`} aria-hidden="true">
                                            {active ? (sort.descending ? '▾' : '▴') : '▾'}
                                        </span>
                                    </button>
                                </th>
                            );
                        })}
                        <th scope="col" className="col-platforms">Platforms</th>
                        <th scope="col" className="col-actions"><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody {...reorder?.listProps()}>
                    {entries.map((entry, index) => (
                        <ListTableRow
                            key={entry.game.id}
                            entry={entry}
                            pending={isPending(entry.game.id)}
                            favourite={isFavourite(entry.game.id)}
                            onScoreChange={onScoreChange}
                            onRemove={onRemove}
                            reorder={reorder}
                            rank={index + 1}
                            tagsFor={tagsFor}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}
