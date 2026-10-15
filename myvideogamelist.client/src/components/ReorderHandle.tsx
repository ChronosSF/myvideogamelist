import type { ReorderHandleProps } from '@/hooks/useReorder';
import './Reorder.css';

interface ReorderHandleComponentProps {
    /** From `useReorder`'s `handleProps`: the name, the instructions, and the gesture. */
    handle: ReorderHandleProps;
    /** Where the item stands, counted from one, as it is drawn now. */
    rank: number;
    /** `overlay` sits on a cover; `inline` sits in a table cell. */
    variant: 'overlay' | 'inline';
}

/**
 * The grip a game is moved by in a hand-arranged list, with its place in the order beside it.
 *
 * A real `<button>`, so it is in the tab order and Space and Enter reach it without a role or a
 * tabindex of its own. The number is drawn for the eye and hidden from assistive technology, which
 * hears the place in the announcement instead — read as part of the button's name it would be read on
 * every focus, and go stale the moment the game moved.
 */
export function ReorderHandle({ handle, rank, variant }: ReorderHandleComponentProps) {
    return (
        <button type="button" className={`reorder-handle reorder-handle-${variant}`} {...handle}>
            <svg className="reorder-grip" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
                <circle cx="2.5" cy="3" r="1.5" />
                <circle cx="7.5" cy="3" r="1.5" />
                <circle cx="2.5" cy="8" r="1.5" />
                <circle cx="7.5" cy="8" r="1.5" />
                <circle cx="2.5" cy="13" r="1.5" />
                <circle cx="7.5" cy="13" r="1.5" />
            </svg>
            <span className="reorder-rank" aria-hidden="true">{rank}</span>
        </button>
    );
}
