import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoreInput } from '@/components/ScoreInput';

function renderInput(score: number | null, onChange = vi.fn()) {
    const view = render(<ScoreInput score={score} onChange={onChange} gameTitle="Hollow Knight" />);
    return { onChange, select: screen.getByRole('combobox') as HTMLSelectElement, view };
}

describe('ScoreInput', () => {
    it('offers every score from 1 to 10 plus a way to clear it', () => {
        renderInput(null);

        const values = screen.getAllByRole('option').map(o => (o as HTMLOptionElement).value);
        expect(values).toEqual(['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    });

    it('shows the current score', () => {
        const { select } = renderInput(7);
        expect(select.value).toBe('7');
    });

    it('shows nothing selected when there is no score', () => {
        const { select } = renderInput(null);
        expect(select.value).toBe('');
    });

    it('reports the chosen score as a number', async () => {
        const { select, onChange } = renderInput(null);

        await userEvent.selectOptions(select, '8');

        expect(onChange).toHaveBeenCalledWith(8);
    });

    it('reports null when cleared, rather than an empty string or zero', async () => {
        const { select, onChange } = renderInput(6);

        await userEvent.selectOptions(select, '');

        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('shows the new value immediately, before the save has been confirmed', async () => {
        // The provider rolls the whole list back if the request fails, so the control is free to
        // reflect the choice at once rather than waiting.
        const { select } = renderInput(null, vi.fn(() => new Promise<void>(() => {})));

        await userEvent.selectOptions(select, '9');

        expect(select.value).toBe('9');
    });

    it('follows the prop when the row it belongs to changes score elsewhere', () => {
        const { view } = renderInput(3);

        view.rerender(<ScoreInput score={9} onChange={vi.fn()} gameTitle="Hollow Knight" />);

        expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('9');
    });

    it('reverts when a failed save resets the prop to what it was', () => {
        // What a rollback looks like from the control's side: the parent puts the old value back.
        const { view } = renderInput(null);

        view.rerender(<ScoreInput score={5} onChange={vi.fn()} gameTitle="Hollow Knight" />);
        expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('5');

        view.rerender(<ScoreInput score={null} onChange={vi.fn()} gameTitle="Hollow Knight" />);
        expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    });

    it('names the game it belongs to, since the visible label is the table row', () => {
        renderInput(null);
        expect(screen.getByLabelText('Your score for Hollow Knight')).toBeInTheDocument();
    });

    it('can be disabled while a mutation is in flight', () => {
        render(<ScoreInput score={4} onChange={vi.fn()} gameTitle="Hollow Knight" disabled />);
        expect(screen.getByRole('combobox')).toBeDisabled();
    });
});
