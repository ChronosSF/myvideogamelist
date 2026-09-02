import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListToolbar } from '@/components/ListToolbar';
import { DEFAULT_SORT, type SortState } from '@/lib/listSort';
import { platform } from '@/test/factories';

const PLATFORMS = [platform(6, 'PC', 'PC'), platform(48, 'PlayStation 4', 'PS4'), platform(130, 'Switch')];

function renderToolbar(overrides: {
    sort?: SortState;
    selectedPlatformIds?: number[];
    platforms?: typeof PLATFORMS;
    view?: 'tiles' | 'table';
} = {}) {
    const handlers = {
        onViewChange: vi.fn(),
        onSortChange: vi.fn(),
        onPlatformsChange: vi.fn(),
    };

    render(
        <ListToolbar
            view={overrides.view ?? 'tiles'}
            sort={overrides.sort ?? DEFAULT_SORT}
            platforms={overrides.platforms ?? PLATFORMS}
            selectedPlatformIds={overrides.selectedPlatformIds ?? []}
            {...handlers}
        />,
    );

    return handlers;
}

describe('ListToolbar sorting', () => {
    it('shows the current sort key', () => {
        renderToolbar({ sort: { key: 'score', descending: true } });
        expect((screen.getByLabelText('Sort') as HTMLSelectElement).value).toBe('score');
    });

    it('adopts the sensible direction when a new key is chosen', async () => {
        // Picking "My score" should mean best-first, not 1-first, without a second click.
        const { onSortChange } = renderToolbar({ sort: { key: 'title', descending: false } });

        await userEvent.selectOptions(screen.getByLabelText('Sort'), 'score');

        expect(onSortChange).toHaveBeenCalledWith({ key: 'score', descending: true });
    });

    it('chooses ascending for title, where A-Z is what people expect', async () => {
        const { onSortChange } = renderToolbar({ sort: { key: 'score', descending: true } });

        await userEvent.selectOptions(screen.getByLabelText('Sort'), 'title');

        expect(onSortChange).toHaveBeenCalledWith({ key: 'title', descending: false });
    });

    it('flips direction without changing the key', async () => {
        const { onSortChange } = renderToolbar({ sort: { key: 'added', descending: true } });

        await userEvent.click(screen.getByRole('button', { name: /switch to ascending/i }));

        expect(onSortChange).toHaveBeenCalledWith({ key: 'added', descending: false });
    });

    it('describes the direction it would switch to, not the one it is in', () => {
        renderToolbar({ sort: { key: 'added', descending: false } });
        expect(screen.getByRole('button', { name: /switch to descending/i })).toBeInTheDocument();
    });
});

describe('ListToolbar view switching', () => {
    it('marks the active layout as pressed', () => {
        renderToolbar({ view: 'table' });

        expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('reports the layout the user picked', async () => {
        const { onViewChange } = renderToolbar({ view: 'tiles' });

        await userEvent.click(screen.getByRole('button', { name: 'Table' }));

        expect(onViewChange).toHaveBeenCalledWith('table');
    });
});

describe('ListToolbar platform filter', () => {
    it('reads as "All platforms" when nothing is selected', () => {
        renderToolbar({ selectedPlatformIds: [] });
        expect(screen.getByRole('button', { name: /all platforms/i })).toBeInTheDocument();
    });

    it('counts the selection once the filter is narrowed', () => {
        renderToolbar({ selectedPlatformIds: [6, 48] });
        expect(screen.getByRole('button', { name: '2 platforms' })).toBeInTheDocument();
    });

    it('uses the singular for one platform', () => {
        renderToolbar({ selectedPlatformIds: [6] });
        expect(screen.getByRole('button', { name: '1 platform' })).toBeInTheDocument();
    });

    it('hides itself when there is nothing to choose between', () => {
        // One platform across every list means the filter can only ever be a no-op.
        renderToolbar({ platforms: [platform(6, 'PC')] });
        expect(screen.queryByRole('button', { name: /all platforms/i })).not.toBeInTheDocument();
    });

    it('shows every platform checked while the filter is inert', async () => {
        renderToolbar({ selectedPlatformIds: [] });

        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));

        for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
    });

    it('seeds the selection with everything-but-one on the first uncheck', async () => {
        // The tricky bit: an empty selection means "all", so unchecking one from that state has
        // to expand to the explicit set rather than leaving a single-item selection.
        const { onPlatformsChange } = renderToolbar({ selectedPlatformIds: [] });

        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'PlayStation 4' }));

        expect(onPlatformsChange).toHaveBeenCalledWith([6, 130]);
    });

    it('collapses back to "all" when every platform ends up checked again', async () => {
        // Otherwise the button would read "3 platforms" while filtering nothing.
        const { onPlatformsChange } = renderToolbar({ selectedPlatformIds: [6, 48] });

        await userEvent.click(screen.getByRole('button', { name: '2 platforms' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Switch' }));

        expect(onPlatformsChange).toHaveBeenCalledWith([]);
    });

    it('resets to everything', async () => {
        const { onPlatformsChange } = renderToolbar({ selectedPlatformIds: [6] });

        await userEvent.click(screen.getByRole('button', { name: '1 platform' }));
        await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(onPlatformsChange).toHaveBeenCalledWith([]);
    });

    it('offers no reset when there is nothing to reset', async () => {
        renderToolbar({ selectedPlatformIds: [] });

        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));

        expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });

    it('says that the filter is not saved', async () => {
        // This sentence is what keeps the transient filter from being read as the saved, global
        // hidden-platforms preference. If it disappears, the two controls become indistinguishable.
        renderToolbar();

        await userEvent.click(screen.getByRole('button', { name: /all platforms/i }));

        expect(screen.getByText(/applies to this view only, and is not saved/i)).toBeInTheDocument();
    });

    it('closes when the backdrop is clicked', async () => {
        renderToolbar();
        const trigger = screen.getByRole('button', { name: /all platforms/i });

        await userEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        await userEvent.click(document.querySelector('.list-toolbar-backdrop')!);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
});
