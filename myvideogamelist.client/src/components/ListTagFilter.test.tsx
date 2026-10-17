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

    it('says how many games are left while a tag is ticked, and nothing while none is', () => {
        const { unmount } = render(
            <ListTagFilter tags={[COOP, SHORT]} selected={[1]} onChange={vi.fn()} countFor={() => 1} shown={3} total={1200} />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('3 of 1,200 games shown.');
        unmount();

        renderFilter();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });
});
