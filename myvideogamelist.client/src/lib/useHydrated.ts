import { useSyncExternalStore } from 'react';

/** Never fires: the value is constant per environment, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};

/**
 * False during the server render and the hydrating client render, true afterwards.
 *
 * Use it to gate anything whose output depends on the current time, the user's locale or their
 * timezone. Rendering such a value directly produces a hydration mismatch, because the server
 * and the browser do not agree on any of the three — a "Today" computed on a server in UTC
 * becomes "Yesterday" for a reader several timezones west.
 *
 * `useSyncExternalStore` is the SSR-safe way to express this: React calls `getServerSnapshot`
 * for both the server render and hydration, then `getSnapshot` for every render after, so the
 * two passes agree and the switch happens in a separate, deliberate commit. The obvious
 * alternative — `useState(false)` plus an effect that sets it true — is what
 * `react-hooks/set-state-in-effect` exists to reject.
 */
export function useHydrated(): boolean {
    return useSyncExternalStore(
        noopSubscribe,
        () => true,
        () => false);
}
