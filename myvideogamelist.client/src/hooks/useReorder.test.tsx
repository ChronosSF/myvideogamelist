import { afterEach, describe, expect, it, vi } from 'vitest';
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
            <p>Somewhere plain</p>
            <button type="button" onClick={() => setIds(previous => previous.slice(1))}>Lose the first game</button>
            <button type="button" onClick={() => setIds(previous => [previous[1], previous[0], ...previous.slice(2)])}>
                Swap the first two games
            </button>
        </div>
    );
}

const handle = (name: string) => screen.getByRole('button', { name: `Move ${name}` });
/** Text that takes no focus, so that a press on it is a press and nothing else. */
const plain = () => screen.getByText('Somewhere plain');
const shown = () => screen.getAllByRole('listitem').map(item => item.textContent?.replace(/^\d+/, ''));
const announced = () => document.querySelector('[aria-live="assertive"]')?.textContent?.trim();
const ORIGINAL = ['Celeste', 'Hades', 'Cuphead', 'Outer Wilds'];

/**
 * Lays the items out, since jsdom lays nothing out and measures every box as zero-sized at the
 * origin: each item at `slot(index)`, and everything else — the list itself — at the origin.
 */
function layOut(slot: (index: number) => { x: number; y: number; width: number; height: number }) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (!this.hasAttribute('data-reorder-item')) return new DOMRect(0, 0, 400, 800);
        const { x, y, width, height } = slot([...this.parentElement!.children].indexOf(this));
        return new DOMRect(x, y, width, height);
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

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

    it('moves a game later with Right and earlier with Left', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowRight}{ArrowRight}');
        expect(shown()).toEqual(['Celeste', 'Cuphead', 'Outer Wilds', 'Hades']);

        await userEvent.keyboard('{ArrowLeft} ');
        expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 3);
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

    it('moves a game by a whole row of a grid with Up and Down', async () => {
        // Two columns: Down from the first cover is the cover below it, two places on.
        layOut(index => ({ x: (index % 2) * 200, y: Math.floor(index / 2) * 300, width: 180, height: 280 }));
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Celeste').focus();
        await userEvent.keyboard(' {ArrowDown}');

        expect(shown()).toEqual(['Hades', 'Cuphead', 'Celeste', 'Outer Wilds']);
        expect(announced()).toBe('Celeste, number 3 of 4.');

        await userEvent.keyboard('{ArrowUp}{ArrowRight} ');
        expect(onMove).toHaveBeenCalledExactlyOnceWith(1, 2);
    });

    it('keeps focus on the handle it is moving, wherever the game is drawn', async () => {
        // React draws a move by moving elements, and a browser can drop the focus of an element that
        // is moved. React gives it back once its commit is done — which holds only while the handle
        // is the same element throughout, so this fails if a move ever remounts it.
        render(<Harness />);

        handle('Celeste').focus();
        await userEvent.keyboard(' {ArrowDown}{ArrowDown}');
        expect(handle('Celeste')).toHaveFocus();

        await userEvent.keyboard(' ');
        expect(handle('Celeste')).toHaveFocus();
    });

    it('keeps the game it is moving in view, which a move to the end of a long list would leave', async () => {
        // React restores every scrolled ancestor after it moves an element, so nothing else scrolls
        // the window to a game the keyboard sent off the screen.
        const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
        render(<Harness />);

        handle('Hades').focus();
        await userEvent.keyboard(' {End}');

        const lastRow = screen.getAllByRole('listitem').at(-1);
        expect(lastRow).toHaveTextContent('Hades');
        expect(scrolled.mock.contexts.at(-1)).toBe(lastRow);
        expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('keeps the move when the handle loses its focus to nowhere, as a moved element does', async () => {
        render(<Harness />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        fireEvent.blur(handle('Hades'), { relatedTarget: null });

        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');
        expect(shown()).toEqual(['Celeste', 'Cuphead', 'Hades', 'Outer Wilds']);
    });

    it('puts the game back when focus goes to something else', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        fireEvent.blur(handle('Hades'), { relatedTarget: screen.getByRole('button', { name: 'Somewhere else' }) });

        expect(shown()).toEqual(ORIGINAL);
        expect(handle('Hades')).not.toHaveAttribute('aria-pressed');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('puts the game back where it was on Escape, and moves nothing', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}{ArrowDown}{Escape}');

        expect(shown()).toEqual(ORIGINAL);
        expect(onMove).not.toHaveBeenCalled();
        expect(announced()).toBe('Move cancelled. Hades is back at number 2 of 4.');
    });

    it('puts the game back on Tab, and lets focus move on', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        await userEvent.tab();

        expect(shown()).toEqual(ORIGINAL);
        expect(handle('Hades')).not.toHaveFocus();
        expect(onMove).not.toHaveBeenCalled();
    });

    it('puts the game back when the pointer taps anywhere but a handle', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }));

        expect(shown()).toEqual(ORIGINAL);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('keeps the move through a press elsewhere that the browser takes for a scroll', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        fireEvent.pointerDown(plain(), { pointerId: 2, clientX: 100, clientY: 300 });
        fireEvent.pointerCancel(plain(), { pointerId: 2, clientX: 100, clientY: 300 });
        await userEvent.keyboard(' ');

        expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 3);
    });

    it('says so at the end of the list rather than saying nothing, and says it again audibly', async () => {
        render(<Harness />);

        handle('Outer Wilds').focus();
        await userEvent.keyboard(' {ArrowDown}');
        const first = document.querySelector('[aria-live="assertive"]')!.textContent;
        expect(announced()).toBe('Outer Wilds is already last, number 4 of 4.');

        // The same sentence twice is no change a screen reader can hear, so the second differs.
        await userEvent.keyboard('{ArrowDown}');
        expect(document.querySelector('[aria-live="assertive"]')!.textContent).not.toBe(first);
        expect(announced()).toBe('Outer Wilds is already last, number 4 of 4.');
    });

    it('ignores a held Space, rather than putting the game down and picking it up again', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        fireEvent.keyDown(handle('Hades'), { key: ' ', repeat: true });

        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');
        expect(shown()).toEqual(['Celeste', 'Cuphead', 'Hades', 'Outer Wilds']);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('is not undone by the click a browser makes when Space is let go', async () => {
        // A button clicks itself on the release of Space unless that release is stopped; the click
        // would put down the game the keydown had just picked up. jsdom makes no such click, so the
        // browser's half is played here: a click follows the keyup unless its default was prevented.
        render(<Harness />);

        fireEvent.keyDown(handle('Hades'), { key: ' ' });
        if (fireEvent.keyUp(handle('Hades'), { key: ' ' })) fireEvent.click(handle('Hades'));

        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');
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

    it('calls the move off when the list loses a game underneath it', async () => {
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

    it('calls the move off when the list is reordered underneath it, though it keeps its length', async () => {
        // An undo of an earlier move landing while this one is held: the same games, in another order.
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        handle('Cuphead').focus();
        await userEvent.keyboard(' {ArrowUp}');
        fireEvent.click(screen.getByRole('button', { name: 'Swap the first two games' }));

        expect(shown()).toEqual(['Hades', 'Celeste', 'Cuphead', 'Outer Wilds']);
        expect(handle('Cuphead')).not.toHaveAttribute('aria-pressed');

        await userEvent.keyboard(' ');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('calls the move off without a word when the list stops taking moves, and forgets what it said', async () => {
        // The page takes the live region away with the order, so a sentence left in it would come
        // back with it.
        const onMove = vi.fn();
        const view = render(<Harness onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowDown}');
        view.rerender(<Harness onMove={onMove} disabled />);

        expect(shown()).toEqual(ORIGINAL);
        expect(handle('Hades')).not.toHaveAttribute('aria-pressed');
        expect(announced()).toBe('');

        await userEvent.keyboard(' ');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('does nothing at all while the list cannot be rearranged', async () => {
        const onMove = vi.fn();
        render(<Harness disabled onMove={onMove} />);

        handle('Hades').focus();
        await userEvent.keyboard(' {ArrowUp} ');

        expect(shown()).toEqual(ORIGINAL);
        expect(onMove).not.toHaveBeenCalled();
    });
});

describe('useReorder with taps instead of a drag', () => {
    // WCAG 2.5.7: whatever a drag does, a single pointer has to be able to do without dragging. A tap
    // on a handle picks its game up; a tap on another handle puts it in that game's place. A screen
    // reader's own "activate" is a click too, so this is also how it moves a game in browse mode.
    it('picks a game up with one tap and puts it in another game\'s place with the next', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        await userEvent.click(handle('Outer Wilds'));
        expect(handle('Outer Wilds')).toHaveAttribute('aria-pressed', 'true');
        expect(handle('Outer Wilds')).toHaveFocus();
        expect(announced()).toMatch(/^Picked up Outer Wilds, number 4 of 4\. Press another game's handle/);

        await userEvent.click(handle('Hades'));
        expect(onMove).toHaveBeenCalledExactlyOnceWith(4, 1);
        expect(shown()).toEqual(['Celeste', 'Outer Wilds', 'Hades', 'Cuphead']);
        expect(announced()).toBe('Outer Wilds put down at number 2 of 4.');
    });

    it('takes the place of a game further down, which makes room above it', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        await userEvent.click(handle('Celeste'));
        await userEvent.click(handle('Cuphead'));

        expect(onMove).toHaveBeenCalledExactlyOnceWith(1, 3);
        expect(shown()).toEqual(['Hades', 'Cuphead', 'Celeste', 'Outer Wilds']);
    });

    it('puts the game down where it is with a second tap on its own handle', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        await userEvent.click(handle('Hades'));
        await userEvent.click(handle('Hades'));

        expect(onMove).not.toHaveBeenCalled();
        expect(handle('Hades')).not.toHaveAttribute('aria-pressed');
        expect(announced()).toBe('Hades put down where it was, number 2 of 4.');
    });

    it('lets the keyboard carry on with a game a tap picked up', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        await userEvent.click(handle('Cuphead'));
        await userEvent.keyboard('{ArrowUp}{ArrowUp} ');

        expect(onMove).toHaveBeenCalledExactlyOnceWith(3, null);
    });

    it('puts the game back on a tap anywhere but a handle', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        await userEvent.click(handle('Hades'));
        await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }));

        expect(onMove).not.toHaveBeenCalled();
        expect(handle('Hades')).not.toHaveAttribute('aria-pressed');
    });

    // A press away from the handles puts a held game back only once it has ended where it began, which
    // is what lets a tap carry a game to a place off the screen (issue 264). A swipe to scroll begins as a
    // press too, and the browser ends it with a pointercancel rather than a release; a mouse selecting
    // text travels; and either can scroll the page meanwhile. These presses are fired rather than played
    // by user-event, which moves focus as a mouse does, so that what they test is the press, not a blur.
    const touch = (clientY: number, pointerId = 2) => ({ pointerId, pointerType: 'touch', clientX: 100, clientY });

    it('keeps a game held through a swipe the browser takes for a scroll, and places it with the next tap', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        await userEvent.click(handle('Outer Wilds'));
        fireEvent.pointerDown(plain(), touch(300));
        fireEvent.pointerCancel(plain(), touch(300));
        fireEvent.scroll(document);

        expect(handle('Outer Wilds')).toHaveAttribute('aria-pressed', 'true');

        await userEvent.click(handle('Hades'));
        expect(onMove).toHaveBeenCalledExactlyOnceWith(4, 1);
        expect(shown()).toEqual(['Celeste', 'Outer Wilds', 'Hades', 'Cuphead']);
    });

    it('forgets a press the browser cancelled, whatever comes after it', async () => {
        render(<Harness />);

        await userEvent.click(handle('Hades'));
        fireEvent.pointerDown(plain(), touch(300));
        fireEvent.pointerCancel(plain(), touch(300));
        fireEvent.pointerUp(plain(), touch(300));

        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps a game held through a press that travels before it is let go', async () => {
        render(<Harness />);

        await userEvent.click(handle('Hades'));
        fireEvent.pointerDown(plain(), touch(300));
        fireEvent.pointerUp(plain(), touch(340));

        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps a game held through a press that the page scrolls under', async () => {
        render(<Harness />);

        await userEvent.click(handle('Hades'));
        fireEvent.pointerDown(plain(), touch(300));
        fireEvent.scroll(document);
        fireEvent.pointerUp(plain(), touch(300));

        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');
    });

    it('puts a game back once a press away from the handles ends where it began, a fingertip\'s slide included', async () => {
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        await userEvent.click(handle('Hades'));
        fireEvent.pointerDown(plain(), touch(300));
        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');

        fireEvent.pointerUp(plain(), touch(306));

        expect(handle('Hades')).not.toHaveAttribute('aria-pressed');
        expect(onMove).not.toHaveBeenCalled();
        expect(announced()).toBe('Move cancelled. Hades is back at number 2 of 4.');
    });

    it('waits for the release of the press that began away from the handles, and no other', async () => {
        render(<Harness />);

        await userEvent.click(handle('Hades'));
        fireEvent.pointerDown(plain(), touch(300, 2));
        fireEvent.pointerUp(plain(), touch(300, 3));

        expect(handle('Hades')).toHaveAttribute('aria-pressed', 'true');
    });

    it('will not pick up a game whose own save is still out', async () => {
        render(<Harness canMove={id => id !== 2} />);

        await userEvent.click(handle('Hades'));

        expect(handle('Hades')).not.toHaveAttribute('aria-pressed');
        expect(announced()).toBe('Hades cannot be moved right now.');
    });
});

describe('useReorder with a pointer', () => {
    // Rows forty pixels high on a fifty-pixel pitch, the way a table draws them.
    const rows = () => layOut(index => ({ x: 0, y: index * 50, width: 400, height: 40 }));
    const pointer = (clientY: number) => ({ button: 0, pointerId: 1, clientX: 100, clientY });

    it('drops a game dragged up the list in the slot under the pointer', () => {
        rows();
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

    it('drops a game dragged down the list, past where its own element moves', () => {
        // Moving a game down the list moves its own element, which in a browser drops the pointer
        // capture of anything inside it. The list holds the capture, and the list never moves.
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Celeste'), pointer(20));
        fireEvent.pointerMove(handle('Celeste'), pointer(30));
        fireEvent.pointerMove(handle('Celeste'), pointer(120));
        fireEvent.lostPointerCapture(handle('Celeste'), pointer(120));
        fireEvent.pointerMove(handle('Celeste'), pointer(170));
        expect(shown()).toEqual(['Hades', 'Cuphead', 'Outer Wilds', 'Celeste']);

        fireEvent.pointerUp(handle('Celeste'), pointer(170));
        expect(onMove).toHaveBeenCalledExactlyOnceWith(1, 4);
    });

    it('drops a game where a fast drag\'s first move took it, with no move after that one', () => {
        // A flick can cross the threshold and reach its place in one move and be let go there.
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(15));
        expect(shown()).toEqual(['Outer Wilds', 'Celeste', 'Hades', 'Cuphead']);

        fireEvent.pointerUp(handle('Outer Wilds'), pointer(15));
        expect(onMove).toHaveBeenCalledExactlyOnceWith(4, null);
    });

    it('drops a game where the pointer is let go, should the release land past its last move', () => {
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(160));
        fireEvent.pointerUp(handle('Outer Wilds'), pointer(60));

        expect(onMove).toHaveBeenCalledExactlyOnceWith(4, 1);
        expect(shown()).toEqual(['Celeste', 'Outer Wilds', 'Hades', 'Cuphead']);
    });

    it('treats a press that does not travel as no drag at all', () => {
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(168));
        fireEvent.pointerUp(handle('Outer Wilds'), pointer(168));

        expect(onMove).not.toHaveBeenCalled();
        expect(handle('Outer Wilds')).not.toHaveAttribute('aria-pressed');
    });

    it('calls a drag off with Escape, wherever focus is', () => {
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(160));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(15));
        expect(shown()).toEqual(['Outer Wilds', 'Celeste', 'Hades', 'Cuphead']);
        expect(document.documentElement).toHaveClass('reorder-dragging');

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(shown()).toEqual(ORIGINAL);
        expect(document.documentElement).not.toHaveClass('reorder-dragging');

        fireEvent.pointerUp(handle('Outer Wilds'), pointer(15));
        expect(onMove).not.toHaveBeenCalled();
    });

    it('calls a drag off when the browser takes the pointer away', () => {
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(160));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(15));
        expect(shown()).toEqual(['Outer Wilds', 'Celeste', 'Hades', 'Cuphead']);

        fireEvent.pointerCancel(handle('Outer Wilds'), pointer(15));
        expect(shown()).toEqual(ORIGINAL);

        fireEvent.pointerUp(handle('Outer Wilds'), pointer(15));
        expect(onMove).not.toHaveBeenCalled();
    });

    it('calls a drag off when the list loses the pointer it was holding', () => {
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(160));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(15));
        fireEvent.lostPointerCapture(screen.getByRole('list'), pointer(15));

        expect(shown()).toEqual(ORIGINAL);
        fireEvent.pointerUp(handle('Outer Wilds'), pointer(15));
        expect(onMove).not.toHaveBeenCalled();
    });

    it('does not take the click that ends a drag for a tap', () => {
        rows();
        const onMove = vi.fn();
        render(<Harness onMove={onMove} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(160));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(60));
        fireEvent.pointerUp(handle('Outer Wilds'), pointer(60));
        fireEvent.click(handle('Outer Wilds'));

        expect(onMove).toHaveBeenCalledOnce();
        expect(handle('Outer Wilds')).not.toHaveAttribute('aria-pressed');
    });

    it('will not drag a game whose own save is still out', () => {
        rows();
        render(<Harness canMove={id => id !== 4} />);

        fireEvent.pointerDown(handle('Outer Wilds'), pointer(170));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(160));
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(15));

        expect(shown()).toEqual(ORIGINAL);
    });

    it('ignores any button but the main one', () => {
        rows();
        render(<Harness />);

        fireEvent.pointerDown(handle('Outer Wilds'), { ...pointer(170), button: 2 });
        fireEvent.pointerMove(handle('Outer Wilds'), pointer(10));

        expect(handle('Outer Wilds')).not.toHaveAttribute('aria-pressed');
    });
});
