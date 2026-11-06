import { memo } from 'react';
import { Link } from 'react-router';
import type { ListEntryDto } from '@/types/list';
import type { TagDto } from '@/types/tag';
import { releaseYear } from '@/lib/releaseDate';
import { hasCriticScore, ratingPercent } from '@/lib/score';
import { CoverImage } from '@/components/CoverImage';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScoreInput } from '@/components/ScoreInput';
import { ReorderHandle } from '@/components/ReorderHandle';
import { FavouriteMark } from '@/components/FavouriteMark';
import type { Reorder } from '@/hooks/useReorder';
import { TagChips } from '@/components/TagChips';

interface ListTableRowProps {
    entry: ListEntryDto;
    /** Whether a save for this game is out, which greys the row and holds its controls. */
    pending: boolean;
    /** Whether the game is one of the reader's favourites, marked after its title. */
    favourite: boolean;
    onScoreChange: (gameId: number, score: number | null) => void;
    onRemove: (gameId: number) => void;
    /** Given while the list can be rearranged by hand: the row gets a handle, numbered `rank`. */
    reorder?: Reorder;
    rank: number;
    tagsFor?: (entry: ListEntryDto) => TagDto[];
}

function year(date: string | null): string {
    return date === null ? '—' : String(releaseYear(date));
}

/**
 * The day a game joined the list. One formatter for every row rather than one each, and in English, as
 * the copy around it is and as `formatCount` is (`@/lib/format`), never in the runtime's default locale.
 * No `timeZone`, so it is the reader's day: the table is drawn only for a signed-in reader, after
 * hydration, so it is only ever formatted in the browser.
 */
const ADDED_FORMAT = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

function shortDate(date: string | null): string {
    return date === null ? '—' : ADDED_FORMAT.format(new Date(date));
}

/**
 * One game in `ListTable`. Memoised, with the page's callbacks held steady, so that drawing the next
 * chunk of a long list (`useDrawLimit`) renders the rows it adds and none of those already drawn: a row is
 * eighty-odd elements, two thirds of them the score control, and redrawing six hundred of them for every
 * sixty more is what made the foot of a long table slow to reach. A row whose game changed — its score,
 * its tags, a save going out — is a new `entry` or a new flag, and is drawn again.
 */
export const ListTableRow = memo(function ListTableRow({
    entry,
    pending,
    favourite,
    onScoreChange,
    onRemove,
    reorder,
    rank,
    tagsFor,
}: ListTableRowProps) {
    const { game } = entry;

    return (
        <tr
            className={pending ? 'pending' : undefined}
            {...reorder?.itemProps(game.id)}
        >
            {reorder && (
                <td className="col-order">
                    <ReorderHandle
                        handle={reorder.handleProps(game.id)}
                        rank={rank}
                        variant="inline"
                    />
                </td>
            )}

            <td className="col-cover">
                <Link to={`/games/${game.id}`} tabIndex={-1} aria-hidden="true">
                    {/* `.col-cover img` draws it 2.25rem wide. */}
                    {game.coverImageUrl ? (
                        <CoverImage url={game.coverImageUrl} alt="" sizes="2.25rem" />
                    ) : (
                        <span className="list-table-nocover" />
                    )}
                </Link>
            </td>

            <td className="col-title">
                <Link to={`/games/${game.id}`}>{game.title}</Link>
                {/* After the title rather than on a thumbnail too small to carry it,
                    and named itself, since it is not inside the link. */}
                {favourite && <FavouriteMark variant="inline" />}
                {tagsFor && (
                    <div className="list-table-tags">
                        <TagChips tags={tagsFor(entry)} max={4} />
                    </div>
                )}
            </td>

            <td className="col-score">
                <ScoreInput
                    size="sm"
                    score={entry.score}
                    gameTitle={game.title}
                    disabled={pending}
                    onChange={score => onScoreChange(game.id, score)}
                />
            </td>

            <td className="col-rating num">
                {game.rating === null ? '—' : (
                    <ScoreBadge
                        variant="plain"
                        kind="players"
                        percent={ratingPercent(game.rating)}
                        count={game.ratingCount}
                    />
                )}
            </td>

            <td className="col-critic num">
                {hasCriticScore(game) ? (
                    <ScoreBadge
                        variant="plain"
                        kind="critics"
                        percent={game.criticScore!}
                        count={game.criticScoreCount}
                    />
                ) : '—'}
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
});
