import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ReviewForm } from '@/components/ReviewForm';
import type { ReviewDto } from '@/types/playthrough';
import { quickActor } from '@/test/actor';
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

const field = (label: string | RegExp) => screen.getByLabelText(label);

describe('ReviewForm', () => {
    it('sends the review trimmed, with its spoiler flag and who can see it', async () => {
        const actor = quickActor();
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
        const actor = quickActor();
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

    it('reads a visibility it does not know as private, the safer of the two, and saves it so', async () => {
        // The column could carry a third value one day; it must not read as published. Asked of what
        // is sent, because a select whose value matches no option shows its first one anyway.
        const actor = quickActor();
        const { onSave } = renderForm(review({ visibility: 'friends' as ReviewDto['visibility'] }));

        expect(field('Who can see it')).toHaveValue('private');
        await actor.click(screen.getByRole('button', { name: 'Update review' }));

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
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

    it('tells its author when an admin has hidden it, and that an edit does not show it again', () => {
        // Above the fields, because it makes the visibility hint untrue for now (ADR 0076).
        renderForm(review({ visibility: 'public', hiddenAt: '2026-11-02T12:00:00Z' }));

        expect(screen.getByText(/an admin has hidden this review from other readers/i))
            .toHaveTextContent(/editing it does not show it again/i);
        expect(screen.getByRole('button', { name: 'Update review' })).toBeEnabled();
    });

    it('says nothing of hiding a review nobody hid', () => {
        renderForm(review({ visibility: 'public' }));

        expect(screen.queryByText(/an admin has hidden/i)).not.toBeInTheDocument();
    });

    it('offers to delete a review only once there is one', () => {
        const { reviewIs } = renderForm();
        expect(screen.queryByRole('button', { name: /^Delete review/ })).not.toBeInTheDocument();

        reviewIs(review({ id: 3 }));

        expect(screen.getByRole('button', { name: 'Delete review…' })).toBeInTheDocument();
    });

    it('asks before it deletes, since nothing brings a review back', async () => {
        // issue 245: the press used to delete at once.
        const actor = quickActor();
        const { onDelete } = renderForm(review({ id: 3 }));

        await actor.click(screen.getByRole('button', { name: 'Delete review…' }));

        expect(onDelete).not.toHaveBeenCalled();
        const asking = screen.getByRole('group', { name: 'Delete your review?' });
        expect(asking).toHaveTextContent('It cannot be brought back.');
        expect(within(asking).getByRole('button', { name: 'Delete review' })).toHaveClass('danger');
        expect(within(asking).getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
        // Saving is not on offer while it asks.
        expect(screen.queryByRole('button', { name: 'Update review' })).not.toBeInTheDocument();
    });

    it('deletes once that is confirmed, and asks no more', async () => {
        const actor = quickActor();
        const { onDelete } = renderForm(review({ id: 3 }));

        await actor.click(screen.getByRole('button', { name: 'Delete review…' }));
        await actor.click(screen.getByRole('button', { name: 'Delete review' }));

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('group', { name: 'Delete your review?' })).not.toBeInTheDocument();
    });

    it('backs out on Keep it, deleting nothing and leaving the review as it was', async () => {
        const actor = quickActor();
        const { onDelete } = renderForm(review({ id: 3, body: 'Second time round.' }));

        await actor.click(screen.getByRole('button', { name: 'Delete review…' }));
        await actor.click(screen.getByRole('button', { name: 'Keep it' }));

        expect(onDelete).not.toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Delete your review?' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Update review' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete review…' })).toBeInTheDocument();
        expect(field('What you thought')).toHaveValue('Second time round.');
    });

    it('holds every field while it saves, and shows next to them what the API refused', () => {
        renderForm(review({ id: 3 }), { pending: true, error: 'That playthrough is not one of yours for this game.' });

        for (const label of ['What you thought', 'Who can see it', 'About which playthrough']) {
            expect(field(label), label).toBeDisabled();
        }
        expect(field(/contains spoilers/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Update review' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete review…' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('That playthrough is not one of yours for this game.');
    });
});
