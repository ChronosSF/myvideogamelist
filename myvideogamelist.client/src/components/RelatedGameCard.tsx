import type { RelatedGameDto } from '@/types/game';
import { useReleaseGame } from '@/hooks/useReleaseGame';
import { GameRefTile } from '@/components/GameRefTile';
import { ReleaseActions } from '@/components/ReleaseActions';

/** The kicker over a card that is not a game in its own right. */
const KIND_WORDS: Partial<Record<RelatedGameDto['kind'], string>> = {
    remake: 'Remake',
    remaster: 'Remaster',
    expanded: 'Expanded',
    port: 'Port',
    standalone: 'Standalone',
};

const CHECK = 'M5 13l4 4L19 7';

/** Seven across the page, from a column of 1,216 pixels; two and a bit on a phone. */
const COVER_SIZES = '(min-width: 40rem) calc(9rem - 2px), calc(8rem - 2px)';

interface RelatedGameCardProps {
    game: RelatedGameDto;
    /** The game the page is about, or the game it is an edition of: marked, and offered nothing, since the hero above offers it all. */
    anchor: boolean;
    /** Whether the page is about this game itself, rather than an edition of it. */
    self: boolean;
    /** In view before any scrolling, on a desktop: the rail is the first thing under the tabs. */
    eager: boolean;
}

/**
 * One game of the related games rail (issue 450): its cover and name, its year and what it is, and the reader's
 * side of it — the list it is in, or the two things every card on the site offers a game (ADR 0075): the
 * wishlist, and the Backlog for a game in none of the reader's lists.
 */
export function RelatedGameCard({ game, anchor, self, eager }: RelatedGameCardProps) {
    const state = useReleaseGame({ gameId: game.id, title: game.name, coverImageUrl: game.coverImageUrl, platforms: [] });
    const kind = KIND_WORDS[game.kind];

    return (
        <div>
            <GameRefTile
                game={game}
                favourite={state.favourite}
                linked={!self}
                sizes={COVER_SIZES}
                eager={eager}
                marked={anchor}
            />
            <p className="mt-1 type-meta text-fg-faint">
                {game.releaseYear ?? 'No date yet'}
                {kind && <> · {kind}</>}
            </p>
            {anchor ? (
                <p className="mt-1.5 type-kicker text-primary-400">{self ? 'This game' : 'Its original'}</p>
            ) : state.listName !== null ? (
                <p className="mt-1.5 type-meta text-primary-400 inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={CHECK} />
                    </svg>
                    {state.listName}
                </p>
            ) : (
                <ReleaseActions title={game.name} state={state} />
            )}
        </div>
    );
}
