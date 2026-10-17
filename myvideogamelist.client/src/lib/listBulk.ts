import { formatCount } from '@/lib/format';

/**
 * The most games one bulk action may name: the server's `ListBatch.MaxGames`, restated here as
 * `MAX_POSITION_WRITES` restates the hand order's bound, so an action past it is refused with a reason
 * before anything moves rather than sent to be refused with a 400. Far past any list a person keeps.
 */
export const MAX_BULK_GAMES = 10_000;

/**
 * What the server did to one game of a bulk action — its `StatusChangeOutcomes`.
 *
 * - `moved`: it was not where it was asked to be, and now is, with an event recorded.
 * - `unchanged`: it already was — in that list, or for a removal in no list.
 * - `missing`: the account has no entry for it — deleted from another tab — so a move did not happen.
 *   The batch creates nothing. Never the answer to a removal.
 */
export type StatusChangeOutcome = 'moved' | 'unchanged' | 'missing';

/** One game's answer, as `PATCH /api/lists` sends it. */
export interface StatusChange {
    gameId: number;
    outcome: StatusChangeOutcome;
}

/**
 * How a bulk action ended, for the page to keep, announce and clear its selection by.
 *
 * - `refused`: nothing was sent and nothing changed; `message` is why, which the banner says too.
 * - `failed`: sent and not saved, refused or never arrived; every game is back where it was.
 * - `saved`: the server answered. `gameIds` are the games the action was about, all of them out of
 *   the list they were in: `moved` are where they were asked to be, and `missing` — the account has no
 *   entry for them any more — are in no list, as the server has them.
 */
export type BulkResult =
    | { outcome: 'refused'; message: string }
    | { outcome: 'failed'; gameIds: number[]; message: string }
    | { outcome: 'saved'; gameIds: number[]; moved: number[]; missing: number[] };

/**
 * The games a batch's answer says the account has no entry for. Anything that is not the answer's shape,
 * as a whole or in a result, says nothing: the request saved, which is what its status said, so a body
 * that cannot be trusted leaves every game where it was sent rather than putting back what the server
 * kept, or throwing a saved batch into the failure path.
 */
export function missingFrom(answer: unknown): Set<number> {
    const results = typeof answer === 'object' && answer !== null ? (answer as { results?: unknown }).results : null;
    if (!Array.isArray(results)) return new Set();

    const missing = new Set<number>();
    for (const result of results as unknown[]) {
        if (typeof result !== 'object' || result === null) continue;
        const { gameId, outcome } = result as { gameId?: unknown; outcome?: unknown };
        if (outcome === 'missing' && typeof gameId === 'number') missing.add(gameId);
    }
    return missing;
}

/** "1 game", "3 games", "1,204 games". */
export function gameCount(count: number): string {
    return `${formatCount(count)} ${count === 1 ? 'game' : 'games'}`;
}

/** The banner for a bulk action that was sent and not saved, whichever way it failed. */
export function bulkFailure(count: number, to: string | null): string {
    return to === null
        ? `Failed to take ${gameCount(count)} out of your lists. Please try again.`
        : `Failed to move ${gameCount(count)} to ${to}. Please try again.`;
}

/**
 * The banner for a move the server answered with games it has no entry for. They are shown in no list
 * now, as the server has them, and the sentence says why they vanished rather than moved.
 */
export function bulkMissing(missing: number, of: number): string {
    if (missing === of) {
        return of === 1
            ? 'That game was not moved: it is no longer in your lists.'
            : `None of the ${gameCount(of)} were moved: they are no longer in your lists.`;
    }
    return missing === 1
        ? `1 of the ${gameCount(of)} was not moved: it is no longer in your lists.`
        : `${formatCount(missing)} of the ${gameCount(of)} were not moved: they are no longer in your lists.`;
}

/**
 * What a screen reader is told once a bulk action has saved: the games that went where they were
 * sent. Nothing when none did — every one of them `missing` — since the banner says that, and an
 * announcement of nothing moved beside it would only repeat it.
 *
 * @param to The list they were moved to, by its owner's name, or null for a removal.
 * @param from The list they were in, by its owner's name.
 */
export function bulkDone(result: Extract<BulkResult, { outcome: 'saved' }>, to: string | null, from: string): string {
    const { gameIds, moved } = result;
    if (moved.length === 0) return '';

    if (to === null) return `Took ${gameCount(moved.length)} out of ${from}.`;
    return moved.length === gameIds.length
        ? `Moved ${gameCount(moved.length)} to ${to}.`
        : `Moved ${formatCount(moved.length)} of the ${gameCount(gameIds.length)} to ${to}.`;
}

/** Why a bulk action was refused before anything was sent, or null when it can go. */
export function bulkRefusal(gameIds: readonly number[], saving: (gameId: number) => boolean): string | null {
    if (gameIds.some(saving)) {
        return 'Another change to one of these games is still saving. Try again in a moment.';
    }
    if (gameIds.length > MAX_BULK_GAMES) {
        return `That is more than ${gameCount(MAX_BULK_GAMES)} at once. Select fewer and try again.`;
    }
    return null;
}
