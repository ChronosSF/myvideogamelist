/**
 * The geometry behind `useReorder`, kept apart as pure functions so it can be tested without a layout
 * engine: jsdom measures every element as a zero-sized box at the origin.
 */

/** A box, in the coordinates of the list's container. */
export interface Slot {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** `items` with the one at `from` taken out and put back at `to`. */
export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

/**
 * The slot a point is over, or the nearest one when it is over none — in a gap between two, or past
 * either end of the list. The first of two equally near wins, so the answer never flickers between
 * them.
 *
 * Measured against where the slots were when the drag began, not where the items are drawn now. The
 * item being moved is drawn in the slot it would land in, so its neighbours shift as it goes; judged
 * against the shifting layout, the slot under the pointer would change because the pointer moved the
 * layout, and the item would jump back and forth between two slots on the spot.
 */
export function nearestSlot(slots: readonly Slot[], x: number, y: number): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    slots.forEach((slot, index) => {
        const dx = Math.max(slot.left - x, 0, x - slot.right);
        const dy = Math.max(slot.top - y, 0, y - slot.bottom);
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });

    return best;
}

/**
 * How many slots sit in the first row, which is how far Up and Down move a game in a grid. A list of
 * rows is one to a row, so the arrows all move by one. So is a layout that fits on a single row — a
 * rail of covers, or a grid with fewer games than columns — where Up and Down would otherwise jump
 * straight to either end.
 */
export function rowLength(slots: readonly Slot[]): number {
    if (slots.length === 0) return 1;

    // Within a pixel, for a row whose boxes are a fraction apart once zoomed.
    const top = slots[0].top;
    const inFirstRow = slots.filter(slot => Math.abs(slot.top - top) < 1).length;
    return inFirstRow >= slots.length ? 1 : inFirstRow;
}
