import { createContext } from 'react';
import type { PlaythroughDto } from '@/types/playthrough';

/**
 * A playthrough the prompt wrote or tried to: the account it was for, the game, and the run as the server
 * answered it, or null when the server refused and the run is not known (ADR 0097).
 */
export interface PlaythroughWritten {
    session: string | null;
    gameId: number;
    playthrough: PlaythroughDto | null;
}

/**
 * Every playthrough the prompt writes, as it is written, for whoever holds a game's runs: the game page's
 * `GameEntryProvider`, whose list and hero line have to show a run started from the toast without a reload.
 */
export interface PlaythroughWrites {
    subscribe: (listener: (written: PlaythroughWritten) => void) => () => void;
}

export interface PlaythroughPromptContextValue {
    written: PlaythroughWrites;
}

/**
 * Outside the provider — a test that renders a page alone — nothing is ever written, so nothing is told.
 */
export const PlaythroughPromptContext = createContext<PlaythroughPromptContextValue>({
    written: { subscribe: () => () => {} },
});
