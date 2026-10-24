import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListTagFilter } from '@/components/ListTagFilter';
import { tag } from '@/test/factories';

const COOP = tag({ id: 1, name: 'Co-op' });
const SHORT = tag({ id: 2, name: 'short' });

function renderFilter(overrides: Partial<Parameters<typeof ListTagFilter>[0]> = {}) {
    const onChange = vi.fn();
    render(
        <ListTagFilter
            tags={[COOP, SHORT]}
            selected={[]}
            onChange={onChange}
            countFor={id => (id === 1 ? 3 : 1)}
            shown={12}
            total={12}
            {...overrides}
        />,
    );
    return { onChange };
}

const button = () => screen.getByRole('button', { name: /tag/i });

describe('ListTagFilter', () => {
    it('draws nothing when no game in the lists carries a tag', () => {
        const { container } = render(
            <ListTagFilter tags={[]} selected={[]} onChange={vi.fn()} countFor={() => 0} shown={0} total={0} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('says what is ticked on its button, which is its whole name', () => {
        renderFilter();
        expect(screen.getByRole('button', { name: 'Filter by tag' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('names the one tag ticked, and counts several', () => {
        const { unmount } = render(
            <ListTagFilter tags={[COOP, SHORT]} selected={[1]} onChange={vi.fn()} countFor={() => 1} shown={3} total={12} />,
        );
        expect(screen.getByRole('button', { name: 'Tag: Co-op' })).toBeInTheDocument();
        unmount();

        renderFilter({ selected: [1, 2] });
        expect(screen.getByRole('button', { name: '2 tags' })).toBeInTheDocument();
    });

    it('opens a group of checkboxes named by its heading, each saying how many games here carry it', async () => {
        renderFilter();

        await userEvent.click(button());

        expect(button()).toHaveAttribute('aria-expanded', 'true');
        const group = screen.getByRole('group', { name: 'Filter by tag' });
        expect(within(group).getByRole('checkbox', { name: 'Co-op, 3 games in this list' })).not.toBeChecked();
        expect(within(group).getByRole('checkbox', { name: 'short, 1 game in this list' })).not.toBeChecked();
        expect(screen.getByText(/carrying every tag ticked/i)).toBeInTheDocument();
        expect(screen.getByText(/is not saved/i)).toBeInTheDocument();
    });

    it('adds a tag to what is ticked, and takes one off again', async () => {
        const first = renderFilter({ selected: [2] });
        await userEvent.click(button());

        await userEvent.click(screen.getByRole('checkbox', { name: /^Co-op/ }));
        expect(first.onChange).toHaveBeenLastCalledWith([2, 1]);

        await userEvent.click(screen.getByRole('checkbox', { name: /^short/ }));
        expect(first.onChange).toHaveBeenLastCalledWith([]);
    });

    it('resets everything at once', async () => {
        const { onChange } = renderFilter({ selected: [1, 2] });
        await userEvent.click(button());

        await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('closes on Escape and puts the focus back on its button', async () => {
        renderFilter();
        await userEvent.click(button());
        await userEvent.click(screen.getByRole('checkbox', { name: /^short/ }));

        await userEvent.keyboard('{Escape}');

        expect(screen.queryByRole('group', { name: 'Filter by tag' })).not.toBeInTheDocument();
        expect(button()).toHaveFocus();
    });

    it('opens from the button’s right edge when its left edge is too near the right of a narrow screen', async () => {
        // jsdom lays nothing out, so the button is given the place it has on a 375px phone with the
        // toolbar wrapped: a panel opened from its left edge would run off the screen.
        renderFilter();
        const original = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
        vi.spyOn(button(), 'getBoundingClientRect').mockReturnValue(
            { left: 240, right: 359, top: 0, bottom: 32, width: 119, height: 32, x: 240, y: 0, toJSON: () => ({}) } as DOMRect);

        try {
            await userEvent.click(button());

            // A layout class, which is the whole of the behaviour: there is no role or name to ask for.
            expect(screen.getByRole('group', { name: 'Filter by tag' }).closest('.list-tag-filter-panel'))
                .toHaveClass('align-end');
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
        }
    });

    it('opens from the button’s left edge when there is room', async () => {
        renderFilter();
        vi.spyOn(button(), 'getBoundingClientRect').mockReturnValue(
            { left: 16, right: 135, top: 0, bottom: 32, width: 119, height: 32, x: 16, y: 0, toJSON: () => ({}) } as DOMRect);

        await userEvent.click(button());

        expect(screen.getByRole('group', { name: 'Filter by tag' }).closest('.list-tag-filter-panel'))
            .not.toHaveClass('align-end');
    });

    it('says how many games are left while a tag is ticked, and nothing while none is', () => {
        const { unmount } = render(
            <ListTagFilter tags={[COOP, SHORT]} selected={[1]} onChange={vi.fn()} countFor={() => 1} shown={3} total={1200} />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('3 of 1,200 games shown.');
        unmount();

        renderFilter();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('says every game is shown again once the last tick is taken off', async () => {
        // A status that only went quiet would announce nothing at all.
        const onChange = vi.fn();
        const { rerender } = render(
            <ListTagFilter tags={[COOP, SHORT]} selected={[1]} onChange={onChange} countFor={() => 1} shown={3} total={12} />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Tag: Co-op' }));
        await userEvent.click(screen.getByRole('checkbox', { name: /^Co-op/ }));
        expect(onChange).toHaveBeenLastCalledWith([]);

        rerender(<ListTagFilter tags={[COOP, SHORT]} selected={[]} onChange={onChange} countFor={() => 1} shown={12} total={12} />);

        expect(screen.getByRole('status')).toHaveTextContent('All 12 games shown.');
    });

    it('keeps its checkboxes in a list, inside a group named by its heading', async () => {
        // The group on the panel rather than on the list, so the list keeps its own role.
        renderFilter();
        await userEvent.click(button());

        const group = screen.getByRole('group', { name: 'Filter by tag' });
        expect(within(within(group).getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
    });
});
