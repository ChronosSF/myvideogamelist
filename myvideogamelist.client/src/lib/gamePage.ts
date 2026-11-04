import { useOutletContext } from 'react-router';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import type { CommunityScores } from '@/types/community';
import type { GameDto } from '@/types/game';

/**
 * What the game page hands its two tabs (ADR 0084): the game the loader read, and what the page reads
 * once for both — the members' view of the game, which the hero's badge shares, and the reader.
 */
export interface GamePageOutlet {
    game: GameDto;
    /** The members' score: the loader's until the browser's own request answers, then that one. */
    memberScores: CommunityScores | null;
    community: UseGameCommunityResult;
    /** The signed-in reader's handle, or null signed out and while auth has not answered. */
    viewer: string | null;
    /** Auth has not answered: the server render, and the first in the browser. */
    authLoading: boolean;
    /** The reader's own favourites, to mark them on the rails (ADR 0064). Empty until they arrive. */
    isFavourite: (gameId: number) => boolean;
}

export function useGamePage(): GamePageOutlet {
    return useOutletContext<GamePageOutlet>();
}
