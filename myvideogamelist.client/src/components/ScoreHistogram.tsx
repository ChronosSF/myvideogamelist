import type { ScoreStats } from '@/types/stats';
import { MAX_SCORE } from '@/lib/score';

interface ScoreHistogramProps {
    scores: ScoreStats;
    /**
     * Whose scores these are, when they are not the reader's own — the profile's `userName`.
     * Undefined on the signed-in user's own page, which is the only one that may say "you".
     */
    owner?: string;
}

/**
 * How somebody spreads their own scores, as ten columns.
 *
 * On the 1–10 scale and never as a percentage or as stars: a percentage in this app means a score
 * averaged from other people, and stars are the input control (ADR 0021). A mean of the user's own
 * scores is neither, so it is printed plainly against the scale it was entered on.
 *
 * Shared between the owner's own profile and a public one, as `StatusBreakdown` is, so that one
 * library cannot be drawn two different ways. Only the words differ, and `owner` is what keeps
 * them honest: an empty column on a stranger's profile is not the reader's to fill, so a visitor
 * must never be told to go and rate a game.
 */
export function ScoreHistogram({ scores, owner }: ScoreHistogramProps) {
    if (scores.scored === 0) {
        return (
            <p className="profile-empty">
                {owner === undefined
                    ? 'No scores yet. Rate a game and this fills in.'
                    : `${owner} has not scored anything yet.`}
            </p>
        );
    }

    const tallest = Math.max(...scores.distribution);
    const scale = `scores, from 1 to ${MAX_SCORE}`;
    const label = owner === undefined ? `Your ${scale}` : `${owner}'s ${scale}`;

    return (
        <div>
            <ol className="profile-histogram" aria-label={label}>
                {scores.distribution.map((count, index) => {
                    const score = index + 1;
                    // A non-zero column always gets a visible sliver, or a lone 1 next to a tall
                    // column renders as nothing and reads as "never used".
                    const height = count === 0 ? 0 : Math.max(6, (count / tallest) * 100);

                    return (
                        <li key={score} className="profile-histogram-column">
                            <span
                                className={`profile-histogram-bar${count === 0 ? ' empty' : ''}`}
                                style={{ height: `${height}%` }}
                                aria-hidden="true"
                            />
                            <span className="profile-histogram-tick" aria-hidden="true">{score}</span>
                            <span className="sr-only">
                                {`${score} out of ${MAX_SCORE}: ${count} ${count === 1 ? 'game' : 'games'}`}
                            </span>
                        </li>
                    );
                })}
            </ol>

            <p className="profile-caption">
                {scores.mean === null
                    ? null
                    : `Mean ${scores.mean.toFixed(1)} out of ${MAX_SCORE}, over ${scores.scored} scored ${scores.scored === 1 ? 'game' : 'games'}.`}
            </p>
        </div>
    );
}
