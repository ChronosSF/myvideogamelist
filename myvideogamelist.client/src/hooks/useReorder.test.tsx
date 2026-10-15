import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReorderAnnouncer } from '@/components/ReorderAnnouncer';
import { ReorderHandle } from '@/components/ReorderHandle';
import { useReorder } from '@/hooks/useReorder';

const NAMES: Record<number, string> = { 1: 'Celeste', 2: 'Hades', 3: 'Cuphead', 4: 'Outer Wilds' };

interface HarnessProps {
    ids?: number[];
    /** What the move answers. The harness applies it to its own list either way, as a provider would optimistically. */
    answer?: boolean | 'never';
    canMove?: (id: number) => boolean;
    disabled?: boolean;
    onMove?: (id: number, afterId: number | null) => void;
}

/**
 * A list as the lists page draws one: the announcer before the items, a handle in each, and the
 * move applied to the list it came from the moment it is made.
 */
function Harness({ ids: initial = [1, 2, 3, 4], answer = true, canMove, disabled = false, onMove }: HarnessProps) {
    const [ids, setIds] = useState(initial);

    const reorder = useReorder({
        ids,
        nameOf: id => NAMES[id],
        canMove,
        disabled,
        onMove: (id, afterId) => {
            onMove?.(id, afterId);
            setIds(previous => {
                const next = previous.filter(other => other !== id);
                next.splice(afterId === null ? 0 : next.indexOf(afterId) + 1, 0, id);
                return next;
            });
            if (answer === 'never') return new Promise<boolean>(() => {});
            return Promise.resolve(answer);
        },
    });

    return (
        <div>
            <ReorderAnnouncer reorder={reorder} />
            <ul {...reorder.listProps()}>
                {reorder.order.map((id, index) => (
                    <li key={id} {...reorder.itemProps(id)}>
                        <ReorderHandle handle={reorder.handleProps(id)} rank={index + 1} variant="inline" />
                        <span>{NAMES[id]}</span>
                    </li>
                ))}
            </ul>
            <button type="button">Somewhere else</button>
            <button type="button" onClick={() => setIds(previous => previous.slice(1))}>Lose the first game</button>
        </div>
    );
}

const handle = (name: string) => screen.getByRole('button', { name: `Move ${name}` });
const shown = () => screen.getAllByRole('listitem').map(item => item.textContent?.replace(/^\d+/, ''));
const announced = () => document.querySelector('[aria-live="assertive"]')?.textContent?.trim();

describe('useReorder from the keyboard', () => {
    it('picks a game up, moves it, and puts it down after the game it now follows', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Cuphead').focus();
        await userEvent.keyboard(' ');
        expect(handle('Cuphead')).toHaveAttribute('aria-pressed', 'true');
        expect(announced()).toMatch(/^Picked up Cuphead, number 3 of 4\./);

        await userEvent.keyboard('{ArrowUp}');
        expect(shown()).toEqual(['Celeste', 'Cuphead', 'Hades', 'Outer Wilds']);
        expect(announced()).toBe('Cuphead, number 2 of 4.');

        await userEvent.keyboard(' ');
        expect(onMove).toHaveBeenCalledExactlyOnceWith(3, 1);
        expect(announced()).toBe('Cuphead put down at number 2 of 4.');
        expect(handle('Cuphead')).not.toHaveAttribute('aria-pressed');
    });

    it('puts a game first with a null to follow, and sends it to either end with Home and End', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard('{Enter}{End}');
        expect(shown()).toEqual(['Celeste', 'Cuphead', 'Outer Wilds', 'Hades']);

        await userEvent.keyboard('{Home}{Enter}');
        expect(onMove).toHaveBeenCalledExactlyOnceWith(2, null);
    });

    it('keeps focus on the handle it is moving, even in a browser that drops it from a moved element', async () => {
        // React draws a move by moving elements, and a browser can send a moved element's focus to
        // the body — a keyboard user would then be back at the top of the page after one key press.
        // React gives it back after its commit, which holds only while the handle is the same
        // element throughout: a handle remounted on a move would lose its focus for good. jsdom
        // keeps focus where it is, so this puts the browser's behaviour in.
        const blurring = <T extends 'insertBefore' | 'appendChild'>(method: T) => {
            const original = Node.prototype[method] as (...args: Node[]) => Node;
            return vi.spyOn(Node.prototype, method).mockImplementation(function (this: Node, ...args: Node[]) {
                const focused = document.activeElement;
                const losesFocus = args[0].isConnected && focused instanceof HTMLElement && args[0].contains(focused);
                const result = original.apply(this, args);
                if (losesFocus) focused.blur();
                return result;
            } as never);
        };
        const spies = [blurring('insertBefore'), blurring('appendChild')];

        try {
            render(<Harness />);

            handle('Celeste').focus();
            await userEvent.keyboard(' {ArrowDown}{ArrowDown}');
            expect(handle('Celeste')).toHaveFocus();

            await userEvent.keyboard(' ');
            expect(handle('Celeste')).toHaveFocus();
        } finally {
            for (const spy of spies) spy.mockRestore();
        }
    });

    it('puts the game back where it was on Escape, and moves nothing', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}{ArrowDown}{Escape}');

        expect(shown()).toEqual(['Celeste', 'Hades', 'Cuphead', 'Outer Wilds']);
        expect(onMove).not.toHaveBeenCalled();
        expect(announced()).toBe('Move cancelled. Hades is back at number 2 of 4.');
    });

    it('puts the game back when focus leaves its handle', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        await userEvent.tab();

        expect(shown()).toEqual(['Celeste', 'Hades', 'Cuphead', 'Outer Wilds']);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('puts the game back when the pointer presses anywhere else', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }));

        expect(shown()).toEqual(['Celeste', 'Hades', 'Cuphead', 'Outer Wilds']);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('says so at the end of the list rather than saying nothing', async () => {
        render(<Harness />);

        handle('Outer Wilds').focus();
        await userEvent.keyboard(' {ArrowDown}');

        expect(announced()).toBe('Outer Wilds is already last, number 4 of 4.');
    });

    it('moves nothing for a game put down where it was picked up', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}{ArrowUp} ');

        expect(onMove).not.toHaveBeenCalled();
        expect(announced()).toBe('Hades put down where it was, number 2 of 4.');
    });

    it('will not pick up a game whose own save is still out, and says why', async () => {
        render(<Harness canMove={id => id !== 2} />);

        expect(handle('Hades')).toHaveAttribute('aria-disabled', 'true');

        handle('Hades').focus();
        await userEvent.keyboard(' ');

        expect(handle('Hades')).not.toHaveAttribute('aria-pressed');
        expect(announced()).toBe('Hades cannot be moved right now.');
    });

    it('says when the move did not happen', async () => {
        render(<Harness answer={false} />);

        handle('Cuphead').focus();
        await userEvent.keyboard(' {ArrowUp} ');

        expect(announced()).toBe('Cuphead could not be moved, and is back where it was.');
    });

    it('calls the move off when the list changes underneath it', async () => {
        // A game leaving the list mid-move — removed from another card, or a refetch — would leave
        // the indexes the move is holding pointing at different games.
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Cuphead').focus();
        await userEvent.keyboard(' {ArrowUp}');
        fireEvent.click(screen.getByRole('button', { name: 'Lose the first game' }));

        expect(shown()).toEqual(['Hades', 'Cuphead', 'Outer Wilds']);
        expect(handle('Cuphead')).not.toHaveAttribute('aria-pressed');
        expect(announced()).toBe('Move cancelled. Cuphead is back where it was.');

        // And nothing is left holding the move. A handler still holding it would put the game down
        // on the next Space, with indexes into a list that no longer exists.
        await userEvent.keyboard('{ArrowUp} ');
        expect(onMove).not.toHaveBeenCalled();
        expect(announced()).toMatch(/^Picked up Cuphead, number 2 of 3\./);
    });

    it('does nothing at all while the list cannot be rearranged', async () => {
        const onMove = vi.fn();
        render(<Harness disabled onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowUp} ');

        expect(shown()).toEqual(['Celeste', 'Hades', 'Cuphead', 'Outer Wilds']);
        expect(onMove).not.toHaveBeenCalled();
    });
});

describe('useReorder with a pointer', () => {
    /**
     * jsdom lays nothing out, so every box is zero-sized at the origin. Here each item is a row forty
     * pixels high on a fifty-pixel pitch, the way a table draws them, and everything else sits at
     * the origin.
     */
    beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (!this.hasAttribute('data-reorder-item')) return new DOMRect(0, 0, 400, 400);
            const index = [...this.parentElement!.children].indexOf(this);
            return new DOMRect(0, index * 50, 400, 40);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const pointer = (clientY: number) => ({ button: 0, pointerId: 1, clientX: 100, clientY });

    it('drops a dragged game in the slot under the pointer', () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(160));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(60));
        expect(shown()).toEqual(['Celeste', 'Outer Wilds', 'Hades', 'Cuphead']);

        fireEvent.pointerUp(handle('Outer Wilds'), pointer(60));
        expect(onMove).toHaveBeenCalledExactlyOnceWith(4, 1);
        expect(announced()).toBe('Outer Wilds put down at number 2 of 4.');
    });

    it('treats a press that barely moves as a press, not a drag', () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(168));
        fireEvent.pointerUp(handle('Outer Wilds'), pointer(168));

        expect(onMove).not.toHaveBeenCalled();
        expect(announced()).toBe('');
    });

    it('calls a drag off with Escape, wherever focus is', () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(10));
        expect(document.documentElement).toHaveClass('reorder-dragging');

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        fireEvent.pointerUp(handle('Outer Wilds'), pointer(10));

        expect(shown()).toEqual(['Celeste', 'Hades', 'Cuphead', 'Outer Wilds']);
        expect(onMove).not.toHaveBeenCalled();
        expect(document.documentElement).not.toHaveClass('reorder-dragging');
    });

    it('calls a drag off when the browser takes the pointer away', () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(10));
        fireEvent.pointerCancel(handle('Outer Wilds'), pointer(10));

        expect(shown()).toEqual(['Celeste', 'Hades', 'Cuphead', 'Outer Wilds']);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('ignores any button but the main one', () => {
        render(<Harness />);

        fireEvent.pointerDown(handle('Outer Wilds'), { ...pointer(170), button: 2 });
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(10));

        expect(handle('Outer Wilds')).not.toHaveAttribute('aria-pressed');
    });
});
