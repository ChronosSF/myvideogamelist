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
    /**
     * Takes away whatever the toast is saying, a question or a report. For a write that empties the
     * library at once, Start over: no move is told for it, and a yes after it would start a run of a game
     * the reader has just cleared away, or a report's "Add details" would open a run that is gone.
     */
    clear: () => void;
}

/**
 * Outside the provider — a test that renders a page alone — nothing is ever written, so nothing is told,
 * and there is nothing to clear.
 */
export const PlaythroughPromptContext = createContext<PlaythroughPromptContextValue>({
    written: { subscribe: () => () => {} },
    clear: () => {},
});
