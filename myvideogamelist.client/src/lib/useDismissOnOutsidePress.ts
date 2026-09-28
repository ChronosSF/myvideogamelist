import { useRef, type MouseEvent, type MouseEventHandler } from 'react';

/** Props for the element that surrounds a dialog's panel. Spread them on it. */
export interface OutsidePressProps {
    onMouseDown: MouseEventHandler<HTMLElement>;
    onMouseUp: MouseEventHandler<HTMLElement>;
}

/** A `click` is primary-button only; `mousedown` and `mouseup` are not, so the check is ours. */
const PRIMARY_BUTTON = 0;

/**
 * True when the press landed on the surrounding element itself rather than on the panel inside it.
 * That identity check is what "outside" means here, so the surrounding element must have nothing in
 * it but the panel: a positioned overlay's padding is its own, and a native modal's backdrop is
 * delivered to the `<dialog>` element.
 */
function isOutside(event: MouseEvent<HTMLElement>): boolean {
    return event.target === event.currentTarget;
}

/**
 * Dismissal by a press outside the dialog, where *both* the press and the release have to be
 * outside it.
 *
 * `click` cannot express that. The DOM fires it at the nearest common ancestor of the mousedown and
 * the mouseup targets, so swipe-selecting the contents of a field and letting go past the dialog's
 * edge lands one on the surrounding element — with `target` set to it, as though the dialog had been
 * clicked beside. That dismissed the dialog mid-selection, which is what this hook exists to stop; a
 * panel that stops the click propagating does not help, because the click never reaches the panel.
 * So the two halves are watched separately and neither alone closes anything.
 *
 * It fits a positioned overlay and a native modal `<dialog>` alike — both deliver an outside press
 * to the element the panel sits in — which is why this is a hook rather than a shared overlay
 * component: the confirmation dialogs could not use the latter.
 *
 * Nothing here handles Escape. A native `<dialog>` gets it from the browser; an overlay marked
 * `aria-modal` does not, and that is a gap in those dialogs rather than in this hook.
 */
export function useDismissOnOutsidePress(onDismiss: () => void): OutsidePressProps {
    // A ref, not state: the press is in flight, nothing renders differently for it, and the mouseup
    // that reads it has to see the write from the mousedown that preceded it.
    const pressedOutside = useRef(false);

    return {
        onMouseDown: event => {
            pressedOutside.current = event.button === PRIMARY_BUTTON && isOutside(event);
        },
        onMouseUp: event => {
            const dismiss =
                pressedOutside.current && event.button === PRIMARY_BUTTON && isOutside(event);
            // Cleared either way, so a release with no press of ours behind it — the second half of
            // a drag that began before this dialog opened — cannot close it.
            pressedOutside.current = false;
            if (dismiss) onDismiss();
        },
    };
}
