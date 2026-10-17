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

function renderBar(props: { count?: number; working?: string | null } = {}) {
    const handlers = { onMove: vi.fn(), onRemove: vi.fn(), onClear: vi.fn() };
    const view = render(
        <ListBulkBar
            count={props.count ?? 3}
            listName="Playing"
            targets={TARGETS}
            working={props.working ?? null}
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
        expect(within(moves()).getAllByRole('button').map(button => button.textContent))
            .toEqual(['Backlog', 'On Hold', 'Beaten', 'Dropped']);
    });

    it('moves the selection to the list pressed', async () => {
        const { onMove } = renderBar();

        await userEvent.click(within(moves()).getByRole('button', { name: 'Beaten' }));

        expect(onMove).toHaveBeenCalledExactlyOnceWith('finished');
    });

    it('says how to use it, and offers nothing to press, while nothing is selected', () => {
        renderBar({ count: 0 });

        expect(bar()).toHaveTextContent(/tick games to move them/i);
        expect(within(bar()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('stays on the page with nothing selected, so the first tick does not push the rows down', () => {
        const { view } = renderBar({ count: 0 });

        view.rerender(
            <ListBulkBar count={1} listName="Playing" targets={TARGETS} working={null} onMove={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />,
        );

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
        expect(within(moves()).getByRole('button', { name: 'Backlog' })).toHaveFocus();
        await userEvent.tab();
        await userEvent.tab();
        await userEvent.tab();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Remove from list' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Clear selection' })).toHaveFocus();
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
