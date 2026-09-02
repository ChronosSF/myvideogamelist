import { Link } from 'react-router';
import { useLists } from '@/hooks/useLists';
import { useUserStats } from '@/hooks/useUserStats';
import { formatDate, formatHours, formatRate, tallyBy } from '@/lib/stats';
import { MAX_SCORE } from '@/lib/score';
import { LIST_IDS, LIST_NAMES } from '@/types/list';
import { ActivityChart } from './ActivityChart';
import { LibraryBreakdown } from './LibraryBreakdown';
import { ScoreHistogram } from './ScoreHistogram';
import { StatTile } from './StatTile';
import './ProfileStats.css';

/**
 * What the user has tracked and done, on their own profile.
 *
 * Two sources on purpose. The figures come from `/api/user/stats`, which reads only our own tables
 * and so keeps working when IGDB does not; the platform and genre breakdowns are counted from the
 * lists the app has already loaded, because they are the only part that needs game metadata. See
 * `docs/decisions/0023-*` — the point is that a third party being down costs two rows of this page
 * rather than all of it.
 */
export function ProfileStats() {
    const { stats, loading, error, reload } = useUserStats();
    const { lists, loading: listsLoading, error: listsError } = useLists();

    if (loading) {
        return (
            <section className="profile-stats" aria-busy="true">
                <h2 className="profile-heading">Your tracking</h2>
                <p className="profile-empty">Working out your numbers…</p>
            </section>
        );
    }

    if (error !== null || stats === null) {
        return (
            <section className="profile-stats">
                <h2 className="profile-heading">Your tracking</h2>
                <div className="profile-error" role="alert">
                    <p>{error ?? 'Failed to load your stats.'}</p>
                    <button type="button" className="profile-retry" onClick={reload}>
                        Try again
                    </button>
                </div>
            </section>
        );
    }

    const { library, scores, activity } = stats;

    // Nothing recorded and nothing ever moved. Distinct from "a quiet month": there is no history
    // to summarise, so a page of zeros would be noise where one sentence is the whole answer.
    if (library.recorded === 0 && activity.transitions === 0 && library.wishlisted === 0) {
        return (
            <section className="profile-stats">
                <h2 className="profile-heading">Your tracking</h2>
                <p className="profile-empty">
                    Nothing tracked yet. Add a game to a list and this page starts keeping score —
                    what you finish, how long it takes, and how you rate things.
                </p>
                <Link to="/games" className="profile-cta">Browse games</Link>
            </section>
        );
    }

    const tracked = library.tracked;
    const mostInAStatus = Math.max(1, ...LIST_IDS.map(id => library.byStatus[id]));

    return (
        <section className="profile-stats">
            <h2 className="profile-heading">Your tracking</h2>

            <div className="profile-tiles">
                <StatTile
                    label="games tracked"
                    value={String(tracked)}
                    hint={library.recorded === tracked
                        ? 'across your five lists'
                        : `across your five lists, ${library.recorded} recorded in all`}
                />
                <StatTile
                    label="completion rate"
                    value={library.completionRate === null ? null : formatRate(library.completionRate)}
                    hint={library.completionRate === null
                        ? 'nothing finished or dropped yet'
                        : 'of the games you have finished or dropped'}
                />
                <StatTile
                    label="mean score"
                    value={scores.mean === null ? null : `${scores.mean.toFixed(1)}`}
                    hint={scores.mean === null
                        ? 'no scores yet'
                        : `out of ${MAX_SCORE}, over ${scores.scored} ${scores.scored === 1 ? 'game' : 'games'}`}
                />
                <StatTile
                    label="month streak"
                    value={String(activity.currentStreakMonths)}
                    hint={activity.longestStreakMonths === 0
                        ? 'consecutive months finishing something'
                        : `consecutive months finishing something, best ${activity.longestStreakMonths}`}
                />
            </div>

            <section className="profile-section">
                <h3 className="profile-section-title">Where your games sit</h3>
                <ul className="profile-ranked">
                    {LIST_IDS.map(id => (
                        <li key={id} className="profile-ranked-row">
                            <span className="profile-ranked-name">{LIST_NAMES[id]}</span>
                            <span className="profile-ranked-track" aria-hidden="true">
                                <span
                                    className={`profile-ranked-fill status-${id}`}
                                    style={{ width: `${(library.byStatus[id] / mostInAStatus) * 100}%` }}
                                />
                            </span>
                            <span className="profile-ranked-count" aria-hidden="true">
                                {library.byStatus[id]}
                            </span>
                            <span className="sr-only">
                                {`${library.byStatus[id]} ${library.byStatus[id] === 1 ? 'game' : 'games'}`}
                            </span>
                        </li>
                    ))}
                </ul>
                <p className="profile-caption">
                    {/* Worth stating, because every other number here is exclusive and this one is not. */}
                    {library.wishlisted === 0
                        ? 'Your wishlist is empty. It is a separate axis, so a wishlisted game can also sit in one of these.'
                        : `Plus ${library.wishlisted} on your wishlist, which is a separate axis — a game can be on it and in a list at once.`}
                </p>
            </section>

            <section className="profile-section">
                <h3 className="profile-section-title">How you score</h3>
                <ScoreHistogram scores={scores} />
            </section>

            <section className="profile-section">
                <h3 className="profile-section-title">What you start and finish</h3>
                {activity.months.length === 0
                    ? <p className="profile-empty">No status changes recorded yet.</p>
                    : <ActivityChart months={activity.months} />}
                {activity.logStartedAt !== null && activity.months.length > 0 && (
                    <p className="profile-caption">
                        {`${activity.transitions} ${activity.transitions === 1 ? 'change' : 'changes'} recorded since `}
                        {formatDate(activity.logStartedAt)}
                        {'. Months before that are not shown, because nothing was being recorded then.'}
                    </p>
                )}
            </section>

            <section className="profile-section">
                <h3 className="profile-section-title">How long games take you</h3>
                {activity.timeToFinish === null ? (
                    <p className="profile-empty">
                        Play a game and mark it finished, and this measures how long it actually took.
                    </p>
                ) : (
                    <>
                        <p className="profile-figure">{formatHours(activity.timeToFinish.medianHours)}</p>
                        <p className="profile-caption">
                            {`Typical time from starting to finishing, over ${activity.timeToFinish.samples} ${activity.timeToFinish.samples === 1 ? 'game' : 'games'}. `}
                            {`Longest ${formatHours(activity.timeToFinish.longestHours)}. `}
                            {/* The distinction ADR 0018 exists to protect: a shelved game does not
                                bill the months it sat on the shelf. */}
                            Counts only the time a game spent in Playing, so shelving one does not
                            inflate it.
                        </p>
                    </>
                )}
            </section>

            {/* The metadata-dependent half. Its own loading and error states, so an IGDB outage
                takes these two rows and leaves every figure above them standing. */}
            {listsLoading ? (
                <p className="profile-empty">Loading your library breakdown…</p>
            ) : listsError !== null ? (
                <p className="profile-empty">
                    Your platform and genre breakdown needs game details, which failed to load.
                    The figures above come from your own data and are unaffected.
                </p>
            ) : (
                <div className="profile-columns">
                    <LibraryBreakdown
                        title="Most of your games are on"
                        items={tallyBy(lists, game => game.platforms)}
                        empty="No platforms recorded on the games in your lists."
                    />
                    <LibraryBreakdown
                        title="And they tend to be"
                        items={tallyBy(lists, game => game.genres)}
                        empty="No genres recorded on the games in your lists."
                    />
                </div>
            )}
        </section>
    );
}
