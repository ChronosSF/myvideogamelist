import { useId } from 'react';
import { type ListId, LIST_IDS } from '@/types/list';

/** The option that takes the game out of the list it is in, where every other option is a list's id. */
const TAKE_OUT = 'take-out';

const CHEVRON = 'M6 9l6 6 6-6';
const PLUS = 'M12 5v14M5 12h14';
const CHECK = 'M5 13l4 4L19 7';

interface ListPickerProps {
    /** The list the game is in, or null for none. */
    current: ListId | null;
    /** The reader's own name for each list (ADR 0031). */
    nameFor: (listId: ListId) => string;
    /** Nothing can be chosen: a write is out, or nobody is signed in to choose. */
    disabled: boolean;
    onMove: (listId: ListId) => void;
    onTakeOut: () => void;
    /** Signed out: the Backlog press asks the reader to sign in instead, and the other lists wait. */
    onSignIn?: () => void;
}

/**
 * Which of the reader's five lists a game is in, on the game page's tracking row (ADR 0084).
 *
 * A native select rather than five buttons: it is one control of one width whatever the reader has
 * renamed the lists to, which keeps the hero's row from wrapping, and the select brings the keyboard,
 * the screen reader and the phone's own picker with it. A game in no list is offered the Backlog in one
 * press, as every card on the site offers it (ADR 0075), with the other four beside it.
 */
export function ListPicker({ current, nameFor, disabled, onMove, onTakeOut, onSignIn }: ListPickerProps) {
    const id = useId();

    if (current === null) {
        return (
            <div className="flex h-10">
                <button
                    type="button"
                    onClick={() => (onSignIn ? onSignIn() : onMove('backlog'))}
                    disabled={disabled && !onSignIn}
                    className="inline-flex h-10 items-center gap-2 pl-3.5 pr-3 btn-primary rounded-r-none text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-60"
                >
                    <Icon path={PLUS} />
                    <span><span className="sr-only">Add to </span>{nameFor('backlog')}</span>
                </button>
                <div className="relative">
                    <label htmlFor={id} className="sr-only">Add to another list</label>
                    <select
                        id={id}
                        value=""
                        onChange={event => {
                            if (event.target.value !== '') onMove(event.target.value as ListId);
                        }}
                        disabled={disabled}
                        className="peer h-10 w-9 cursor-pointer appearance-none rounded-sm rounded-l-none border-l border-on-primary/30 bg-primary-500 text-transparent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-default disabled:opacity-60"
                    >
                        <option value="" disabled hidden>Add to another list</option>
                        {LIST_IDS.filter(listId => listId !== 'backlog').map(listId => (
                            <option key={listId} value={listId} className="bg-surface text-fg">{nameFor(listId)}</option>
                        ))}
                    </select>
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-on-primary peer-disabled:opacity-60">
                        <Icon path={CHEVRON} />
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="relative h-10">
            <label htmlFor={id} className="sr-only">Your list</label>
            <select
                id={id}
                value={current}
                onChange={event => {
                    if (event.target.value === TAKE_OUT) onTakeOut();
                    else onMove(event.target.value as ListId);
                }}
                disabled={disabled}
                className="peer h-10 min-w-36 cursor-pointer appearance-none rounded-sm bg-primary-500 pl-9 pr-9 text-sm font-bold text-on-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-default disabled:opacity-60"
            >
                {LIST_IDS.map(listId => (
                    <option key={listId} value={listId} className="bg-surface text-fg">{nameFor(listId)}</option>
                ))}
                <option value={TAKE_OUT} className="bg-surface text-danger-300">Take out of {nameFor(current)}</option>
            </select>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-on-primary peer-disabled:opacity-60">
                <Icon path={CHECK} />
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-on-primary peer-disabled:opacity-60">
                <Icon path={CHEVRON} />
            </span>
        </div>
    );
}

function Icon({ path }: { path: string }) {
    return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={path} />
        </svg>
    );
}
