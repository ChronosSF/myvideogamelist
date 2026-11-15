import { useCallback, useSyncExternalStore } from 'react';
import type { ListsPending } from '@/contexts/ListsContext';
import { useLists } from '@/hooks/useLists';

/**
 * Whether a write of this game is out, in these locks. Draws its component again when this game's lock is
 * taken or released, and for no other game's (`docs/decisions/0086-*`).
 *
 * For a component handed the locks, which must not read the lists context: a memoised row or tile of the
 * lists page, which that context would draw again for every save of any game. Anything that reads the
 * lists anyway reads `useListPending`.
 */
export function usePendingIn(locks: ListsPending, gameId: number): boolean {
    const read = () => locks.current().has(gameId);
    return useSyncExternalStore(locks.subscribe, read, read);
}

/** Whether a write of this game is out: the lists provider's per-game lock. */
export function useListPending(gameId: number): boolean {
    return usePendingIn(useLists().pending, gameId);
}

/**
 * Whether a write of a game is out, for a component that shows more than one game's lock. Draws it again
 * whenever any lock is taken or released, so a component that draws one game reads `useListPending`, and a
 * list of games gives each game a component of its own that reads `usePendingIn`.
 *
 * Like the others, one render behind the lists: never decide from it which game to keep on screen.
 */
export function useListsPending(): (gameId: number) => boolean {
    const { pending } = useLists();
    const locked = useSyncExternalStore(pending.subscribe, pending.current, pending.current);
    return useCallback((gameId: number) => locked.has(gameId), [locked]);
}
