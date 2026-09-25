import { fireEvent } from '@testing-library/react';

/**
 * The element a `click` is fired at when a press goes down on one element and comes up on another:
 * the nearest ancestor containing both. This is the DOM rule, and it is the reason a dialog cannot
 * decide from a `click` alone whether the press that produced it started inside.
 */
function nearestCommonAncestor(from: Element, to: Element): Element {
    let node: Element | null = from;
    while (node !== null && !node.contains(to)) node = node.parentElement;
    if (node === null) throw new Error('Those two elements share no ancestor.');
    return node;
}

/**
 * One press of the primary mouse button, going down on `from` and coming up on `to`, as a browser
 * delivers it: `mousedown` where it went down, `mouseup` where it came up, and then `click` at the
 * nearest common ancestor of the two.
 *
 * That third event is the whole point. Press inside a dialog's panel, release past its edge — which
 * is what selecting the contents of a field and dragging out looks like — and the click arrives at
 * the overlay reporting itself as a click on the overlay, indistinguishable from one beside the
 * dialog. Drive a dismissal test through this rather than `fireEvent.click`, or it tests the handler
 * against an event sequence no browser produces.
 *
 * `userEvent.pointer` is the other way to write it, but it decides for itself which element the
 * click lands on; here that decision is the thing under test.
 */
export function mousePress(from: Element, to: Element = from): void {
    fireEvent.mouseDown(from);
    fireEvent.mouseUp(to);
    fireEvent.click(nearestCommonAncestor(from, to));
}
