import type { ScoreStats } from '@/types/stats';
import { MAX_SCORE } from '@/lib/score';

/**
 * How the user spreads their own scores, as ten columns.
 *
 * On the 1–10 scale and never as a percentage or as stars: a percentage in this app means a score
 * averaged from other people, and stars are the input control (ADR 0021). A mean of the user's own
 * scores is neither, so it is printed plainly against the scale it was entered on.
 */
export function ScoreHistogram({ scores }: { scores: ScoreStats }) {
    if (scores.scored === 0) {
        return (
            <p className="profile-empty">
                No scores yet. Rate a game and this fills in.
            </p>
        );
    }

    const tallest = Math.max(...scores.distribution);

    return (
        <div>
            <ol className="profile-histogram" aria-label="Your scores, from 1 to 10">
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
