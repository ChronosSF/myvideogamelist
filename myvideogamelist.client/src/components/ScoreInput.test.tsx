import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoreInput } from '@/components/ScoreInput';

/** Every value is a radio, so this is how a test names the one it means. */
function star(score: number): HTMLInputElement {
    return screen.getByRole('radio', { name: `${score} out of 10` }) as HTMLInputElement;
}

function renderInput(score: number | null, onChange = vi.fn()) {
    const view = render(<ScoreInput score={score} onChange={onChange} gameTitle="Hollow Knight" />);
    return { onChange, view, group: screen.getByLabelText('Your score for Hollow Knight') };
}

describe('ScoreInput', () => {
    it('offers every score from 1 to 10, two to a star', () => {
        renderInput(null);

        const names = screen.getAllByRole('radio').map(r => r.getAttribute('aria-label') ?? r.parentElement?.textContent);
        expect(names).toHaveLength(10);
        expect(screen.getByRole('radio', { name: '1 out of 10' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: '10 out of 10' })).toBeInTheDocument();
    });

    it('shows the current score', () => {
        renderInput(7);

        expect(star(7)).toBeChecked();
        expect(star(8)).not.toBeChecked();
    });

    it('spells the score out as a number as well as in stars', () => {
        // Half a star is hard to read at a glance, and a score is a thing people re-check.
        renderInput(7);

        expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('shows nothing selected when there is no score', () => {
        renderInput(null);

        expect(screen.getAllByRole('radio').some(r => (r as HTMLInputElement).checked)).toBe(false);
        expect(screen.getByText('–')).toBeInTheDocument();
    });

    it('reports the chosen score as a number', async () => {
        const { onChange } = renderInput(null);

        await userEvent.click(star(8));

        expect(onChange).toHaveBeenCalledWith(8);
    });

    it('reports an odd score, which is the point of the half stars', async () => {
        const { onChange } = renderInput(null);

        await userEvent.click(star(9));

        expect(onChange).toHaveBeenCalledWith(9);
    });

    it('reports null when cleared, rather than an empty string or zero', async () => {
        const { onChange } = renderInput(6);

        await userEvent.click(screen.getByRole('button', { name: 'Clear your score for Hollow Knight' }));

        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('clears when the score already given is clicked again', async () => {
        const { onChange } = renderInput(6);

        await userEvent.click(star(6));

        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('offers nothing to clear when there is no score', () => {
        renderInput(null);

        expect(screen.queryByRole('button', { name: /clear your score/i })).not.toBeInTheDocument();
    });

    it('previews the score under the pointer without reporting it', async () => {
        const { onChange } = renderInput(2);

        await userEvent.hover(star(9));

        expect(screen.getByText('9')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows the new value immediately, before the save has been confirmed', async () => {
        // The provider rolls the whole list back if the request fails, so the control is free to
        // reflect the choice at once rather than waiting.
        renderInput(null, vi.fn(() => new Promise<void>(() => {})));

        await userEvent.click(star(9));

        expect(star(9)).toBeChecked();
    });

    it('follows the prop when the row it belongs to changes score elsewhere', () => {
        const { view } = renderInput(3);

        view.rerender(<ScoreInput score={9} onChange={vi.fn()} gameTitle="Hollow Knight" />);

        expect(star(9)).toBeChecked();
    });

    it('reverts when a failed save resets the prop to what it was', () => {
        // What a rollback looks like from the control's side: the parent puts the old value back.
        const { view } = renderInput(null);

        view.rerender(<ScoreInput score={5} onChange={vi.fn()} gameTitle="Hollow Knight" />);
        expect(star(5)).toBeChecked();

        view.rerender(<ScoreInput score={null} onChange={vi.fn()} gameTitle="Hollow Knight" />);
        expect(screen.getAllByRole('radio').some(r => (r as HTMLInputElement).checked)).toBe(false);
    });

    it('names the game it belongs to, since the visible label is the table row', () => {
        renderInput(null);

        expect(screen.getByLabelText('Your score for Hollow Knight')).toBeInTheDocument();
    });

    it('can be disabled while a mutation is in flight', () => {
        render(<ScoreInput score={4} onChange={vi.fn()} gameTitle="Hollow Knight" disabled />);

        // A fieldset, so one attribute disables all ten radios and the clear button with it.
        expect(screen.getByLabelText('Your score for Hollow Knight')).toBeDisabled();
        expect(star(4)).toBeDisabled();
        expect(screen.getByRole('button', { name: /clear your score/i })).toBeDisabled();
    });

    it('keeps two controls on one page independent', async () => {
        const onFirst = vi.fn();
        render(
            <>
                <ScoreInput score={3} onChange={onFirst} gameTitle="Hollow Knight" />
                <ScoreInput score={8} onChange={vi.fn()} gameTitle="Celeste" />
            </>,
        );

        const [hollowKnight, celeste] = screen.getAllByRole('group') as HTMLFieldSetElement[];
        expect(hollowKnight.querySelector<HTMLInputElement>('input[value="3"]')).toBeChecked();
        expect(celeste.querySelector<HTMLInputElement>('input[value="8"]')).toBeChecked();

        await userEvent.click(hollowKnight.querySelector<HTMLInputElement>('input[value="5"]')!);

        expect(onFirst).toHaveBeenCalledWith(5);
        expect(celeste.querySelector<HTMLInputElement>('input[value="8"]')).toBeChecked();
    });

    it('gives every control its own radio group name', () => {
        // A table has one of these per row. React restores the checked state of same-named
        // radios, so a shared name does not show up as a wrong star — it shows up as arrow keys
        // walking out of the row you are scoring and into the next one, which jsdom cannot
        // reproduce. Hence a structural assertion rather than a behavioural one.
        render(
            <>
                <ScoreInput score={3} onChange={vi.fn()} gameTitle="Hollow Knight" />
                <ScoreInput score={8} onChange={vi.fn()} gameTitle="Celeste" />
            </>,
        );

        const names = new Set(screen.getAllByRole('radio').map(radio => radio.getAttribute('name')));
        expect(names.size).toBe(2);
    });
});
