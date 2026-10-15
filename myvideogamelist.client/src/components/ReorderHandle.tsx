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
 * A game's place in a hand-arranged list, and the grip it is moved by.
 *
 * The grip is a real `<button>`, so it is in the tab order and Space, Enter and a screen reader's own
 * "activate" all reach it without a role or a tabindex of its own. Its only content is the icon, so the
 * name it is given — "Move {title}" — is the whole of its label, and speech input can use it.
 *
 * The place is text beside the button rather than inside it: read as part of the item it says where
 * the game stands, as the Order column's value in the table, without being a label that goes stale the
 * moment the game moves.
 */
export function ReorderHandle({ handle, rank, variant }: ReorderHandleComponentProps) {
    return (
        <span className={`reorder-handle reorder-handle-${variant}`}>
            <span className="reorder-rank">{rank}</span>
            <button type="button" className="reorder-grip" {...handle}>
                <svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
                    <circle cx="2.5" cy="3" r="1.5" />
                    <circle cx="7.5" cy="3" r="1.5" />
                    <circle cx="2.5" cy="8" r="1.5" />
                    <circle cx="7.5" cy="8" r="1.5" />
                    <circle cx="2.5" cy="13" r="1.5" />
                    <circle cx="7.5" cy="13" r="1.5" />
                </svg>
            </button>
        </span>
    );
}
