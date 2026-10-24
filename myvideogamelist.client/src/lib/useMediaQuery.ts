import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept current as the window changes.
 *
 * False during the server render and the hydrating client render, which know no viewport — the same
 * two-pass shape as `useHydrated`, so a layout decision made on it never fails hydration. Anything
 * the reader sees before the first client commit has to be right under CSS alone.
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback((onChange: () => void) => {
        const list = window.matchMedia(query);
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
    }, [query]);

    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(query).matches,
        () => false);
}
