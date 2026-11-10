/** The account and token a confirmation link carries after its `#` (ADR 0089). */
export interface ConfirmationLink {
    userId: string;
    token: string;
}

/**
 * The two halves of a confirmation link, from a fragment such as `#user=…&token=…`, decoded, or null
 * when either is missing. The API builds the fragment with `Uri.EscapeDataString`, which a
 * `URLSearchParams` reads back exactly: a `+` in a token arrives escaped, never as a space.
 */
export function linkIn(fragment: string): ConfirmationLink | null {
    const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
    const userId = params.get('user');
    const token = params.get('token');
    return userId && token ? { userId, token } : null;
}
