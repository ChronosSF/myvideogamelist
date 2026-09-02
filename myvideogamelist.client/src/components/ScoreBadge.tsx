import { aggregateTitle, scoreBandSolid, scoreBandSubtle, scoreBandTint } from '@/lib/score';

export type AggregateKind = 'critics' | 'players';

interface ScoreBadgeProps {
    /** Already on the 0-100 scale — pass IGDB's player rating through `ratingPercent` first. */
    percent: number;
    /** How many reviews or ratings it averages, or null when the API did not say. */
    count: number | null;
    kind: AggregateKind;
    /**
     * `square` for the corner of a cover, where the badge has to punch through artwork; `pill`
     * for a row of metadata, where there is room for the word as well; `plain` for a table cell,
     * where a filled badge in two columns of every row would read as decoration, not data.
     */
    variant?: 'square' | 'pill' | 'plain';
}

/**
 * A score somebody else produced.
 *
 * Both aggregates — the critic average and IGDB's player rating — go through this one component,
 * out of 100, because stars now mean exclusively "what this user thinks". Having two visual
 * languages for one kind of number was the confusing part; see `docs/decisions/0021-*`.
 *
 * The visible number is hidden from assistive tech in favour of one `sr-only` sentence, since
 * "93" on its own says neither what it measures nor how many opinions are behind it.
 */
export function ScoreBadge({ percent, count, kind, variant = 'pill' }: ScoreBadgeProps) {
    const title = aggregateTitle(kind, percent, count);

    if (variant === 'plain') {
        return (
            <span className={`font-semibold ${scoreBandSubtle(percent)}`} title={title}>
                <span aria-hidden="true">{percent}</span>
                <span className="sr-only">{title}</span>
            </span>
        );
    }

    const shape = variant === 'square'
        ? `w-9 h-9 justify-center rounded-lg shadow-lg ${scoreBandSolid(percent)}`
        : `px-2 py-0.5 gap-1.5 rounded ${scoreBandTint(percent)}`;

    return (
        <span className={`inline-flex items-center text-xs font-bold ${shape}`} title={title}>
            <span aria-hidden="true">{percent}</span>
            {variant === 'pill' && (
                <span className="font-medium opacity-70" aria-hidden="true">{kind}</span>
            )}
            <span className="sr-only">{title}</span>
        </span>
    );
}
