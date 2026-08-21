import { useCallback, useSyncExternalStore } from 'react';

/**
 * A set of numbers persisted in localStorage, read through useSyncExternalStore so it
 * behaves correctly under SSR.
 *
 * Reading localStorage in a render or a state initializer breaks server rendering; reading
 * it in an effect works but commits a throwaway render first. useSyncExternalStore is the
 * built-in answer: the server snapshot is empty, the client snapshot is the stored value,
 * and React reconciles the difference during hydration without a mismatch warning.
 */

const EMPTY: ReadonlySet<number> = new Set<number>();

const listeners = new Set<() => void>();

/** Caches the parsed value per key so getSnapshot returns a stable reference. */
const cache = new Map<string, { raw: string | null; value: ReadonlySet<number> }>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // Also react to writes from other tabs.
    window.addEventListener('storage', listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', listener);
    };
}

function read(key: string): ReadonlySet<number> {
    let raw: string | null;
    try {
        raw = localStorage.getItem(key);
    } catch {
        // Private mode, or storage disabled.
        return EMPTY;
    }

    // useSyncExternalStore compares snapshots by identity, so an unchanged
    // string must yield the very same Set instance or React will loop.
    const cached = cache.get(key);
    if (cached && cached.raw === raw) return cached.value;

    let value: ReadonlySet<number> = EMPTY;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                value = new Set(parsed.filter((x): x is number => typeof x === 'number'));
            }
        } catch { /* malformed entry - fall back to empty */ }
    }

    cache.set(key, { raw, value });
    return value;
}

export function useStoredNumberSet(
    key: string,
): readonly [ReadonlySet<number>, (next: ReadonlySet<number>) => void] {
    const value = useSyncExternalStore(
        subscribe,
        () => read(key),
        () => EMPTY,
    );

    const setValue = useCallback((next: ReadonlySet<number>) => {
        try {
            localStorage.setItem(key, JSON.stringify([...next]));
        } catch { /* ignore - the preference is a convenience, not critical state */ }
        cache.delete(key);
        listeners.forEach(listener => listener());
    }, [key]);

    return [value, setValue] as const;
}
