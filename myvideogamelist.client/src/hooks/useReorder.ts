import {
    useEffect,
    useEffectEvent,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
} from 'react';
import { type Slot, arrayMove, nearestSlot, rowLength } from '@/lib/reorder';

/**
 * Rearranging a list by hand, three ways, each announced at every step to assistive technology
 * (`docs/decisions/0054-*`):
 *
 * - **dragging** a game's handle with a pointer;
 * - **tapping** a handle to pick its game up, then tapping the handle of the game whose place it
 *   should take — the way to do it with a pointer and no drag (WCAG 2.5.7), and what a screen reader's
 *   own "activate" does, since that sends a click;
 * - **from the keyboard**, picking a handle up with Space or Enter, moving it with the arrow keys and
 *   putting it down again.
 *
 * Hand-rolled rather than a library, which is the call that record makes. Nothing here touches
 * `window` or `document` outside an event or an effect, so the server render and the first client
 * render are the same markup.
 *
 * The hook holds the gesture and nothing else. While a game is being moved it says where to draw it
 * (`order`); when it is put down it calls `onMove` with the game it now follows, and whatever owns the
 * list makes the change — optimistically, in the provider, for the backlog.
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
    /** True while the list cannot be rearranged at all. A move under way is called off. */
    disabled?: boolean;
}

/**
 * What the element holding the items takes — a grid, a `<tbody>`, a `<ul>`. The pointer is followed
 * here rather than on a handle: React draws a move by moving the game's own element, and a handle
 * holding the pointer's capture would lose it the moment its game moved down the list.
 */
export interface ReorderListProps {
    'data-reorder-list': string;
    /** Present while a game is held — tapped, or picked up from the keyboard — and waits for its place. */
    'data-reorder-holding'?: true;
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
}

/** What the item's own element takes. */
export interface ReorderItemProps {
    'data-reorder-item': number;
    /** `lifted` while it is the one being moved, which is what the stylesheets draw. */
    'data-reorder-state'?: 'lifted';
}

/** What the item's handle — a `<button>` — takes. */
export interface ReorderHandleProps {
    'data-reorder-handle': number;
    'aria-label': string;
    'aria-describedby': string;
    'aria-pressed'?: true;
    'aria-disabled'?: true;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => void;
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
     * For the element holding the items. Attributes and handlers rather than a ref: the handlers find
     * the element by the attribute when they need it, and a ref handed out of a hook leads the React
     * Compiler's lint to treat everything else the hook returns as a ref too.
     */
    listProps: () => ReorderListProps;
    itemProps: (id: number) => ReorderItemProps;
    handleProps: (id: number) => ReorderHandleProps;
}

interface Moving {
    id: number;
    /**
     * How it was picked up. A `pointer` move is a drag, and ends when the pointer is let go. The other
     * two hold the game until it is put down: from the keyboard, or by a tap.
     */
    via: 'keyboard' | 'tap' | 'pointer';
    /** Where the item was when it was picked up, and where it would land now. Indexes into `ids`. */
    from: number;
    to: number;
    /** The list when it was picked up. A list that changes underneath a move calls it off. */
    ids: readonly number[];
    /** How far Up and Down move it. */
    rowStep: number;
}

/** How far a press on a handle travels before it is a drag rather than a tap. */
const DRAG_THRESHOLD = 4;

/**
 * How far a press away from the handles can travel and still be a tap, the one press that puts a held
 * game back. More than a drag's threshold, because a fingertip slides a little in a tap; a press that
 * goes further is a scroll or a selection, not the user letting go of the game.
 */
const TAP_SLOP = 10;

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

function sameIds(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function useReorder({ ids, nameOf, onMove, canMove, disabled = false }: ReorderOptions): Reorder {
    const instructionsId = useId();
    const listId = useId();

    const [moving, setMoving] = useState<Moving | null>(null);
    const [announcement, setAnnouncement] = useState('');

    /**
     * The move as the handlers see it. Pointer moves arrive faster than renders, so a handler reading
     * `moving` from its render could act on a step already taken; state is what draws the move, and
     * this is what the gesture reads. Only the handlers write it — through `update`, and in `live` —
     * so no render can wind it back to an earlier step.
     */
    const movingRef = useRef<Moving | null>(null);

    /** A press on a handle that may yet become a drag. */
    const press = useRef<{ id: number; pointerId: number; x: number; y: number } | null>(null);

    /** Where the pointer is, in the window's coordinates, for the frame that scrolls the window. */
    const pointer = useRef<{ x: number; y: number } | null>(null);

    /** Where every item was when the drag began, in the container's coordinates. */
    const slots = useRef<Slot[]>([]);

    /**
     * Set when a drag is let go, so that the click the same release may still produce is not taken
     * for a tap, and cleared on the next tick. A drag captures the pointer to the list, so that click
     * is usually the list's rather than the handle's; this covers a browser that sends it to the
     * handle.
     */
    const dragEnded = useRef(false);

    const say = (text: string) => setAnnouncement(previous => announce(previous, text));

    const movable = (id: number) => !disabled && (canMove?.(id) ?? true);

    const update = (next: Moving | null) => {
        movingRef.current = next;
        setMoving(next);
    };

    // A list that changed under a move — a game left it, an undo reordered it — or one that can no
    // longer be rearranged: the move is called off rather than dropped somewhere the user never saw.
    // Adjusted during render, React's pattern for state that has to follow a prop; each condition is
    // false again once it has been acted on, so nothing loops. A list that stops taking moves also
    // loses its last announcement: the page takes the live region away with it, and a region that
    // comes back should not come back still holding an old sentence.
    if (moving !== null && (disabled || !sameIds(moving.ids, ids))) {
        setMoving(null);
        if (!disabled) say(`Move cancelled. ${nameOf(moving.id)} is back where it was.`);
    }
    if (disabled && announcement !== '') setAnnouncement('');

    /**
     * The move the handlers can act on: the ref's, unless the list has changed under it or stopped
     * taking moves. The render above has called it off then, and the ref — which a render cannot
     * write — catches up here.
     */
    const live = (): Moving | null => {
        const current = movingRef.current;
        if (current !== null && (disabled || !sameIds(current.ids, ids))) {
            movingRef.current = null;
            press.current = null;
            pointer.current = null;
            return null;
        }
        return current;
    };

    const position = (index: number) => `number ${index + 1} of ${ids.length}`;

    /** The ids in the order they are drawn: as given, with a game being moved where it would land. */
    const order = moving === null ? ids : arrayMove(ids, moving.from, moving.to);

    /** The element holding the items, found when a handler needs it rather than held. */
    const list = () => document.querySelector<HTMLElement>(`[data-reorder-list="${listId}"]`);

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

        const name = nameOf(id);
        say(via === 'keyboard'
            ? `Picked up ${name}, ${position(from)}. Use the arrow keys to move it, Space or Enter to put it down, Escape to cancel.`
            : via === 'tap'
                ? `Picked up ${name}, ${position(from)}. Press another game's handle to put it in that game's place, or this one again to put it down.`
                : `Picked up ${name}, ${position(from)}.`);
    };

    const moveTo = (to: number) => {
        const current = live();
        if (!current) return;

        const clamped = Math.min(Math.max(to, 0), ids.length - 1);
        if (clamped === current.to) {
            if (current.via !== 'pointer') {
                say(`${nameOf(current.id)} is already ${clamped === 0 ? 'first' : 'last'}, ${position(clamped)}.`);
            }
            return;
        }

        update({ ...current, to: clamped });
        say(`${nameOf(current.id)}, ${position(clamped)}.`);
    };

    const cancel = () => {
        const current = live();
        press.current = null;
        pointer.current = null;
        if (!current) return;

        update(null);
        say(`Move cancelled. ${nameOf(current.id)} is back at ${position(current.from)}.`);
    };

    const drop = () => {
        const current = live();
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
        if (!container || !at || live()?.via !== 'pointer') return;

        const origin = container.getBoundingClientRect();
        moveTo(nearestSlot(
            slots.current,
            at.x - origin.left + container.scrollLeft,
            at.y - origin.top + container.scrollTop,
        ));
    };

    // What a drag needs from the window: Escape to call it off wherever focus is, a drag held near the
    // top or bottom to scroll it, and the grabbing cursor everywhere the pointer goes. Only while one
    // is under way, and nothing here runs during render.
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

    // A held game is put back by a tap anywhere but this list's handles: the pointer has gone to
    // something else, and the game should not stay in the air waiting for a press that will not come.
    // Not by any other press, though. On a touch screen the swipe that scrolls to where the game is
    // going starts as a press like any other, and calling the hold off there let a tap carry a game
    // only to a place already on screen (issue 264). So a press counts once it is let go within a tap's
    // distance of where it began, with nothing scrolled meanwhile, and one the browser takes over to
    // scroll, which it ends with a `pointercancel`, is forgotten. A press on one of the handles is that
    // handle's business — its click puts the held game there.
    const isAwayFromHandles = useEffectEvent((event: globalThis.PointerEvent) => {
        const current = live();
        if (current === null || current.via === 'pointer') return false;

        const target = event.target instanceof Element ? event.target : null;
        return !(target?.closest('[data-reorder-handle]') && list()?.contains(target));
    });
    const onTapAway = useEffectEvent(() => {
        const current = live();
        if (current !== null && current.via !== 'pointer') cancel();
    });

    const holding = moving !== null && moving.via !== 'pointer';
    useEffect(() => {
        if (!holding) return;

        let away: { pointerId: number; x: number; y: number; scrolled: boolean } | null = null;

        const onPointerDown = (event: globalThis.PointerEvent) => {
            away = isAwayFromHandles(event)
                ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrolled: false }
                : null;
        };
        const onScroll = () => {
            if (away !== null) away.scrolled = true;
        };
        const onPointerUp = (event: globalThis.PointerEvent) => {
            const begun = away;
            if (begun === null || begun.pointerId !== event.pointerId) return;
            away = null;

            const travelled = Math.hypot(event.clientX - begun.x, event.clientY - begun.y);
            if (!begun.scrolled && travelled <= TAP_SLOP) onTapAway();
        };
        const onPointerCancel = (event: globalThis.PointerEvent) => {
            if (away?.pointerId === event.pointerId) away = null;
        };

        // Captured, so a press is seen wherever it lands and whatever stops it on the way. A scroll
        // does not bubble, but it is captured on its way to whatever scrolled, the page included.
        const capture = { capture: true };
        const scroll = { capture: true, passive: true };
        document.addEventListener('pointerdown', onPointerDown, capture);
        document.addEventListener('pointerup', onPointerUp, capture);
        document.addEventListener('pointercancel', onPointerCancel, capture);
        document.addEventListener('scroll', onScroll, scroll);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, capture);
            document.removeEventListener('pointerup', onPointerUp, capture);
            document.removeEventListener('pointercancel', onPointerCancel, capture);
            document.removeEventListener('scroll', onScroll, scroll);
        };
    }, [holding]);

    // The game whose handle has focus stays in view as the order changes around it: each step of a
    // keyboard or tap move, and an undo that sends it back. React keeps focus on an element its commit
    // moves, and then puts every scrolled ancestor back where it was — so without this, End on a long
    // list moves the game and its focus ring out of sight. A layout effect, so it runs after that
    // restoring and wins; a drag scrolls the window itself and is left alone.
    const drawn = order.join(',');
    const onDrawn = useEffectEvent(() => {
        if (movingRef.current?.via === 'pointer') return;

        const container = list();
        const focused = document.activeElement;
        if (!container || !(focused instanceof HTMLElement) || !container.contains(focused)) return;

        focused.closest('[data-reorder-handle]')
            ?.closest('[data-reorder-item]')
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    useLayoutEffect(() => {
        onDrawn();
    }, [drawn]);

    /** The handle a pointer event started on, if it is one of this list's. */
    const handleUnder = (event: PointerEvent<HTMLElement>): number | null => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reorder-handle]') : null;
        if (!target || !event.currentTarget.contains(target)) return null;
        return Number(target.dataset.reorderHandle);
    };

    const listProps = (): ReorderListProps => ({
        'data-reorder-list': listId,
        // So the other handles can show that they will take the held game.
        ...(holding ? { 'data-reorder-holding': true as const } : {}),

        onPointerDown: event => {
            const id = handleUnder(event);
            if (id === null || event.button !== 0) return;

            // No text selection, and no focus moving to the handle pressed. A press that turns out
            // to be a tap still clicks, and the click is where a tap is handled — but a held game's
            // handle losing focus to this one would read as the user moving on, and put it back.
            event.preventDefault();

            // A held game is put down by the click this press becomes; a drag already under way
            // takes no second pointer; and a game whose save is out cannot be dragged.
            if (live() !== null || !movable(id)) return;
            press.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        },
        onPointerMove: event => {
            const pressed = press.current;
            if (pressed === null || pressed.pointerId !== event.pointerId) return;

            pointer.current = { x: event.clientX, y: event.clientY };
            if (live() !== null) {
                retarget();
                return;
            }

            const travelled = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
            if (travelled < DRAG_THRESHOLD) return;

            // The list holds the pointer from here, wherever it goes. Not the handle: React draws a
            // move down the list by moving the game's own element, and an element that moves loses
            // its capture. A pointer that cannot be captured — one the browser no longer counts as
            // active — would be lost the moment it left the list, so the drag does not begin.
            try {
                event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
                press.current = null;
                pointer.current = null;
                return;
            }
            lift(pressed.id, 'pointer');
        },
        onPointerUp: event => {
            const pressed = press.current;
            if (pressed === null || pressed.pointerId !== event.pointerId) return;

            if (live()?.via === 'pointer') {
                // The click this release may still produce comes before anything queued now runs.
                dragEnded.current = true;
                setTimeout(() => {
                    dragEnded.current = false;
                }, 0);
                drop();
                return;
            }
            press.current = null;
            pointer.current = null;
        },
        onPointerCancel: event => {
            if (press.current?.pointerId === event.pointerId) cancel();
        },
        onLostPointerCapture: event => {
            // The list's own capture only: the event bubbles, and an element inside it letting go of
            // a capture of its own is not the drag ending. Fires after every pointerup too, by which
            // time the press is gone and this does nothing.
            if (event.target !== event.currentTarget) return;
            if (press.current?.pointerId === event.pointerId) cancel();
        },
    });

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

        // A tap, a click, or a screen reader's "activate": pick the game up, or put the held one here.
        onClick: event => {
            if (dragEnded.current) {
                dragEnded.current = false;
                return;
            }

            const current = live();
            if (current === null) {
                if (!movable(id)) {
                    say(`${nameOf(id)} cannot be moved right now.`);
                    return;
                }
                // Focus follows, so the arrow keys can take over from the tap.
                event.currentTarget.focus();
                lift(id, 'tap');
                return;
            }
            if (current.via === 'pointer') return;

            // The held game goes where this handle's game is drawn, and that game makes room; the held
            // game's own handle puts it down where it is.
            if (current.id !== id) moveTo(order.indexOf(id));
            drop();
        },

        onKeyDown: event => {
            const current = live();
            const pickOrPutDown = event.key === ' ' || event.key === 'Enter';

            // A key held down repeats, and a repeated Space would put the game down and pick it up
            // again at the keyboard's repeat rate. The repeat is stopped, and does nothing.
            if (pickOrPutDown && event.repeat) {
                event.preventDefault();
                return;
            }

            if (current === null) {
                if (!pickOrPutDown) return;
                event.preventDefault();
                if (movable(id)) lift(id, 'keyboard');
                else say(`${nameOf(id)} cannot be moved right now.`);
                return;
            }

            if (current.id !== id || current.via === 'pointer') {
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
        // A button clicks itself on the release of Space, after the keydown above has already picked
        // the game up or put it down; stopped here, or that click would undo it at once.
        onKeyUp: event => {
            if (event.key === ' ') event.preventDefault();
        },
        onBlur: event => {
            // Focus going to another element is the user moving on, and a game still in the air goes
            // back where it was. Focus going nowhere is a browser dropping it from an element React
            // has just moved, which React gives back once its commit is done.
            if (event.relatedTarget === null) return;

            const current = live();
            if (current?.id === id && current.via !== 'pointer') cancel();
        },
    });

    return {
        order,
        movingId: moving?.id ?? null,
        announcement,
        instructionsId,
        listProps,
        itemProps,
        handleProps,
    };
}
