import { apiFetch } from '@/lib/api';
import { type Placed, moveRefusal, planMove } from '@/lib/handOrder';

/** A game's position as it is to be shown: a sparse number, or null for never placed. */
export interface ShownPosition {
    gameId: number;
    position: number | null;
}

/**
 * What a provider hands `moveInHandOrder`: the list as it is shown, where to save, and its own locks and
 * actions. The provider owns the state; this owns the order of the steps.
 */
export interface HandOrderMove {
    /** The list in the order it is shown: every placed game first, in ascending order, then the unplaced. */
    ordered: readonly Placed[];
    /** The game being moved. */
    gameId: number;
    /** The game it is to follow, or null to put it first. */
    afterGameId: number | null;
    /** Where the positions are saved, as a `PATCH` of `{ positions: [{ gameId, position }] }`. */
    endpoint: string;
    /** Whether a game has a write of its own out, which a move that would write it does not overtake. */
    saving: (gameId: number) => boolean;
    /** The provider's per-game lock, taken for every game the move writes and released when it lands. */
    lock: (gameId: number) => void;
    unlock: (gameId: number) => void;
    /** Shows these positions: the move the moment it is made, and the values it replaced if it fails. */
    show: (positions: ShownPosition[]) => void;
    /** Says why the move did not happen: refused before it was sent, or sent and not saved. */
    fail: (message: string) => void;
    /** The move saved, so whatever the last one said can go. */
    saved: () => void;
    /** What `fail` is given when the save does not land. */
    failed: string;
}

/**
 * Moves a game in an order arranged by hand, optimistically: the backlog's move and the favourites', one
 * sequence with each provider's own state plugged in (ADR 0054 §5, ADR 0064 §4).
 *
 * Written once for the reason `useGameAxis` is: ADR 0022 records a guard that one provider had and the
 * other missed, twice, because review reads the diff and the other file is never in it. A step added
 * here is added to both orders.
 *
 * - `planMove` decides the writes: the moved game's, the unplaced games it passes, and only rarely a few
 *   neighbours'. A move to where the game already is writes nothing, and succeeds.
 * - A move that would write a game whose own save is out, or more positions than one write may carry, is
 *   refused with a reason and changes nothing.
 * - Every game written takes its lock before anything changes, and the move is shown at once.
 * - A save refused or never arrived puts back the position each written game had — a value, which the
 *   locks have kept true — and says so. The locks are released either way.
 *
 * Resolves whether the move happened, so that the control can say when it did not.
 */
export async function moveInHandOrder(move: HandOrderMove): Promise<boolean> {
    const writes = planMove(move.ordered, move.gameId, move.afterGameId);
    if (writes.length === 0) return true;

    const refusal = moveRefusal(writes, move.saving);
    if (refusal !== null) {
        move.fail(refusal);
        return false;
    }

    const before = new Map(move.ordered.map(item => [item.id, item.position]));
    const previous = writes.map(write => ({ gameId: write.id, position: before.get(write.id) ?? null }));
    const next = writes.map(write => ({ gameId: write.id, position: write.position }));

    for (const write of writes) move.lock(write.id);
    move.show(next);

    const undo = () => {
        move.show(previous);
        move.fail(move.failed);
    };

    try {
        const res = await apiFetch(move.endpoint, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positions: next }),
        });

        if (!res.ok) {
            undo();
            return false;
        }
        move.saved();
        return true;
    } catch {
        // A request that never arrived, which `fetch` reports by rejecting rather than with a status.
        undo();
        return false;
    } finally {
        for (const write of writes) move.unlock(write.id);
    }
}
