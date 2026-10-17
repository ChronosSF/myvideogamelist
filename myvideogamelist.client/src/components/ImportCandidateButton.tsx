import { useId } from 'react';
import { GameCover } from '@/components/GameCover';
import { ScoreBadge } from '@/components/ScoreBadge';
import { formatCount } from '@/lib/format';
import { releaseYear } from '@/lib/releaseDate';
import { hasCriticScore } from '@/lib/score';
import type { GameDto } from '@/types/game';

/**
 * One game offered for a row of an import, as something to recognise and press.
 *
 * Both ways a row gets its game go through this: a candidate the matcher offered (§M3) and a result
 * of the row's own search (§M4). §M3 shows cover art and year so that a row is resolved by
 * recognising a game rather than by reading one, and issue 158 asks that a searched result be chosen
 * the same way, so it reads the same and is pressed the same.
 *
 * Named rather than left to its own text: a row of buttons each reading "Resident Evil 2 (1998)"
 * says what they are and not what pressing one does. The visible title is inside the name, so
 * "click Resident Evil 2" still works by voice, and the critic score is the button's description
 * rather than part of its name.
 */
export function ImportCandidateButton({ game, onChoose }: { game: GameDto; onChoose: () => void }) {
    const year = game.releaseDate === null ? null : releaseYear(game.releaseDate);
    const criticsId = useId();

    return (
        <button
            type="button"
            aria-label={`Use ${game.title}${year === null ? '' : ` (${year})`}`}
            aria-describedby={criticsId}
            onClick={onChoose}
            className="flex items-center gap-2 pl-1 pr-2.5 py-1 bg-page/60 border border-line-strong hover:border-primary-500 rounded-lg text-left transition-colors"
        >
            <GameCover url={game.coverImageUrl} className="w-6 h-8" />
            <span className="flex flex-col items-start gap-0.5">
                <span className="text-xs text-fg font-medium">
                    {game.title}
                    {year !== null && (
                        <span className="text-fg-faint font-normal">{' '}({year})</span>
                    )}
                </span>
                <CriticScore game={game} id={criticsId} />
            </span>
        </button>
    );
}

/**
 * The critic score once it rests on `MIN_CRITIC_REVIEWS` reviews, or a dash with the count when it
 * rests on fewer: a score is never shown without its sample (ADR 0016). A search carries no floor
 * (ADR 0032), so its results reach games one critic loved — a lone 100 is a dash here. A bare dash
 * would read as "no score" where the truth is often "a score from too few reviews to mean
 * anything", so the count is said beside it.
 *
 * It is not what tells a release from its stubs: that is how many people rate a row (ADR 0040,
 * decision 3), and older canonical releases often have no critic reviews at all.
 */
function CriticScore({ game, id }: { game: GameDto; id: string }) {
    if (hasCriticScore(game)) {
        return (
            <span id={id}>
                <ScoreBadge kind="critics" percent={game.criticScore!} count={game.criticScoreCount} />
            </span>
        );
    }

    const count = game.criticScoreCount ?? 0;
    const reviews = `${formatCount(count)} critic ${count === 1 ? 'review' : 'reviews'}`;

    return (
        <span id={id} className="text-[11px] text-fg-muted">
            <span aria-hidden="true">— {count === 0 ? 'no critic reviews' : reviews}</span>
            <span className="sr-only">
                {count === 0 ? 'No critic reviews' : `Too few critic reviews to score: ${formatCount(count)}`}
            </span>
        </span>
    );
}
