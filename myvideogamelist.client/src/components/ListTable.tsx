import { Link } from 'react-router';
import type { ListEntryDto } from '@/types/list';
import { type SortKey, type SortState, SORT_OPTIONS, sortOption } from '@/lib/listSort';
import { MIN_CRITIC_REVIEWS } from '@/lib/score';
import { ScoreInput } from '@/components/ScoreInput';
import './ListTable.css';

interface ListTableProps {
    entries: ListEntryDto[];
    sort: SortState;
    onSortChange: (sort: SortState) => void;
    onScoreChange: (gameId: number, score: number | null) => void;
    onRemove: (gameId: number) => void;
    isPending: (gameId: number) => boolean;
    /** Names the table for screen readers — "Playing", "Backlog" and so on. */
    listName: string;
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

function year(date: string | null): string {
    return date === null ? '—' : String(new Date(date).getFullYear());
}

function shortDate(date: string | null): string {
    if (date === null) return '—';
    return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

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
    listName,
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
                <tbody>
                    {entries.map(entry => {
                        const { game } = entry;
                        const pending = isPending(game.id);
                        const showCritic = game.criticScore !== null
                            && game.criticScoreCount !== null
                            && game.criticScoreCount >= MIN_CRITIC_REVIEWS;

                        return (
                            <tr key={game.id} className={pending ? 'pending' : undefined}>
                                <td className="col-cover">
                                    <Link to={`/games/${game.id}`} tabIndex={-1} aria-hidden="true">
                                        {game.coverImageUrl ? (
                                            <img src={game.coverImageUrl} alt="" loading="lazy" />
                                        ) : (
                                            <span className="list-table-nocover" />
                                        )}
                                    </Link>
                                </td>

                                <td className="col-title">
                                    <Link to={`/games/${game.id}`}>{game.title}</Link>
                                </td>

                                <td className="col-score">
                                    <ScoreInput
                                        score={entry.score}
                                        gameTitle={game.title}
                                        disabled={pending}
                                        onChange={score => onScoreChange(game.id, score)}
                                    />
                                </td>

                                <td className="col-rating num">
                                    {game.rating === null ? '—' : game.rating.toFixed(1)}
                                </td>

                                <td className="col-critic num">
                                    {showCritic ? game.criticScore : '—'}
                                </td>

                                <td className="col-released num">{year(game.releaseDate)}</td>

                                <td className="col-added num">{shortDate(entry.addedAt)}</td>

                                <td className="col-platforms">
                                    <span className="list-table-platforms">
                                        {game.platforms.length === 0
                                            ? '—'
                                            : game.platforms.map(p => p.abbreviation).join(', ')}
                                    </span>
                                </td>

                                <td className="col-actions">
                                    <button
                                        type="button"
                                        className="list-table-remove"
                                        disabled={pending}
                                        onClick={() => onRemove(game.id)}
                                        title={`Take ${game.title} out of this list`}
                                        aria-label={`Take ${game.title} out of this list`}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
