import { Link } from 'react-router';
import { ContinuePlayingSkeleton } from '@/components/ContinuePlayingSkeleton';
import { CoverImage } from '@/components/CoverImage';
import { useLists } from '@/hooks/useLists';
import { useFavourites } from '@/hooks/useFavourites';
import { FavouriteMark } from './FavouriteMark';
import { sortEntries, type SortState } from '@/lib/listSort';

/** Each cover is drawn across its row's 3.5rem column. */
const COVER_SIZES = '3.5rem';

/**
 * Most recently moved into Playing first, rather than the lists page's "recently added".
 *
 * The two differ for exactly the game this rail is about: something added to the backlog a year
 * ago and started last night is the one to pick up, and by date added it would be at the far end
 * of the rail. Not the user's own saved sort for the Playing list either — that is a preference
 * about a page of every game they are playing, and this is a strip of the nearest six.
 */
const RECENTLY_STARTED: SortState = { key: 'status_changed', descending: true };

/**
 * The games the user is playing right now, with one control: mark it finished.
 *
 * **No new API.** Everything here is already in `ListsProvider` by the time the home page renders,
 * which is what makes this the cheapest high-value thing on the page (ROADMAP H3) — and why it is
 * a component rather than a route with a loader.
 *
 * The one action is the one that is unambiguous from a rail. "Log progress" needs a form and
 * belongs on the game page beside the playthrough it is editing; putting a seven-field dialog
 * behind a cover here would be a worse version of a page that already exists.
 */
export function ContinuePlayingRail() {
    const { lists, loading, error, isPending, addToList } = useLists();
    const { isFavourite } = useFavourites();

    const playing = sortEntries(lists.playing, RECENTLY_STARTED);

    // The rail's own shapes while the lists are still coming: a "you are not playing anything" message
    // that turns into six covers a moment later is worse than either, and nothing at all left the page
    // below to jump when the covers came (ADR 0070).
    if (loading) return <ContinuePlayingSkeleton />;

    // Asked before the empty state, because a failed load leaves the lists empty and would otherwise
    // read as "nothing in your Playing list" — the play-next picker below has the same guard.
    if (error !== null) {
        return (
            <div className="continue-empty">
                <p>Your lists could not be loaded just now.</p>
            </div>
        );
    }

    if (playing.length === 0) {
        return (
            <div className="continue-empty">
                <p>
                    Nothing in your Playing list. Move something across and it appears here, ready
                    to pick up.
                </p>
                <Link to="/lists" className="continue-empty-link">Go to your lists</Link>
            </div>
        );
    }

    return (
        // Rows rather than the rail's posters (ADR 0075): what you are playing is a short list to act on, and
        // as many across as fit at 15rem.
        <ul className="continue-list" aria-label="Games you are playing">
            {playing.map((entry, index) => {
                const { game } = entry;
                const pending = isPending(game.id);
                const favourite = isFavourite(game.id);

                return (
                    <li key={game.id} className="continue-item">
                        {/* Out of the tab order and hidden from screen readers: the title beside it is the
                            same link. */}
                        <Link to={`/games/${game.id}`} className="continue-cover" tabIndex={-1} aria-hidden="true">
                            {game.coverImageUrl && (
                                <CoverImage url={game.coverImageUrl} alt="" sizes={COVER_SIZES} eager={index < 6} />
                            )}
                        </Link>

                        <div className="min-w-0">
                            <Link to={`/games/${game.id}`} className="continue-title">{game.title}</Link>
                            {/* After the title, on a cover too small for the round mark; named itself. */}
                            {favourite && <FavouriteMark variant="inline" />}
                            <div>
                                <button
                                    type="button"
                                    className="continue-finish-btn"
                                    disabled={pending}
                                    // The provider owns the optimistic update, the per-game lock and the
                                    // rollback, and it records the event — a status must never be written
                                    // any other way (ADR 0018). Fired with `void` like every other call
                                    // site: it has already handled its own failure.
                                    onClick={() => void addToList('finished', game)}
                                >
                                    {pending ? 'Saving…' : 'Mark finished'}
                                </button>
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
