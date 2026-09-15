import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameBrowseFilters } from '@/components/GameBrowseFilters';
import { EMPTY_BROWSE, type GameBrowse } from '@/lib/gameBrowse';
import type { GenreDto, PlatformDto } from '@/types/game';
import { platform } from '@/test/factories';

const PLATFORMS: PlatformDto[] = [platform(6, 'PC (Windows)', 'PC'), platform(130, 'Nintendo Switch', 'Switch')];
const GENRES: GenreDto[] = [
    { id: 31, name: 'Adventure', description: null },
    { id: 12, name: 'Role-playing (RPG)', description: null },
];

function renderFilters(
    browse: Partial<GameBrowse> = {},
    lists: { platforms?: PlatformDto[] | null; genres?: GenreDto[] | null } = {},
) {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
        <GameBrowseFilters
            browse={{ ...EMPTY_BROWSE, ...browse }}
            platforms={lists.platforms === undefined ? PLATFORMS : lists.platforms}
            genres={lists.genres === undefined ? GENRES : lists.genres}
            years={[2026, 2025, 2024]}
            onChange={onChange}
            onClear={onClear}
        />,
    );
    return { onChange, onClear };
}

describe('GameBrowseFilters', () => {
    it('shows what the URL chose', () => {
        renderFilters({ sort: 'popular', platform: 130, genre: 12, year: 2025, minScore: 80 });

        expect(screen.getByLabelText('Order')).toHaveValue('popular');
        expect(screen.getByLabelText('Platform')).toHaveValue('130');
        expect(screen.getByLabelText('Genre')).toHaveValue('12');
        expect(screen.getByLabelText('Released')).toHaveValue('2025');
        expect(screen.getByLabelText('Critic score')).toHaveValue('80');
    });

    it('reports a change of order', async () => {
        const actor = userEvent.setup();
        const { onChange } = renderFilters();

        await actor.selectOptions(screen.getByLabelText('Order'), 'Newest');

        expect(onChange).toHaveBeenCalledWith({ sort: 'newest' });
    });

    it('reports a filter as a number, and "any" as null', async () => {
        const actor = userEvent.setup();
        const { onChange } = renderFilters({ genre: 12 });

        await actor.selectOptions(screen.getByLabelText('Platform'), 'Nintendo Switch');
        await actor.selectOptions(screen.getByLabelText('Genre'), 'All genres');

        expect(onChange).toHaveBeenCalledWith({ platform: 130 });
        expect(onChange).toHaveBeenCalledWith({ genre: null });
    });

    it('offers critic scores out of 100, never as stars', () => {
        // ADR 0021: an aggregate is a number out of 100.
        renderFilters();

        expect(screen.getByRole('option', { name: '80 and above' })).toBeInTheDocument();
    });

    it('says what the chosen order leaves out', () => {
        renderFilters({ sort: 'rating' });

        expect(screen.getByLabelText('Order')).toHaveAccessibleDescription(/at least eight critic reviews/i);
    });

    it('turns the order off while searching, and says why', () => {
        // IGDB orders a search itself and refuses one that asks for an order.
        renderFilters({ search: 'zelda', sort: 'newest' });

        const order = screen.getByLabelText('Order');
        expect(order).toBeDisabled();
        expect(order).toHaveValue('relevance');
        expect(order).toHaveAccessibleDescription(/how well they match/i);
        expect(screen.getByLabelText('Platform')).toBeEnabled();
    });

    it('leaves out a filter whose options could not be loaded', () => {
        renderFilters({}, { genres: null });

        expect(screen.queryByLabelText('Genre')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Platform')).toBeInTheDocument();
    });

    it('offers to clear the filters only when there are some', async () => {
        const actor = userEvent.setup();

        const { onClear } = renderFilters({ year: 2024 });
        await actor.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(onClear).toHaveBeenCalled();
    });

    it('does not offer to clear an order, which is not a filter', () => {
        renderFilters({ sort: 'name' });

        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });
});
