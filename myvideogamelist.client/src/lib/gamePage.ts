import { useOutletContext } from 'react-router';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import type { CommunityScores } from '@/types/community';
import type { GameDto } from '@/types/game';

/**
 * What the game page hands its two tabs (ADR 0084): the game the loader read, and what the page reads
 * once for both — the members' view of the game, which the hero's badge shares. The reader and their
 * favourites each tab reads from the site's own providers.
 */
export interface GamePageOutlet {
    game: GameDto;
    /** The members' score: the loader's until the browser's own request answers, then that one. */
    memberScores: CommunityScores | null;
    community: UseGameCommunityResult;
}

export function useGamePage(): GamePageOutlet {
    return useOutletContext<GamePageOutlet>();
}
