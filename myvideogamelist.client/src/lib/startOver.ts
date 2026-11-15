import { apiFetch, problemMessage } from '@/lib/api';
import { formatCountOf } from '@/lib/format';

/**
 * What a start over took, as `DELETE /api/user/library` counted it (ADR 0095).
 */
export interface StartOverResult {
    /** Games that left the library, each with its list, score, playthroughs, review and tags. */
    games: number;
    wishlist: number;
    favourites: number;
    /**
     * Rows of imports still waiting for review that were skipped only because their game was in the
     * library, and are selected to import again now that it is not.
     */
    importRowsReselected: number;
}

const FAILED = 'Your library could not be emptied. Please try again.';

const UNCERTAIN = 'We could not tell whether your library was emptied: the answer never arrived. '
    + 'Your lists have been read again, so look at them before you try again.';

/**
 * A start over whose outcome is not known: sent, and never answered in a way that says what happened.
 * The request may have reached the API and committed before the connection went, so whoever catches
 * this reads the library again rather than trusting what it holds.
 */
export class StartOverUncertainError extends Error {
    constructor() {
        super(UNCERTAIN);
        this.name = 'StartOverUncertainError';
    }
}

/**
 * Empties the signed-in account's library and keeps the account.
 *
 * @throws With a sentence for the user: the server's own where it refused — "Password is incorrect."
 * is the usual — and otherwise one saying it did not happen. A `StartOverUncertainError` when no
 * readable answer arrived, which is not the same as a refusal.
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
        throw new StartOverUncertainError();
    }

    if (!response.ok) throw new Error(await problemMessage(response, FAILED));

    // A 2xx is a start over that happened. Its counts not arriving does not undo it.
    try {
        return await response.json() as StartOverResult;
    } catch {
        throw new StartOverUncertainError();
    }
}

/**
 * What the card says once a start over is done: what went, and what it did to any import waiting for
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

    // No count: the server counts rows, which can be spread over several imports and name a game
    // twice, so a number here would say more than it knows.
    return importRowsReselected === 0
        ? said
        : `${said} In any import waiting for your review, the games you had are selected to import again.`;
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
    return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
