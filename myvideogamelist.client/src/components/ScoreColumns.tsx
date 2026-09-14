import { MAX_SCORE } from '@/lib/score';
import './ScoreColumns.css';

interface ScoreColumnsProps {
    /** Ten counts; index 0 is the count of 1s. */
    distribution: number[];
    /** The list's accessible name, which has to say whose scores these are. */
    label: string;
    /** What one column counts, so each can be read out as "8 out of 10: 3 games". */
    unit: { one: string; other: string };
}

/**
 * Ten columns, one per score on the 1–10 scale scores are entered on.
 *
 * Drawn the same way for one person's scores on a profile and for every member's on a game page,
 * so a distribution cannot look like two different things in two places. The scale is labelled
 * plainly, never as stars — stars are the input control (ADR 0021) — and never as percentages,
 * because a column is a count of individual scores rather than an average of anything.
 */
export function ScoreColumns({ distribution, label, unit }: ScoreColumnsProps) {
    const tallest = Math.max(...distribution);

    return (
        <ol className="score-columns" aria-label={label}>
            {distribution.map((count, index) => {
                const score = index + 1;
                // A non-zero column always gets a visible sliver, or a lone 1 next to a tall column
                // renders as nothing and reads as "never used".
                const height = count === 0 ? 0 : Math.max(6, (count / tallest) * 100);

                return (
                    <li key={score} className="score-columns-column">
                        <span
                            className={`score-columns-bar${count === 0 ? ' empty' : ''}`}
                            style={{ height: `${height}%` }}
                            aria-hidden="true"
                        />
                        <span className="score-columns-tick" aria-hidden="true">{score}</span>
                        <span className="sr-only">
                            {`${score} out of ${MAX_SCORE}: ${count} ${count === 1 ? unit.one : unit.other}`}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}
