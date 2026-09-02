import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ListTable } from '@/components/ListTable';
import { DEFAULT_SORT, type SortState } from '@/lib/listSort';
import { MIN_CRITIC_REVIEWS } from '@/lib/score';
import { entry, platform } from '@/test/factories';

function renderTable(overrides: {
    entries?: ReturnType<typeof entry>[];
    sort?: SortState;
    pendingIds?: number[];
} = {}) {
    const handlers = {
        onSortChange: vi.fn(),
        onScoreChange: vi.fn(),
        onRemove: vi.fn(),
    };
    const pending = overrides.pendingIds ?? [];

    render(
        <MemoryRouter>
            <ListTable
                entries={overrides.entries ?? [entry({ game: { id: 1, title: 'Celeste' } })]}
                sort={overrides.sort ?? DEFAULT_SORT}
                listName="Playing"
                isPending={id => pending.includes(id)}
                {...handlers}
            />
        </MemoryRouter>,
    );

    return handlers;
}

/** The row for a game, so cell assertions cannot accidentally match another row. */
function row(title: string): HTMLElement {
    return screen.getByRole('link', { name: title }).closest('tr')!;
}

describe('ListTable contents', () => {
    it('links each title to its game page', () => {
        renderTable({ entries: [entry({ game: { id: 42, title: 'Tunic' } })] });

        expect(screen.getByRole('link', { name: 'Tunic' })).toHaveAttribute('href', '/games/42');
    });

    it('shows the release year rather than the full date', () => {
        renderTable({ entries: [entry({ game: { title: 'Hades', releaseDate: '2020-09-17' } })] });

        expect(within(row('Hades')).getByText('2020')).toBeInTheDocument();
    });

    it('shows the player rating out of 100, like the critic score beside it', () => {
        // IGDB sends it on a 0-10 scale; ADR 0021 puts every aggregate on one scale so that the
        // two numbers in a row can be compared without the reader converting in their head.
        renderTable({ entries: [entry({ game: { title: 'Hades', rating: 9.25 } })] });

        expect(within(row('Hades')).getByText('93')).toBeInTheDocument();
    });

    it('abbreviates the platforms', () => {
        renderTable({
            entries: [entry({
                game: {
                    title: 'Hades',
                    platforms: [platform(6, 'PC', 'PC'), platform(130, 'Nintendo Switch', 'Switch')],
                },
            })],
        });

        expect(within(row('Hades')).getByText('PC, Switch')).toBeInTheDocument();
    });

    it('leaves an em dash where a game has no data', () => {
        renderTable({ entries: [entry({ game: { title: 'Mystery' } })] });

        // Release year, rating, critic score and platforms are all absent on this fixture.
        expect(within(row('Mystery')).getAllByText('—')).toHaveLength(4);
    });

    it('renders one row per entry', () => {
        renderTable({
            entries: [
                entry({ game: { id: 1, title: 'One' } }),
                entry({ game: { id: 2, title: 'Two' } }),
            ],
        });

        expect(screen.getAllByRole('row')).toHaveLength(3); // header plus two
    });
});

describe('ListTable critic score', () => {
    // Same rule as the browse badges (ADR 0016): IGDB averages with no floor, so a score backed
    // by one review is not worth printing.
    it('shows a critic score backed by enough reviews', () => {
        renderTable({
            entries: [entry({
                game: { title: 'Hades', criticScore: 93, criticScoreCount: MIN_CRITIC_REVIEWS },
            })],
        });

        expect(within(row('Hades')).getByText('93')).toBeInTheDocument();
    });

    it('suppresses a critic score backed by too few', () => {
        renderTable({
            entries: [entry({
                game: { title: 'Obscure', criticScore: 100, criticScoreCount: MIN_CRITIC_REVIEWS - 1 },
            })],
        });

        expect(within(row('Obscure')).queryByText('100')).not.toBeInTheDocument();
    });

    it('suppresses a critic score with no count at all', () => {
        renderTable({
            entries: [entry({ game: { title: 'Unknown', criticScore: 88, criticScoreCount: null } })],
        });

        expect(within(row('Unknown')).queryByText('88')).not.toBeInTheDocument();
    });
});

describe('ListTable column sorting', () => {
    it('sorts by a new column in its natural direction', async () => {
        const { onSortChange } = renderTable({ sort: { key: 'added', descending: true } });

        await userEvent.click(screen.getByRole('button', { name: /^Score/ }));

        expect(onSortChange).toHaveBeenCalledWith({ key: 'score', descending: true });
    });

    it('flips direction when the already-active column is clicked', async () => {
        const { onSortChange } = renderTable({ sort: { key: 'score', descending: true } });

        await userEvent.click(screen.getByRole('button', { name: /^Score/ }));

        expect(onSortChange).toHaveBeenCalledWith({ key: 'score', descending: false });
    });

    it('marks the sorted column for assistive technology', () => {
        renderTable({ sort: { key: 'title', descending: false } });

        expect(screen.getByRole('columnheader', { name: /^Title/ })).toHaveAttribute('aria-sort', 'ascending');
        expect(screen.getByRole('columnheader', { name: /^Score/ })).toHaveAttribute('aria-sort', 'none');
    });

    it('reports descending when the sort is descending', () => {
        renderTable({ sort: { key: 'added', descending: true } });

        expect(screen.getByRole('columnheader', { name: /^Added/ })).toHaveAttribute('aria-sort', 'descending');
    });

    it('offers a header button for every sortable column', () => {
        renderTable();

        for (const label of ['Title', 'Score', 'Rating', 'Critics', 'Released', 'Added']) {
            expect(
                screen.getByRole('button', { name: new RegExp(`^${label}`) }),
                `${label} header`,
            ).toBeInTheDocument();
        }
    });
});

describe('ListTable actions', () => {
    it('reports a score change with the game it belongs to', async () => {
        const { onScoreChange } = renderTable({
            entries: [entry({ game: { id: 7, title: 'Celeste' }, score: null })],
        });

        await userEvent.click(screen.getByRole('radio', { name: '10 out of 10' }));

        expect(onScoreChange).toHaveBeenCalledWith(7, 10);
    });

    it('reports a removal', async () => {
        const { onRemove } = renderTable({ entries: [entry({ game: { id: 7, title: 'Celeste' } })] });

        await userEvent.click(screen.getByRole('button', { name: /take celeste out of this list/i }));

        expect(onRemove).toHaveBeenCalledWith(7);
    });

    it('disables the controls on a row with a mutation in flight', () => {
        renderTable({
            entries: [entry({ game: { id: 7, title: 'Celeste' } })],
            pendingIds: [7],
        });

        expect(screen.getByLabelText('Your score for Celeste')).toBeDisabled();
        expect(screen.getByRole('button', { name: /take celeste out/i })).toBeDisabled();
    });

    it('leaves other rows usable while one is pending', () => {
        renderTable({
            entries: [
                entry({ game: { id: 7, title: 'Pending' } }),
                entry({ game: { id: 8, title: 'Ready' } }),
            ],
            pendingIds: [7],
        });

        expect(screen.getByLabelText('Your score for Ready')).toBeEnabled();
    });
});
