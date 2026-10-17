import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewForm } from '@/components/ReviewForm';
import type { ReviewDto } from '@/types/playthrough';
import { playthrough, review } from '@/test/factories';

/**
 * The form on its own: what each field becomes in the request, and what an existing review puts
 * back into the fields. The panel's suite saves and deletes through it and covers what the hints say;
 * this is about the shape the API is sent (ADR 0025).
 */

const RUNS = [playthrough({ id: 5, type: 'completionist' }), playthrough({ id: 6, type: null })];

function renderForm(written: ReviewDto | null = null, state: { pending?: boolean; error?: string | null } = {}) {
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const props = {
        playthroughs: RUNS,
        profileVisibility: 'public' as const,
        onSave,
        onDelete,
        pending: state.pending ?? false,
        error: state.error ?? null,
    };
    const { rerender } = render(<ReviewForm {...props} review={written} />);
    return {
        onSave,
        onDelete,
        /** The panel handing the form the review as it now stands: arrived, saved or deleted. */
        reviewIs: (next: ReviewDto | null) => rerender(<ReviewForm {...props} review={next} />),
    };
}

/** Skips user-event's pause between keystrokes, which costs a timer per character. */
const setupActor = () => userEvent.setup({ delay: null });

const field = (label: string | RegExp) => screen.getByLabelText(label);

describe('ReviewForm', () => {
    it('sends the review trimmed, with its spoiler flag and who can see it', async () => {
        const actor = setupActor();
        const { onSave } = renderForm();

        await actor.type(field('What you thought'), '  Superb, start to finish.  ');
        await actor.click(field(/contains spoilers/i));
        await actor.selectOptions(field('Who can see it'), 'Anyone');
        await actor.click(screen.getByRole('button', { name: 'Save review' }));

        expect(onSave).toHaveBeenCalledWith({
            body: 'Superb, start to finish.',
            hasSpoilers: true,
            visibility: 'public',
            playthroughId: null,
        });
    });

    it('names the playthrough it is about by its id, and the game in general as none', async () => {
        const actor = setupActor();
        const { onSave } = renderForm();

        await actor.type(field('What you thought'), 'The completionist run was the one.');
        await actor.selectOptions(field('About which playthrough'), '1. Completionist');
        await actor.click(screen.getByRole('button', { name: 'Save review' }));
        await actor.selectOptions(field('About which playthrough'), 'The game in general');
        await actor.click(screen.getByRole('button', { name: 'Save review' }));

        expect(onSave.mock.calls.map(([input]) => input.playthroughId)).toEqual([5, null]);
    });

    it('puts a written review back into the fields, the playthrough it names included', () => {
        renderForm(review({ body: 'Second time round.', hasSpoilers: true, visibility: 'public', playthroughId: 6 }));

        expect(field('What you thought')).toHaveValue('Second time round.');
        expect(field(/contains spoilers/i)).toBeChecked();
        expect(field('Who can see it')).toHaveValue('public');
        expect(field('About which playthrough')).toHaveValue('6');
        expect(screen.getByRole('button', { name: 'Update review' })).toBeInTheDocument();
    });

    it('reads a visibility it does not know as private, the safer of the two', () => {
        // The column could carry a third value one day; it must not read as published.
        renderForm(review({ visibility: 'friends' as ReviewDto['visibility'] }));

        expect(field('Who can see it')).toHaveValue('private');
    });

    it('fills in a review that arrives after it, and empties once that review is gone', () => {
        const { reviewIs } = renderForm();

        reviewIs(review({ id: 3, body: 'Came back to it.', visibility: 'public' }));
        expect(field('What you thought')).toHaveValue('Came back to it.');
        expect(field('Who can see it')).toHaveValue('public');

        reviewIs(null);
        expect(field('What you thought')).toHaveValue('');
        expect(field('Who can see it')).toHaveValue('private');
        expect(screen.getByRole('button', { name: 'Save review' })).toBeInTheDocument();
    });

    it('offers to delete a review only once there is one', () => {
        const { reviewIs } = renderForm();
        expect(screen.queryByRole('button', { name: 'Delete review' })).not.toBeInTheDocument();

        reviewIs(review({ id: 3 }));

        expect(screen.getByRole('button', { name: 'Delete review' })).toBeInTheDocument();
    });

    it('holds every field while it saves, and says beside itself what the API refused', () => {
        renderForm(review({ id: 3 }), { pending: true, error: 'That playthrough is not one of yours for this game.' });

        for (const label of ['What you thought', 'Who can see it', 'About which playthrough']) {
            expect(field(label), label).toBeDisabled();
        }
        expect(field(/contains spoilers/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Update review' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('That playthrough is not one of yours for this game.');
    });
});
