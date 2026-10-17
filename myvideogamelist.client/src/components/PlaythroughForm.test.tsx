import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaythroughForm } from '@/components/PlaythroughForm';
import type { PlaythroughDto } from '@/types/playthrough';
import { platform, playthrough } from '@/test/factories';

/**
 * The form on its own: what each field becomes in the request. The panel's suite logs, edits and
 * deletes runs through it; this is about the conversions between the boxes a person fills in and
 * the shape the API takes, where a blank must be a null and never a zero (ADR 0021, ADR 0025).
 */

const PLATFORMS = [platform(6, 'PC (Microsoft Windows)'), platform(48, 'PlayStation 4')];

/**
 * The form as the panel mounts it, for logging a new run, and `edit` for the panel handing it one to
 * edit — which it only ever does once the form is on screen, from a row's Edit button.
 */
function renderForm(state: { pending?: boolean; error?: string | null } = {}) {
    const onSubmit = vi.fn();
    const onCancelEdit = vi.fn();
    const props = { platforms: PLATFORMS, onSubmit, onCancelEdit, pending: state.pending ?? false, error: state.error ?? null };
    const { rerender } = render(<PlaythroughForm {...props} editing={null} />);
    return {
        onSubmit,
        onCancelEdit,
        edit: (next: PlaythroughDto | null) => rerender(<PlaythroughForm {...props} editing={next} />),
    };
}

/** Skips user-event's pause between keystrokes, which costs a timer per character. */
const setupActor = () => userEvent.setup({ delay: null });

const field = (label: string) => screen.getByLabelText(label);

describe('PlaythroughForm', () => {
    it('sends every field the API takes, the time as one number of minutes and the notes trimmed', async () => {
        const actor = setupActor();
        const { onSubmit } = renderForm();

        await actor.selectOptions(field('Platform'), 'PlayStation 4');
        await actor.selectOptions(field('How you played it'), 'Normally');
        await actor.type(field('Hours'), '12');
        await actor.type(field('Minutes'), '5');
        await actor.type(field('Started'), '2026-01-03');
        await actor.type(field('Finished'), '2026-02-14');
        await actor.type(field('Notes'), '  Every strawberry.  ');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(onSubmit).toHaveBeenCalledWith({
            type: 'normally',
            platformId: 48,
            minutesPlayed: 12 * 60 + 5,
            startedOn: '2026-01-03',
            finishedOn: '2026-02-14',
            notes: 'Every strawberry.',
        });
    });

    it('sends no time at all, rather than zero minutes, when neither box says how long', async () => {
        // The API's range starts at one minute: a zero is a valid-looking value it refuses.
        const actor = setupActor();
        const { onSubmit } = renderForm();

        await actor.type(field('Hours'), '0');
        await actor.type(field('Minutes'), '0');
        await actor.type(field('Notes'), '   ');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ minutesPlayed: null, notes: null }));
    });

    it('counts hours alone, and minutes alone', async () => {
        const actor = setupActor();
        const { onSubmit } = renderForm();

        await actor.type(field('Hours'), '3');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));
        await actor.clear(field('Hours'));
        await actor.type(field('Minutes'), '45');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(onSubmit.mock.calls.map(([input]) => input.minutesPlayed)).toEqual([180, 45]);
    });

    it('loads the run being edited, its time split back into hours and minutes', () => {
        const { edit } = renderForm();

        edit(playthrough({
            id: 5,
            type: 'completionist',
            platformId: 6,
            minutesPlayed: 135,
            startedOn: '2026-03-01',
            finishedOn: '2026-03-20',
            notes: 'All the B-sides.',
        }));

        expect(field('Platform')).toHaveValue('6');
        expect(field('How you played it')).toHaveValue('completionist');
        expect(field('Hours')).toHaveValue(2);
        expect(field('Minutes')).toHaveValue(15);
        expect(field('Started')).toHaveValue('2026-03-01');
        expect(field('Finished')).toHaveValue('2026-03-20');
        expect(field('Notes')).toHaveValue('All the B-sides.');
        expect(screen.getByRole('button', { name: 'Save playthrough' })).toBeInTheDocument();
    });

    it('leaves blank what the run being edited never had, and sends it back as nothing', async () => {
        // A run still in progress has no type, no time and no finish. Shown as "0", a blank would be
        // saved back as a value nobody gave it.
        const actor = setupActor();
        const { onSubmit, edit } = renderForm();

        edit(playthrough({ id: 5, type: null, platformId: null, minutesPlayed: null, startedOn: '2026-03-01' }));

        expect(field('Started')).toHaveValue('2026-03-01');
        expect(field('Hours')).toHaveValue(null);
        expect(field('How you played it')).toHaveValue('');
        await actor.click(screen.getByRole('button', { name: 'Save playthrough' }));

        expect(onSubmit).toHaveBeenCalledWith({
            type: null,
            platformId: null,
            minutesPlayed: null,
            startedOn: '2026-03-01',
            finishedOn: null,
            notes: null,
        });
    });

    it('empties again once the edit is over, ready for a new run', () => {
        const { edit } = renderForm();
        edit(playthrough({ id: 5, minutesPlayed: 60, notes: 'First go.' }));
        expect(field('Notes')).toHaveValue('First go.');

        edit(null);

        expect(field('Notes')).toHaveValue('');
        expect(field('Hours')).toHaveValue(null);
        expect(screen.getByRole('button', { name: 'Log playthrough' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('offers to back out of an edit, and only of an edit', async () => {
        const actor = setupActor();
        const { onCancelEdit, edit } = renderForm();
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

        edit(playthrough({ id: 5 }));
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancelEdit).toHaveBeenCalledTimes(1);
    });

    it('holds every field while it saves, and says beside itself what the API refused', () => {
        renderForm({ pending: true, error: 'The finish date cannot be before the start date.' });

        for (const label of ['Platform', 'How you played it', 'Hours', 'Minutes', 'Started', 'Finished', 'Notes']) {
            expect(field(label), label).toBeDisabled();
        }
        expect(screen.getByRole('button', { name: 'Log playthrough' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('The finish date cannot be before the start date.');
    });
});
