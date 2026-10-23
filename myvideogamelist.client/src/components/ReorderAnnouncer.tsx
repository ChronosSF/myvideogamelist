import type { Reorder } from '@/hooks/useReorder';

interface ReorderAnnouncerProps {
    reorder: Reorder;
}

/**
 * What a screen reader hears from a list being rearranged: the instructions every handle is
 * described by, and a live region that says what each key press and each drop did.
 *
 * Rendered once per list, and before any of its handles, so the region already exists when the first
 * announcement lands in it — a region added to the page with its text already in it is not announced.
 * Assertive, because the announcement is the only feedback a key press gets that is not visual.
 */
export function ReorderAnnouncer({ reorder }: ReorderAnnouncerProps) {
    return (
        <>
            <p id={reorder.instructionsId} hidden>
                Press Space or Enter to pick it up, then the arrow keys to move it, Home or End to send it
                to either end, and Space or Enter again to put it down. Escape puts it back. Or activate
                it, then another game&apos;s handle, to put it in that game&apos;s place.
            </p>
            <div className="sr-only" aria-live="assertive" aria-atomic="true">
                {reorder.announcement}
            </div>
        </>
    );
}
