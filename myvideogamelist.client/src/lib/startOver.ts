import { apiFetch } from '@/lib/api';
import { formatCountOf } from '@/lib/format';

/**
 * What a start over took, as `DELETE /api/user/library` counted it (ADR 0095).
 */
export interface StartOverResult {
    /** Games that left the library, each with its list, score, playthroughs, review and tags. */
    games: number;
    wishlist: number;
    favourites: number;
    /** Status changes deleted from the history behind the statistics. */
    events: number;
    /**
     * Rows of an import still waiting for review that were skipped only because their game was in the
     * library, and are selected to import again now that it is not.
     */
    importRowsReselected: number;
}

const FAILED = 'Your library could not be emptied. Please try again.';

/**
 * Empties the signed-in account's library and keeps the account.
 *
 * @throws With a sentence for the user: the server's own where it gave one — "Password is incorrect."
 * is the usual — and otherwise one saying it did not happen. A request that never arrived rejects the
 * same way, so the dialog has one path.
 */
export async function startOver(password: string): Promise<StartOverResult> {
    let response: Response;
    try {
        response = await apiFetch('/api/user/library', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
    } catch {
        throw new Error(FAILED);
    }

    if (!response.ok) throw new Error(await refusal(response));
    return await response.json() as StartOverResult;
}

/**
 * The sentence in a refusal's body: `message` on the password's own 401, `detail` or `title` on a
 * `ProblemDetails`. A body that is not JSON, or says nothing, is the fallback.
 */
async function refusal(response: Response): Promise<string> {
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return FAILED;
    }

    if (typeof body !== 'object' || body === null) return FAILED;
    const { message, detail, title } = body as Record<string, unknown>;
    for (const candidate of [message, detail, title]) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
    return FAILED;
}

/**
 * What the card says once a start over is done: what went, and what it did to an import waiting for
 * review, since that is where somebody starting over goes next.
 */
export function startOverSummary({ games, wishlist, favourites, importRowsReselected }: StartOverResult): string {
    const removed = [
        games > 0 ? formatCountOf(games, 'game', 'games') : null,
        wishlist > 0 ? formatCountOf(wishlist, 'wishlisted game', 'wishlisted games') : null,
        favourites > 0 ? formatCountOf(favourites, 'favourite', 'favourites') : null,
    ].filter((part): part is string => part !== null);

    const said = removed.length === 0
        ? 'Your library was already empty.'
        : `Your library is empty: ${listed(removed)} removed.`;

    if (importRowsReselected === 0) return said;

    const reselected = formatCountOf(importRowsReselected, 'game', 'games');
    const verb = importRowsReselected === 1 ? 'is' : 'are';
    return `${said} In the import waiting for your review, the ${reselected} you had ${verb} selected to import again.`;
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
    return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
