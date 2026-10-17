import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListBulkBar } from '@/components/ListBulkBar';
import type { ListId } from '@/types/list';

const TARGETS: { id: ListId; name: string }[] = [
    { id: 'backlog', name: 'Backlog' },
    { id: 'on_hold', name: 'On Hold' },
    { id: 'finished', name: 'Beaten' },
    { id: 'dropped', name: 'Dropped' },
];

function renderBar(props: { count?: number; working?: string | null; problem?: string | null } = {}) {
    const handlers = { onMove: vi.fn(), onRemove: vi.fn(), onClear: vi.fn() };
    const view = render(
        <ListBulkBar
            count={props.count ?? 3}
            listName="Playing"
            targets={TARGETS}
            working={props.working ?? null}
            problem={props.problem ?? null}
            {...handlers}
        />,
    );
    return { ...handlers, view };
}

const bar = () => screen.getByRole('region', { name: 'Selected games' });
const moves = () => within(bar()).getByRole('group', { name: 'Move the selected games to' });

describe('ListBulkBar', () => {
    it('names how many games are selected, and offers every other list by its owner\'s name', () => {
        renderBar({ count: 3 });

        expect(bar()).toHaveTextContent('3 games selected');
        // Each says where it moves to in its own name, the visible words being the list's alone.
        expect(within(moves()).getAllByRole('button').map(button => button.textContent))
            .toEqual(['Move to Backlog', 'Move to On Hold', 'Move to Beaten', 'Move to Dropped']);
        expect(within(moves()).getByRole('button', { name: 'Move to Beaten' })).toBeInTheDocument();
    });

    it('moves the selection to the list pressed', async () => {
        const { onMove } = renderBar();

        await userEvent.click(within(moves()).getByRole('button', { name: 'Move to Beaten' }));

        expect(onMove).toHaveBeenCalledExactlyOnceWith('finished');
    });

    it('says how to use it, and offers nothing to press, while nothing is selected', () => {
        renderBar({ count: 0 });

        expect(bar()).toHaveTextContent(/tick games to move them/i);
        expect(within(bar()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('stays on the page with nothing selected, so the first tick does not push the rows down', () => {
        const { view } = renderBar({ count: 0 });
        const before = bar();

        view.rerender(
            <ListBulkBar count={1} listName="Playing" targets={TARGETS} working={null} onMove={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />,
        );

        // The same element, its content changed: jsdom lays nothing out, so the steady height is the
        // stylesheet's to keep and was measured in a browser.
        expect(bar()).toBe(before);
        expect(bar()).toHaveTextContent('1 game selected');
    });

    it('clears the selection', async () => {
        const { onClear } = renderBar();

        await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

        expect(onClear).toHaveBeenCalledOnce();
    });

    it('asks before taking games out, and focuses the harmless answer', async () => {
        const { onRemove } = renderBar({ count: 3 });

        await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));

        const question = screen.getByRole('group', { name: /take 3 games out of playing\?/i });
        expect(question).toHaveTextContent(/scores, ownership, notes and playthroughs stay/i);
        expect(within(question).getByRole('button', { name: 'Cancel' })).toHaveFocus();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('takes them out once the question is answered', async () => {
        const { onRemove } = renderBar({ count: 3 });

        await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
        await userEvent.click(screen.getByRole('button', { name: 'Remove 3 games' }));

        expect(onRemove).toHaveBeenCalledOnce();
        expect(screen.queryByRole('group', { name: /take 3 games out/i })).not.toBeInTheDocument();
    });

    it('puts focus back on the button that asked when the question is called off', async () => {
        const { onRemove } = renderBar();

        await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.getByRole('button', { name: 'Remove from list' })).toHaveFocus();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('calls the question off with Escape, and puts focus back the same way', async () => {
        const { onRemove } = renderBar();

        await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
        await userEvent.keyboard('{Escape}');

        expect(screen.queryByRole('group', { name: /take 3 games out/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove from list' })).toHaveFocus();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('is reached from the keyboard, in the order it reads', async () => {
        renderBar();

        await userEvent.tab();
        expect(within(moves()).getByRole('button', { name: 'Move to Backlog' })).toHaveFocus();
        await userEvent.tab();
        await userEvent.tab();
        await userEvent.tab();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Remove from list' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Clear selection' })).toHaveFocus();
    });

    it('says why the last action did not do all it was asked, in place of the count, and keeps its controls', () => {
        renderBar({ count: 2, problem: 'Failed to move 2 games to Beaten. Please try again.' });

        expect(bar()).toHaveTextContent('Failed to move 2 games to Beaten. Please try again.');
        expect(bar()).not.toHaveTextContent('2 games selected');
        expect(within(moves()).getByRole('button', { name: 'Move to Beaten' })).toBeInTheDocument();
    });

    it('says it in place of the hint once nothing is left selected', () => {
        renderBar({ count: 0, problem: 'None of the 2 games were moved: they are no longer in your lists.' });

        expect(bar()).toHaveTextContent('None of the 2 games were moved');
        expect(bar()).not.toHaveTextContent(/tick games/i);
    });

    it('says what it is doing in place of its controls while an action is out', () => {
        renderBar({ count: 3, working: 'Moving 3 games to Beaten…' });

        expect(bar()).toHaveTextContent('Moving 3 games to Beaten…');
        expect(within(bar()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('drops a question about games nobody has selected any more, for good', async () => {
        const { view } = renderBar({ count: 2 });
        await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
        const withCount = (count: number) => (
            <ListBulkBar count={count} listName="Playing" targets={TARGETS} working={null} onMove={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />
        );

        view.rerender(withCount(0));
        expect(screen.queryByRole('group', { name: /take/i })).not.toBeInTheDocument();
        expect(bar()).toHaveTextContent(/tick games/i);

        // Ticking a game again is not pressing Remove: the question stays gone.
        view.rerender(withCount(1));
        expect(screen.queryByRole('group', { name: /take/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove from list' })).toBeInTheDocument();
    });
});
