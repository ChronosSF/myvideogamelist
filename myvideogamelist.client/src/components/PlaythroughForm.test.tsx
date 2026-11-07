import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlaythroughForm } from '@/components/PlaythroughForm';
import type { PlaythroughDto } from '@/types/playthrough';
import { quickActor } from '@/test/actor';
import { platform, playthrough } from '@/test/factories';

/**
 * The form on its own: what each field becomes in the request. The panel's suite logs, edits and
 * deletes runs through it; this is about the conversions between the boxes a person fills in and
 * the shape the API takes, where a blank must be a null and never a zero: the API takes a run's
 * minutes from one up (ADR 0025 §5).
 */

const PLATFORMS = [platform(6, 'PC (Microsoft Windows)'), platform(48, 'PlayStation 4')];

/**
 * The form as the page mounts it: for logging a new run, or already editing one, as a row's Edit opens
 * it (issue 222). `edit` is the page handing a form already on screen another run to edit, or none.
 */
function renderForm(state: { pending?: boolean; error?: string | null; editing?: PlaythroughDto | null } = {}) {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const props = { platforms: PLATFORMS, onSubmit, onCancel, pending: state.pending ?? false, error: state.error ?? null };
    const { rerender } = render(<PlaythroughForm {...props} editing={state.editing ?? null} />);
    return {
        onSubmit,
        onCancel,
        edit: (next: PlaythroughDto | null) => rerender(<PlaythroughForm {...props} editing={next} />),
    };
}

const field = (label: string) => screen.getByLabelText(label);

describe('PlaythroughForm', () => {
    it('sends every field the API takes, the time as one number of minutes and the notes trimmed', async () => {
        const actor = quickActor();
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

    it('sends no time at all, rather than zero minutes, when both boxes say nought', async () => {
        // The API's range starts at one minute: a zero is a valid-looking value it refuses.
        const actor = quickActor();
        const { onSubmit } = renderForm();

        await actor.type(field('Hours'), '0');
        await actor.type(field('Minutes'), '0');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ minutesPlayed: null }));
    });

    it('sends notes of nothing but spaces as no notes', async () => {
        const actor = quickActor();
        const { onSubmit } = renderForm();

        await actor.type(field('Notes'), '   ');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ notes: null }));
    });

    it('counts hours alone, and minutes alone', async () => {
        const actor = quickActor();
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
        const actor = quickActor();
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
    });

    it('fills in the run it opens already editing, rather than blank fields that would save over it', async () => {
        // A row's Edit opens the form with the run in hand (issue 222): seeded only on a change of run,
        // it showed blank fields, and saving sent them over the run.
        const actor = quickActor();
        const { onSubmit } = renderForm({
            editing: playthrough({
                id: 5,
                type: 'completionist',
                platformId: 48,
                minutesPlayed: 135,
                startedOn: '2026-03-01',
                finishedOn: '2026-03-20',
                notes: 'All the B-sides.',
            }),
        });

        expect(field('Platform')).toHaveValue('48');
        expect(field('How you played it')).toHaveValue('completionist');
        expect(field('Hours')).toHaveValue(2);
        expect(field('Minutes')).toHaveValue(15);
        expect(field('Started')).toHaveValue('2026-03-01');
        expect(field('Finished')).toHaveValue('2026-03-20');
        expect(field('Notes')).toHaveValue('All the B-sides.');

        await actor.click(screen.getByRole('button', { name: 'Save playthrough' }));

        expect(onSubmit).toHaveBeenCalledWith({
            type: 'completionist',
            platformId: 48,
            minutesPlayed: 135,
            startedOn: '2026-03-01',
            finishedOn: '2026-03-20',
            notes: 'All the B-sides.',
        });
    });

    it('keeps a platform the game no longer lists, and says it is unlisted rather than not recorded', async () => {
        // The select would otherwise show "Not recorded" while the draft still sent the old id.
        const actor = quickActor();
        const { onSubmit } = renderForm({ editing: playthrough({ id: 5, platformId: 130 }) });

        const select = field('Platform');
        expect(select).toHaveValue('130');
        expect(screen.getByRole('option', { name: 'Unlisted platform', selected: true })).toHaveValue('130');

        await actor.click(screen.getByRole('button', { name: 'Save playthrough' }));
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ platformId: 130 }));

        // Once another is chosen there is nothing unlisted to offer any more.
        await actor.selectOptions(select, 'PC (Microsoft Windows)');
        expect(screen.queryByRole('option', { name: 'Unlisted platform' })).not.toBeInTheDocument();
    });

    it('offers no unlisted platform for a run on one the game lists, or on none', () => {
        const { edit } = renderForm({ editing: playthrough({ id: 5, platformId: 6 }) });
        expect(screen.queryByRole('option', { name: 'Unlisted platform' })).not.toBeInTheDocument();

        edit(playthrough({ id: 6, platformId: null }));
        expect(field('Platform')).toHaveValue('');
        expect(screen.queryByRole('option', { name: 'Unlisted platform' })).not.toBeInTheDocument();
    });

    it('offers to close the form whether it logs a new run or edits one', async () => {
        // The page opens the form only to log or edit a run, so either way it needs a way back out.
        const actor = quickActor();
        const { onCancel, edit } = renderForm();

        await actor.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);

        edit(playthrough({ id: 5 }));
        await actor.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(2);
    });

    it('holds every field while it saves, and shows next to them what the API refused', () => {
        renderForm({ pending: true, error: 'The finish date cannot be before the start date.' });

        for (const label of ['Platform', 'How you played it', 'Hours', 'Minutes', 'Started', 'Finished', 'Notes']) {
            expect(field(label), label).toBeDisabled();
        }
        expect(screen.getByRole('button', { name: 'Log playthrough' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('The finish date cannot be before the start date.');
    });
});
