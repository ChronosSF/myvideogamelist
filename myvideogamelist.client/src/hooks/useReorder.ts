import {
    useEffect,
    useEffectEvent,
    useId,
    useRef,
    useState,
    type FocusEvent,
    type KeyboardEvent,
    type PointerEvent,
} from 'react';
import { type Slot, arrayMove, nearestSlot, rowLength } from '@/lib/reorder';

/**
 * Rearranging a list by hand: with a pointer, by dragging a game's handle, and from the keyboard, by
 * picking the handle up with Space or Enter, moving it with the arrow keys and putting it down again —
 * announced at every step to assistive technology. See `docs/decisions/0054-*`.
 *
 * Hand-rolled rather than a library, which is the call that record makes: the interaction is one list
 * of same-shaped items, and nothing here touches `window` or `document` outside an event or an effect,
 * so the server render and the first client render are the same markup.
 *
 * The hook holds the gesture and nothing else. It never reorders anything itself: while a game is
 * being moved it says where to draw it (`order`), and when it is put down it calls `onMove` with the
 * game it now follows, and whatever owns the list makes the change — optimistically, in the provider,
 * for the backlog.
 */
export interface ReorderOptions {
    /** The items in the order they are shown. */
    ids: readonly number[];
    /** What an item is called, for its handle's name and every announcement: a game's title. */
    nameOf: (id: number) => string;
    /**
     * Puts the item right after `afterId`, or first when that is null. Resolves false when the move
     * did not happen, so the hook can say so.
     */
    onMove: (id: number, afterId: number | null) => Promise<boolean> | boolean;
    /** Whether an item can be picked up now — false while its own write is out. */
    canMove?: (id: number) => boolean;
    /** True while the list cannot be rearranged at all. A move under way is cancelled. */
    disabled?: boolean;
}

/** What the element holding the items takes — a grid, a `<tbody>`, a `<ul>`. */
export interface ReorderListProps {
    'data-reorder-list': string;
}

/** What the item's own element takes. */
export interface ReorderItemProps {
    'data-reorder-item': number;
    /** `lifted` while it is the one being moved, which is what the stylesheet draws. */
    'data-reorder-state'?: 'lifted';
}

/** What the item's handle — a `<button>` — takes. */
export interface ReorderHandleProps {
    'data-reorder-handle': number;
    'aria-label': string;
    'aria-describedby': string;
    'aria-pressed'?: true;
    'aria-disabled'?: true;
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
}

export interface Reorder {
    /** The ids in the order to draw them: as given, but with an item being moved where it would land. */
    order: readonly number[];
    /** The item being moved, or null. */
    movingId: number | null;
    /** What the live region says now. `ReorderAnnouncer` renders it. */
    announcement: string;
    /** The hidden instructions every handle is described by. `ReorderAnnouncer` renders them. */
    instructionsId: string;
    /**
     * For the element that holds the items, which their slots are measured against. An attribute
     * rather than a ref: the handlers find the element by it when they need it, and a ref handed out
     * of a hook leads the React Compiler's lint to treat everything else the hook returns as a ref.
     */
    listProps: () => ReorderListProps;
    itemProps: (id: number) => ReorderItemProps;
    handleProps: (id: number) => ReorderHandleProps;
}

interface Moving {
    id: number;
    via: 'keyboard' | 'pointer';
    /** Where the item was when it was picked up, and where it would land now. Indexes into `ids`. */
    from: number;
    to: number;
    /** The list when it was picked up. A list that changes underneath a move cancels it. */
    ids: readonly number[];
    /** How far Up and Down move it. */
    rowStep: number;
}

/** How far a press on a handle travels before it is a drag rather than a press. */
const DRAG_THRESHOLD = 4;

/** How close to the top or bottom of the window a drag has to come to scroll it. */
const SCROLL_EDGE = 56;

/** How far a drag at the very edge scrolls the window each frame. */
const SCROLL_SPEED = 20;

/**
 * The live region's text. A second announcement identical to the first — pressing Up on the first
 * game twice — changes nothing a screen reader can hear, so every other one carries an invisible
 * difference.
 */
function announce(previous: string, text: string): string {
    return previous === text ? `${text}\u00a0` : text;
}

export function useReorder({ ids, nameOf, onMove, canMove, disabled = false }: ReorderOptions): Reorder {
    const instructionsId = useId();
    const listId = useId();

    /** The element holding the items, found when a handler needs it rather than held. */
    const list = () => document.querySelector<HTMLElement>(`[data-reorder-list="${listId}"]`);

    const [moving, setMoving] = useState<Moving | null>(null);
    const [announcement, setAnnouncement] = useState('');

    /**
     * The move as the event handlers see it. Pointer moves arrive faster than renders, so a handler
     * reading `moving` from its render could pick the same item up twice; state is what draws the
     * move, and this is what the gesture reads.
     */
    const movingRef = useRef<Moving | null>(null);

    /** A press on a handle that has not travelled far enough to be a drag. */
    const press = useRef<{ id: number; pointerId: number; x: number; y: number } | null>(null);

    /** Where the pointer is, in the window's coordinates, for the frame that scrolls the window. */
    const pointer = useRef<{ x: number; y: number } | null>(null);

    /** Where every item was when the drag began, in the container's coordinates. */
    const slots = useRef<Slot[]>([]);

    const say = (text: string) => setAnnouncement(previous => announce(previous, text));

    const movable = (id: number) => !disabled && (canMove?.(id) ?? true);

    const update = (next: Moving | null) => {
        movingRef.current = next;
        setMoving(next);
    };

    // A list that changed under a move — a game left it, a refetch reordered it — or one that can no
    // longer be rearranged: the move is called off rather than dropped somewhere the user never saw.
    // Adjusted during render, which is React's pattern for state that has to follow a prop; it is
    // false again as soon as `moving` is null, so it cannot loop.
    const listChanged = moving !== null
        && (moving.ids.length !== ids.length || moving.ids.some((id, index) => id !== ids[index]));
    if (moving !== null && (listChanged || disabled)) {
        setMoving(null);
        setAnnouncement(previous => announce(previous, `Move cancelled. ${nameOf(moving.id)} is back where it was.`));
    }

    // The handlers' copy follows a move called off during render, where a ref cannot be written. Every
    // other change writes both at once in `update`, so this only ever catches up.
    useEffect(() => {
        movingRef.current = moving;
    }, [moving]);

    const position = (index: number) => `number ${index + 1} of ${ids.length}`;

    /** Every item's box, in the order the items are in the document, relative to the container. */
    const measure = (): Slot[] => {
        const container = list();
        if (!container) return [];

        const origin = container.getBoundingClientRect();
        return [...container.querySelectorAll<HTMLElement>('[data-reorder-item]')].map(item => {
            const box = item.getBoundingClientRect();
            return {
                left: box.left - origin.left + container.scrollLeft,
                top: box.top - origin.top + container.scrollTop,
                right: box.right - origin.left + container.scrollLeft,
                bottom: box.bottom - origin.top + container.scrollTop,
            };
        });
    };

    const lift = (id: number, via: Moving['via']) => {
        const from = ids.indexOf(id);
        if (from === -1) return;

        slots.current = measure();
        update({ id, via, from, to: from, ids, rowStep: rowLength(slots.current) });

        say(via === 'keyboard'
            ? `Picked up ${nameOf(id)}, ${position(from)}. Use the arrow keys to move it, Space or Enter to put it down, Escape to cancel.`
            : `Picked up ${nameOf(id)}, ${position(from)}.`);
    };

    const moveTo = (to: number) => {
        const current = movingRef.current;
        if (!current) return;

        const clamped = Math.min(Math.max(to, 0), ids.length - 1);
        if (clamped === current.to) {
            if (current.via === 'keyboard') {
                say(`${nameOf(current.id)} is already ${clamped === 0 ? 'first' : 'last'}, ${position(clamped)}.`);
            }
            return;
        }

        update({ ...current, to: clamped });
        say(`${nameOf(current.id)}, ${position(clamped)}.`);
    };

    const cancel = () => {
        const current = movingRef.current;
        press.current = null;
        pointer.current = null;
        if (!current) return;

        update(null);
        say(`Move cancelled. ${nameOf(current.id)} is back at ${position(current.from)}.`);
    };

    const drop = () => {
        const current = movingRef.current;
        press.current = null;
        pointer.current = null;
        if (!current) return;

        update(null);
        const name = nameOf(current.id);

        if (current.to === current.from) {
            say(`${name} put down where it was, ${position(current.from)}.`);
            return;
        }

        const landed = arrayMove(current.ids, current.from, current.to);
        const afterId = current.to === 0 ? null : landed[current.to - 1];
        say(`${name} put down at ${position(current.to)}.`);

        let moved: Promise<boolean> | boolean;
        try {
            moved = onMove(current.id, afterId);
        } catch {
            moved = false;
        }
        Promise.resolve(moved)
            .catch(() => false)
            .then(done => {
                if (!done) say(`${name} could not be moved, and is back where it was.`);
            });
    };

    /** Where the item would land with the pointer where it is now. */
    const retarget = () => {
        const container = list();
        const at = pointer.current;
        if (!container || !at || movingRef.current?.via !== 'pointer') return;

        const origin = container.getBoundingClientRect();
        moveTo(nearestSlot(
            slots.current,
            at.x - origin.left + container.scrollLeft,
            at.y - origin.top + container.scrollTop,
        ));
    };

    // What a pointer drag needs from the window: Escape to call it off wherever focus is, a drag held
    // near the top or bottom to scroll it, and the grabbing cursor everywhere the pointer goes. Only
    // while one is under way, and nothing here runs during render.
    const onWindowKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
        if (event.key === 'Escape') cancel();
    });
    const onFrame = useEffectEvent(() => {
        const at = pointer.current;
        if (!at) return;

        const nearTop = SCROLL_EDGE - at.y;
        const nearBottom = at.y - (window.innerHeight - SCROLL_EDGE);
        const by = nearTop > 0
            ? -Math.ceil((nearTop / SCROLL_EDGE) * SCROLL_SPEED)
            : nearBottom > 0 ? Math.ceil((nearBottom / SCROLL_EDGE) * SCROLL_SPEED) : 0;

        if (by !== 0) {
            window.scrollBy(0, by);
            retarget();
        }
    });

    const dragging = moving?.via === 'pointer';
    useEffect(() => {
        if (!dragging) return;

        let frame = requestAnimationFrame(function tick() {
            onFrame();
            frame = requestAnimationFrame(tick);
        });
        const onKey = (event: globalThis.KeyboardEvent) => onWindowKeyDown(event);
        window.addEventListener('keydown', onKey);
        document.documentElement.classList.add('reorder-dragging');

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('keydown', onKey);
            document.documentElement.classList.remove('reorder-dragging');
        };
    }, [dragging]);

    // A keyboard move is called off by a press anywhere but its own handle: the pointer has gone to
    // something else, and the game should not stay in the air waiting for a key nobody will press.
    const onDocumentPointerDown = useEffectEvent((event: globalThis.PointerEvent) => {
        const current = movingRef.current;
        if (current?.via !== 'keyboard') return;

        const handle = list()?.querySelector(`[data-reorder-handle="${current.id}"]`);
        if (handle && event.target instanceof Node && handle.contains(event.target)) return;

        cancel();
    });

    const keyboardMoving = moving?.via === 'keyboard';
    useEffect(() => {
        if (!keyboardMoving) return;

        const onPointerDown = (event: globalThis.PointerEvent) => onDocumentPointerDown(event);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [keyboardMoving]);

    const listProps = (): ReorderListProps => ({ 'data-reorder-list': listId });

    const itemProps = (id: number): ReorderItemProps => ({
        'data-reorder-item': id,
        ...(moving?.id === id ? { 'data-reorder-state': 'lifted' as const } : {}),
    });

    const handleProps = (id: number): ReorderHandleProps => ({
        'data-reorder-handle': id,
        'aria-label': `Move ${nameOf(id)}`,
        'aria-describedby': instructionsId,
        // Only while it is held, so the handle reads as a plain button the rest of the time rather
        // than as a toggle that is always off.
        ...(moving?.id === id ? { 'aria-pressed': true as const } : {}),
        // Not `disabled`: a disabled button loses focus, and the moment after a keyboard user puts a
        // game down is exactly when its save is out and the handle cannot take another move.
        ...(movable(id) ? {} : { 'aria-disabled': true as const }),

        onPointerDown: event => {
            if (event.button !== 0 || movingRef.current !== null || !movable(id)) return;

            // No text selection and no focus ring from a drag, and the pointer kept on this handle
            // wherever it goes, so the drag survives leaving the item. A pointer the browser no longer
            // counts as active cannot be captured; without the capture the drag would lose the
            // pointer the moment it left the handle, so the press is not taken up at all.
            event.preventDefault();
            try {
                event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
                return;
            }
            press.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        },
        onPointerMove: event => {
            const pressed = press.current;
            if (pressed === null || pressed.pointerId !== event.pointerId) return;

            pointer.current = { x: event.clientX, y: event.clientY };
            if (movingRef.current === null) {
                const travelled = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
                if (travelled >= DRAG_THRESHOLD) lift(pressed.id, 'pointer');
                return;
            }
            retarget();
        },
        onPointerUp: event => {
            if (press.current?.pointerId !== event.pointerId) return;
            if (movingRef.current?.via === 'pointer') drop();
            else press.current = null;
        },
        onPointerCancel: event => {
            if (press.current?.pointerId === event.pointerId) cancel();
        },
        onLostPointerCapture: event => {
            // Fires after every pointerup too, by which time the press is gone and this does nothing.
            if (press.current?.pointerId === event.pointerId) cancel();
        },

        onKeyDown: event => {
            const current = movingRef.current;

            if (current === null) {
                if (event.key !== ' ' && event.key !== 'Enter') return;
                event.preventDefault();
                if (movable(id)) lift(id, 'keyboard');
                else say(`${nameOf(id)} cannot be moved right now.`);
                return;
            }

            if (current.id !== id || current.via !== 'keyboard') {
                if (event.key === 'Escape') cancel();
                return;
            }

            switch (event.key) {
                case 'ArrowUp':
                    moveTo(current.to - current.rowStep);
                    break;
                case 'ArrowDown':
                    moveTo(current.to + current.rowStep);
                    break;
                case 'ArrowLeft':
                    moveTo(current.to - 1);
                    break;
                case 'ArrowRight':
                    moveTo(current.to + 1);
                    break;
                case 'Home':
                    moveTo(0);
                    break;
                case 'End':
                    moveTo(ids.length - 1);
                    break;
                case ' ':
                case 'Enter':
                    drop();
                    break;
                case 'Escape':
                    cancel();
                    break;
                case 'Tab':
                    // Leaving the handle puts the game back. The key is not stopped, so focus moves on.
                    cancel();
                    return;
                default:
                    return;
            }
            event.preventDefault();
        },
        onBlur: event => {
            // Focus going to another element is the user moving on, and a game still in the air goes
            // back where it was. Focus going nowhere is a browser dropping it from an element React
            // has just moved, which React gives back once its commit is done.
            if (event.relatedTarget === null) return;

            const current = movingRef.current;
            if (current?.id === id && current.via === 'keyboard') cancel();
        },
    });

    return {
        order: moving === null ? ids : arrayMove(ids, moving.from, moving.to),
        movingId: moving?.id ?? null,
        announcement,
        instructionsId,
        listProps,
        itemProps,
        handleProps,
    };
}
