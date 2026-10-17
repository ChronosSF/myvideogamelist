import { Skeleton } from '@/components/Skeleton';
import './ListTable.css';

/**
 * `ListTable`'s columns, in its order, by the classes that size them. Written out again rather than
 * shared, because the table's own list is of sort controls and this one has none; a column added there
 * and not here leaves the rows the right height and the columns a little narrower.
 */
const COLUMNS = [
    'col-cover', 'col-title', 'col-score', 'col-rating', 'col-critic',
    'col-released', 'col-added', 'col-platforms', 'col-actions',
] as const;

/** The bar standing in for each column's content, by how much of the column that content fills. */
const BARS: Record<(typeof COLUMNS)[number], string> = {
    'col-cover': 'w-9 h-12 rounded',
    'col-title': 'w-3/4 h-3 rounded-sm',
    'col-score': 'w-24 h-3 rounded-sm',
    'col-rating': 'w-6 h-3 rounded-sm',
    'col-critic': 'w-6 h-3 rounded-sm',
    'col-released': 'w-10 h-3 rounded-sm',
    'col-added': 'w-20 h-3 rounded-sm',
    'col-platforms': 'w-1/2 h-3 rounded-sm',
    'col-actions': 'w-4 h-4 rounded-sm',
};

/**
 * `ListTable` before its rows arrive: the table itself, with its header and its row height, and a bar in
 * each cell. Built from the table's own markup and stylesheet, so its rows are the rows' height by
 * construction — the cover's three rems and the cell padding — rather than by a number kept in step.
 * One sheen passes over the whole table, on a box of its own, since the table's scroll box sets its own
 * overflow.
 */
export function ListTableSkeleton({ rows }: { rows: number }) {
    return (
        <div className="skeleton-sheen rounded-xl">
            <div className="list-table-scroll">
                <table className="list-table">
                    <thead>
                        <tr>
                            {COLUMNS.map(column => (
                                <th key={column} className={column}>
                                    {/* The header's line, with the sort caret the real one keeps in it. */}
                                    {column !== 'col-cover' && column !== 'col-actions' && (
                                        <span className="inline-flex items-center gap-1">
                                            <Skeleton className="inline-block w-10 h-[0.66em] rounded-sm" />
                                            <span className="list-table-caret">▾</span>
                                        </span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: rows }, (_, row) => (
                            <tr key={row}>
                                {COLUMNS.map(column => (
                                    <td key={column} className={column}>
                                        <Skeleton className={`block ${BARS[column]}`} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
