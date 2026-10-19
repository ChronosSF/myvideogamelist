import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminStatsCard } from '@/components/AdminStatsCard';
import { adminStats } from '@/test/factories';

/** The figure a label names, read the way a screen reader pairs a term with its description. */
function figure(label: string): string | null {
    const term = screen.getByText(label, { selector: 'dt' });
    return term.nextElementSibling?.textContent ?? null;
}

describe('AdminStatsCard', () => {
    it('shows every count, with the lists under their default names', () => {
        render(<AdminStatsCard stats={adminStats()} error={null} reload={vi.fn()} />);

        expect(figure('Accounts')).toBe('42');
        expect(figure('Seen today')).toBe('3');
        expect(figure('Seen in 30 days')).toBe('25');
        expect(figure('Backlog')).toBe('310');
        expect(figure('On Hold')).toBe('12');
        expect(figure('Marked public')).toBe('20');
        expect(figure('Under review')).toBe('1');
    });

    it('lists the twelve weeks newest first', () => {
        render(<AdminStatsCard stats={adminStats()} error={null} reload={vi.fn()} />);

        const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(12);
        expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('Oct 12');
        expect(within(rows[0]).getAllByRole('cell')[0]).toHaveTextContent('4');
        expect(within(rows[11]).getByRole('rowheader')).toHaveTextContent('Jul 27');
    });

    it('says how many accounts are older than the sign-up dates, only when there are some', () => {
        const { rerender } = render(<AdminStatsCard stats={adminStats()} error={null} reload={vi.fn()} />);
        expect(screen.queryByText(/before sign-up dates were recorded/)).not.toBeInTheDocument();

        const older = adminStats();
        older.accounts = { ...older.accounts, undated: 5 };
        rerender(<AdminStatsCard stats={older} error={null} reload={vi.fn()} />);
        expect(screen.getByText(/5 accounts are from before sign-up dates were recorded/)).toBeInTheDocument();
    });

    it('offers a retry when the count failed, and says it is counting while it counts', async () => {
        const reload = vi.fn();
        const { rerender } = render(<AdminStatsCard stats={null} error={null} reload={reload} />);
        expect(screen.getByRole('status')).toHaveTextContent('Counting…');

        rerender(<AdminStatsCard stats={null} error="The statistics could not be counted (500)." reload={reload} />);
        expect(screen.getByRole('alert')).toHaveTextContent('could not be counted');
        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
        expect(reload).toHaveBeenCalledOnce();
    });
});
