import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { WishlistToggle } from '@/components/WishlistToggle';
import { useReleaseGame } from '@/hooks/useReleaseGame';
import { comingSoonWhen, scheduleGroups } from '@/lib/comingSoon';
import type { ComingSoonGame } from '@/types/releases';
import { FavouriteMark } from './FavouriteMark';

/** A row's cover is drawn 3.5rem wide. */
const COVER_SIZES = '3.5rem';

interface ComingSoonScheduleProps {
    games: ComingSoonGame[];
    /** `YYYY-MM-DD`: the day the page was rendered for, which decides when a date needs its year. */
    today: string;
}

/**
 * One game on the schedule: the day as a figure, its cover and its title, what it arrives on, which of the
 * reader's lists it is in, and the wishlist toggle — the rows the cards of the rail were (ADR 0073, 0075).
 *
 * The month or the quarter it arrives in is its group's heading, so a row says only its day; a game known
 * to no closer than its month or quarter has a dash where the day would be.
 */
function ScheduleRow({ game, today }: { game: ComingSoonGame; today: string }) {
    const state = useReleaseGame(game);
    const day = game.precision === 'day' ? Number(game.starts.slice(8, 10)) : null;

    return (
        <li className="grid grid-cols-[2.5rem_3.5rem_minmax(0,1fr)] gap-x-3.5 items-start py-4 border-b border-line">
            <span aria-hidden="true" className="type-display text-3xl text-fg-strong leading-none tabular-nums">
                {day ?? '–'}
            </span>

            {/* Out of the tab order and hidden from screen readers: the title beside it is the same link. */}
            <Link to={`/games/${game.gameId}`} tabIndex={-1} aria-hidden="true" className="block aspect-[3/4] rounded-sm overflow-hidden bg-surface">
                {game.coverImageUrl && <CoverImage url={game.coverImageUrl} alt="" sizes={COVER_SIZES} className="w-full h-full object-cover" />}
            </Link>

            <div className="min-w-0">
                <Link to={`/games/${game.gameId}`} className="type-title text-[1.0625rem] leading-snug text-fg-strong hover:underline decoration-line-strong underline-offset-4">
                    {game.title}
                </Link>
                {/* After the title, on a cover too small for the round mark. */}
                {state.favourite && <FavouriteMark variant="inline" />}

                {/* The day for whoever cannot see the figure, which is the group heading's month made whole. */}
                {day !== null && <time dateTime={game.starts} className="sr-only">{comingSoonWhen(game, today)}</time>}

                {game.platforms.length > 0 && (
                    <p className="mt-1 type-meta text-fg-muted">{game.platforms.map(p => p.abbreviation).join(', ')}</p>
                )}

                {/* The reader's own list, by their name for it, as every label of a list is. */}
                {state.listName !== null && <p className="mt-1 type-meta text-success-300">In {state.listName}</p>}

                {state.signedIn && (
                    <div className="mt-2">
                        <WishlistToggle
                            variant="inline"
                            title={game.title}
                            wishlisted={state.wishlisted}
                            pending={state.pending}
                            onToggle={() => void state.toggleWishlist()}
                        />
                    </div>
                )}

                {state.failed && (
                    <p className="mt-1 text-xs font-semibold text-danger-300" role="alert">
                        Could not update your wishlist.
                    </p>
                )}
            </div>
        </li>
    );
}

/**
 * The new games of the next three months that the most people follow on IGDB, in the order they arrive
 * (ADR 0071), as a schedule: a column for each month, the games under it with their day as a figure, and
 * what is known only to a quarter under the quarter (ADR 0075). As many columns as fit, and one on a phone.
 *
 * The same for everybody, so it is in the shared home payload and the first HTML; lazy covers, since it sits
 * below whatever the page opens with.
 */
export function ComingSoonSchedule({ games, today }: ComingSoonScheduleProps) {
    if (games.length === 0) return null;

    return (
        <ul className="grid gap-x-8 gap-y-8 grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))]" aria-label="Coming soon">
            {scheduleGroups(games, today).map(group => (
                <li key={group.key} className="min-w-0">
                    <h3 className="type-title text-xl text-fg-strong pb-2 border-b border-line">{group.label}</h3>
                    <ul>
                        {group.games.map(game => <ScheduleRow key={game.gameId} game={game} today={today} />)}
                    </ul>
                </li>
            ))}
        </ul>
    );
}
