import { useSyncExternalStore } from 'react';

/**
 * The account and token an email's link carries after its `#`: the confirmation's (ADR 0089) and the
 * password reset's (ADR 0090), which are built alike.
 */
export interface AccountLink {
    userId: string;
    token: string;
}

/**
 * The two halves of an email's link, from a fragment such as `#user=…&token=…`, decoded, or null when
 * either is missing. The API builds the fragment with `Uri.EscapeDataString`, which a `URLSearchParams`
 * reads back exactly: a `+` in a token arrives escaped, never as a space.
 */
export function linkIn(fragment: string): AccountLink | null {
    const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
    const userId = params.get('user');
    const token = params.get('token');
    return userId && token ? { userId, token } : null;
}

/**
 * A new fragment on this same page: a second link opened in the tab, which a browser follows without
 * loading the page again. A page's own removal of the fragment raises no such event.
 */
function subscribeToFragment(onChange: () => void) {
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
}

/**
 * The fragment as the browser has it, and null during the server render and hydration, which never
 * see it: a browser does not send what follows the `#`.
 */
export function useFragment(): string | null {
    return useSyncExternalStore(subscribeToFragment, () => window.location.hash, () => null);
}

/** Takes the fragment out of the address bar and the history, leaving the page where it is. */
export function forgetFragment() {
    window.history.replaceState(window.history.state, '', window.location.pathname);
}
