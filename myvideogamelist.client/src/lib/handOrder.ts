/**
 * The arithmetic behind an order arranged by hand: the backlog's "what I will play next", and any
 * list ordered the same way after it (`docs/decisions/0054-*`).
 *
 * A position is a sparse number, not an index. They are handed out `POSITION_STEP` apart, and a game
 * moves by taking a number between its new neighbours', so a move is normally one row written. Only
 * when two neighbours have no number left between them are a few of the games around the spot spread
 * out again, and those rows are written too. A game never placed has no position: placed games come
 * first in ascending order, and the unplaced follow in whatever order the list's own comparator gives
 * them — the order they joined it, for the backlog.
 *
 * The client computes every number and the server stores what it is sent, within the bounds below,
 * which are the server's `HandOrder` constants restated: a value outside them is refused with a 400.
 */

/** The gap between positions handed out in a run, and the step past the first or the last. */
export const POSITION_STEP = 1024;

/** The server's `HandOrder.MinPosition`. Nothing here produces a number below it. */
export const MIN_POSITION = -1_000_000_000;

/** The server's `HandOrder.MaxPosition`. Nothing here produces a number above it. */
export const MAX_POSITION = 1_000_000_000;

/**
 * The server's `HandOrder.MaxWrites`: the most positions one write may carry. Only a first drop deep
 * into a list of more unplaced games than this could plan a longer one, and the caller refuses that
 * move rather than send a write the server would refuse with a 400.
 */
export const MAX_POSITION_WRITES = 10_000;

/**
 * The smallest gap a spread leaves between two games. Room for a few more halvings at the same spot
 * before the next spread, and small enough that a spread rarely has to reach far to find it.
 */
const SPREAD_GAP = 64;

/** One game in a hand order: its id, and its position or null when it was never placed. */
export interface Placed {
    id: number;
    position: number | null;
}

/** A position to write. */
export interface PositionWrite {
    id: number;
    position: number;
}

/**
 * The positions to write so that `movedId` sits immediately after `afterId` — or first, when that is
 * null — in a list held in hand order: every placed game in ascending order, then the unplaced.
 *
 * Returns only what changes: the moved game always, the unplaced games it passes when it lands among
 * them, and the neighbours a spread renumbers. Empty when the game would land where it already is,
 * and when either id is not in the list; either way there is nothing to write.
 */
export function planMove(ordered: readonly Placed[], movedId: number, afterId: number | null): PositionWrite[] {
    const from = ordered.findIndex(item => item.id === movedId);
    if (from === -1 || afterId === movedId) return [];

    const rest = ordered.filter(item => item.id !== movedId);
    const at = afterId === null ? 0 : rest.findIndex(item => item.id === afterId) + 1;

    // An anchor that is not in the list, and a move that ends where it began.
    if (afterId !== null && at === 0) return [];
    if (at === from) return [];

    const firstUnplaced = rest.findIndex(item => item.position === null);
    const placed = firstUnplaced === -1 ? rest.length : firstUnplaced;

    return at > placed
        ? intoTheUnplaced(rest, placed, at, movedId)
        : amongThePlaced(rest, placed, at, movedId);
}

/**
 * A landing among the unplaced games. They follow every placed one, so the moved game can only sit
 * after some of them if those are placed first: each takes the next step after the last placed
 * position, in the order shown, and the moved game the step after them. The unplaced games behind it
 * are left as they were.
 */
function intoTheUnplaced(rest: readonly Placed[], placed: number, at: number, movedId: number): PositionWrite[] {
    const start = placed === 0 ? 0 : rest[placed - 1].position! + POSITION_STEP;
    const ids = [...rest.slice(placed, at).map(item => item.id), movedId];
    const steps = ids.map((id, index) => ({ id, position: start + index * POSITION_STEP }));

    if (steps[steps.length - 1].position <= MAX_POSITION) return steps;

    // A list pushed to the top of the range by about a million moves to its end: every placed game,
    // these included, goes back across the whole of it instead.
    return spreadEvenly([...rest.slice(0, placed).map(item => item.id), ...ids], MIN_POSITION, MAX_POSITION, rest);
}

/**
 * A landing between two placed games, or before the first, or after the last of them: halfway between
 * the neighbours while there is a number between them, a step past the end when one side is open, and
 * a spread of the games around the spot when the neighbours have run out of room.
 */
function amongThePlaced(rest: readonly Placed[], placed: number, at: number, movedId: number): PositionWrite[] {
    const left = at > 0 ? rest[at - 1].position! : null;
    const right = at < placed ? rest[at].position! : null;

    if (left === null && right === null) return [{ id: movedId, position: 0 }];

    if (left === null) {
        const position = right! - POSITION_STEP;
        if (position >= MIN_POSITION) return [{ id: movedId, position }];
    } else if (right === null) {
        const position = left + POSITION_STEP;
        if (position <= MAX_POSITION) return [{ id: movedId, position }];
    } else if (right - left >= 2) {
        return [{ id: movedId, position: left + Math.floor((right - left) / 2) }];
    }

    return spreadAround(rest, placed, at, movedId);
}

/**
 * Makes room at `at` by renumbering the fewest placed games around it.
 *
 * The window starts as the two neighbours with no room between them and widens by a game on each side
 * until the games just outside it are far enough apart for everything inside, the moved game included,
 * to sit `SPREAD_GAP` apart — or until it reaches the first or the last placed game, past which there
 * is a whole step of room for each. So a crowded spot costs a few rows, not the list.
 */
function spreadAround(rest: readonly Placed[], placed: number, at: number, movedId: number): PositionWrite[] {
    let lo = at;
    let hi = at;

    for (;;) {
        if (lo > 0) lo--;
        if (hi < placed) hi++;

        const ids = [
            ...rest.slice(lo, at).map(item => item.id),
            movedId,
            ...rest.slice(at, hi).map(item => item.id),
        ];
        const left = lo > 0 ? rest[lo - 1].position! : null;
        const right = hi < placed ? rest[hi].position! : null;

        if (left !== null && right !== null) {
            if (right - left >= SPREAD_GAP * (ids.length + 1)) return spreadEvenly(ids, left, right, rest);
            continue;
        }

        // An open side: step away from the side that is not, or from zero when the window is every
        // placed game.
        const steps = ids.map((id, index) => ({
            id,
            position: right !== null
                ? right - (ids.length - index) * POSITION_STEP
                : (left ?? -POSITION_STEP) + (index + 1) * POSITION_STEP,
        }));

        if (steps.every(step => step.position >= MIN_POSITION && step.position <= MAX_POSITION)) {
            return changed(steps, rest);
        }

        // About a million moves to one end of a list: every placed game back across the whole range.
        const all = rest.slice(0, placed).map(item => item.id);
        all.splice(at, 0, movedId);
        return spreadEvenly(all, MIN_POSITION, MAX_POSITION, rest);
    }
}

/** `ids`, in that order, spaced as evenly as fits strictly between `low` and `high`. */
function spreadEvenly(ids: readonly number[], low: number, high: number, rest: readonly Placed[]): PositionWrite[] {
    const gap = (high - low) / (ids.length + 1);
    return changed(ids.map((id, index) => ({ id, position: Math.round(low + gap * (index + 1)) })), rest);
}

/**
 * The writes that change something. The moved game is not in `rest`, so its own write always stays;
 * a neighbour's goes only if the spread gave it a different number.
 */
function changed(writes: readonly PositionWrite[], rest: readonly Placed[]): PositionWrite[] {
    const current = new Map(rest.map(item => [item.id, item.position]));
    return writes.filter(write => current.get(write.id) !== write.position);
}
