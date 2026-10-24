import { Link } from 'react-router';
import { useLists } from '@/hooks/useLists';
import { useFavourites } from '@/hooks/useFavourites';
import { FavouriteMark } from './FavouriteMark';
import { FavouriteWords } from './FavouriteWords';
import { sortEntries, type SortState } from '@/lib/listSort';

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

    // Nothing at all while the lists are still coming: a "you are not playing anything" message
    // that turns into six covers a moment later is worse than a moment of nothing.
    if (loading) return null;

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
        <ul
            className="relative flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 scroll-px-4 sm:scroll-px-0 snap-x snap-mandatory scroll-smooth"
            // Positioned, so that the visually hidden words beside a favourite's title are placed inside
            // it. Placed against the page instead, those of a cover scrolled out of view widened the
            // page by the rail's overflow, and a phone could scroll it sideways — as the lists' table
            // and the two-week line once did (ListTable.css, ReleaseLine.css).
            // Snapped to the gutter below `sm`, where the first card sits. Snapped to the rail's own
            // edge, that card's snap position was sixteen pixels in, so the rail scrolled itself there
            // before the first paint — and Chrome counts that as a scroll, which ends the page's LCP
            // measurement with nothing recorded (issue 315).
            // The rail scrolls independently of the page, so it is a focusable region with a name
            // rather than a silent overflow container a keyboard user cannot reach.
            tabIndex={0}
            aria-label="Games you are playing"
        >
            {playing.map((entry, index) => {
                const { game } = entry;
                const pending = isPending(game.id);
                const favourite = isFavourite(game.id);

                return (
                    <li key={game.id} className="shrink-0 snap-start w-32 sm:w-36">
                        <Link
                            to={`/games/${game.id}`}
                            className="group block focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus rounded-xl"
                        >
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-surface border border-line group-hover:border-primary-500/60 transition-all duration-300 shadow-lg">
                                {game.coverImageUrl && (
                                    <img
                                        src={game.coverImageUrl}
                                        alt=""
                                        loading={index < 6 ? 'eager' : 'lazy'}
                                        className="w-full h-full object-cover"
                                    />
                                )}
                                {favourite && <FavouriteMark variant="cover" />}
                            </div>

                            <p className="mt-2 text-sm font-medium text-fg leading-snug line-clamp-2 group-hover:text-primary-400 transition-colors">
                                {game.title}
                                {favourite && <FavouriteWords />}
                            </p>
                        </Link>

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
                    </li>
                );
            })}
        </ul>
    );
}
