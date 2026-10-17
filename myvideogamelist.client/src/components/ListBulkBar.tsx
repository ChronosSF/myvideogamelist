import { type Ref, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ListId } from '@/types/list';
import { gameCount } from '@/lib/listBulk';
import './ListBulkBar.css';

interface ListBulkBarProps {
    /** How many games are selected among the rows shown. */
    count: number;
    /** The list they are in, by the name its owner gave it. */
    listName: string;
    /** Every other list, by its owner's name for it: where the selected games can be moved. */
    targets: { id: ListId; name: string }[];
    /** What is being done to them while a bulk action is out, which takes the controls' place. */
    working: string | null;
    /**
     * Why the last action did not do all it was asked, said here as well as in the page's banner: the
     * banner is at the top of the page, and the bar is sticky precisely so it is in reach deep in a list,
     * where the rows coming back would otherwise be the only sign.
     */
    problem?: string | null;
    onMove: (listId: ListId) => void;
    onRemove: () => void;
    onClear: () => void;
    /**
     * The bar itself, which the page moves focus to before the control that had it goes away — the games
     * it acted on leave the list, and with them the reason for the buttons.
     */
    ref?: Ref<HTMLDivElement>;
}

/**
 * The table's bulk actions: how many games are selected, and moving them to another list or taking
 * them out of every list in one action (`docs/decisions/0055-*`).
 *
 * Always drawn while the table is, and one height in every state — one row, or two on a phone, with the
 * actions scrolling sideways rather than wrapping — so it never pushes the rows down under the pointer
 * as a first box is ticked. Sticky under the navbar, so it is in reach from anywhere in a long list. It
 * comes before the table in the page, so the keyboard reaches it straight from the toolbar rather than
 * after every row's controls, and its controls read in the order they are drawn.
 *
 * Taking games out asks first. The question takes the place of the button that asked it, so focus
 * moves with it — to Cancel, so that a held Enter's repeat lands on the harmless button — and back to
 * the button when the question is called off, by Cancel or by Escape.
 */
export function ListBulkBar({
    count, listName, targets, working, problem = null, onMove, onRemove, onClear, ref,
}: ListBulkBarProps) {
    const [confirming, setConfirming] = useState(false);
    const questionId = useId();
    const removeButton = useRef<HTMLButtonElement>(null);
    const cancelButton = useRef<HTMLButtonElement>(null);

    // A question about games nobody has selected any more is not a question, and it must not come back
    // on its own the next time somebody ticks one. Let go during render, as a prop change is answered.
    if (confirming && (count === 0 || working !== null)) setConfirming(false);
    const asking = confirming && count > 0 && working === null;

    // Committed at once, so the element focus goes to is there to take it.
    const ask = () => {
        flushSync(() => setConfirming(true));
        cancelButton.current?.focus();
    };
    const callOff = () => {
        flushSync(() => setConfirming(false));
        removeButton.current?.focus();
    };

    return (
        <div className="list-bulk-bar" role="region" aria-label="Selected games" tabIndex={-1} ref={ref}>
            {working !== null ? (
                <p className="list-bulk-text">{working}</p>
            ) : asking ? (
                <div
                    className="list-bulk-confirm"
                    role="group"
                    aria-labelledby={questionId}
                    onKeyDown={event => {
                        if (event.key === 'Escape') callOff();
                    }}
                >
                    <p className="list-bulk-text" id={questionId}>
                        Take {gameCount(count)} out of {listName}? Their scores, ownership, notes and
                        playthroughs stay.
                    </p>
                    <button
                        type="button"
                        className="list-bulk-button danger"
                        onClick={() => {
                            setConfirming(false);
                            onRemove();
                        }}
                    >
                        Remove {gameCount(count)}
                    </button>
                    <button type="button" className="list-bulk-button" ref={cancelButton} onClick={callOff}>
                        Cancel
                    </button>
                </div>
            ) : count > 0 ? (
                <>
                    {problem === null
                        ? <p className="list-bulk-text list-bulk-count">{gameCount(count)} selected</p>
                        : <p className="list-bulk-text list-bulk-problem">{problem}</p>}
                    <div className="list-bulk-actions">
                        <div className="list-bulk-moves" role="group" aria-label="Move the selected games to">
                            <span className="list-bulk-label" aria-hidden="true">Move to</span>
                            {targets.map(target => (
                                <button
                                    key={target.id}
                                    type="button"
                                    className="list-bulk-button"
                                    onClick={() => onMove(target.id)}
                                >
                                    {/* Each button says where it moves to in its own name, as well as through
                                        the group's: iOS VoiceOver does not speak a group's name. The space is
                                        outside the hidden words, where a name's computation keeps it. */}
                                    <span className="sr-only">Move to</span>{' '}{target.name}
                                </button>
                            ))}
                        </div>
                        <button type="button" className="list-bulk-button" ref={removeButton} onClick={ask}>
                            Remove from list
                        </button>
                        <button type="button" className="list-bulk-button list-bulk-clear" onClick={onClear}>
                            Clear selection
                        </button>
                    </div>
                </>
            ) : (
                <p className={`list-bulk-text ${problem === null ? 'list-bulk-hint' : 'list-bulk-problem'}`}>
                    {problem ?? 'Tick games to move them to another list, or take them out, all at once.'}
                </p>
            )}
        </div>
    );
}
