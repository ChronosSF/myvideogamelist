import { useContext } from 'react';
import { GameEntryContext, type GameEntryContextValue } from '@/contexts/GameEntryContext';

/**
 * The signed-in reader's entry for the game on the page, or null where there is none to read: signed
 * out, or before auth has answered. The game page mounts `GameEntryProvider` only for a signed-in
 * reader, so a caller draws its signed-out form on null rather than throwing.
 */
export function useGameEntry(): GameEntryContextValue | null {
    return useContext(GameEntryContext);
}
