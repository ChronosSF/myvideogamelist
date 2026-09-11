import { Link } from 'react-router';
import { useLists } from '@/hooks/useLists';
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
    const { lists, loading, isPending, addToList } = useLists();

    const playing = sortEntries(lists.playing, RECENTLY_STARTED);

    // Nothing at all while the lists are still coming: a "you are not playing anything" message
    // that turns into six covers a moment later is worse than a moment of nothing.
    if (loading) return null;

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
            className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scroll-smooth"
            // The rail scrolls independently of the page, so it is a focusable region with a name
            // rather than a silent overflow container a keyboard user cannot reach.
            tabIndex={0}
            aria-label="Games you are playing"
        >
            {playing.map((entry, index) => {
                const { game } = entry;
                const pending = isPending(game.id);

                return (
                    <li key={game.id} className="shrink-0 snap-start w-32 sm:w-36">
                        <Link
                            to={`/games/${game.id}`}
                            className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl"
                        >
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800 light:bg-slate-100 border border-slate-700/50 light:border-slate-200 group-hover:border-blue-500/60 transition-all duration-300 shadow-lg">
                                {game.coverImageUrl && (
                                    <img
                                        src={game.coverImageUrl}
                                        alt=""
                                        loading={index < 6 ? 'eager' : 'lazy'}
                                        className="w-full h-full object-cover"
                                    />
                                )}
                            </div>

                            <p className="mt-2 text-sm font-medium text-slate-200 light:text-slate-800 leading-snug line-clamp-2 group-hover:text-blue-400 light:group-hover:text-blue-600 transition-colors">
                                {game.title}
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
