import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PlaythroughList } from '@/components/PlaythroughList';
import type { PlaythroughDto } from '@/types/playthrough';
import { quickActor } from '@/test/actor';
import { platform, playthrough } from '@/test/factories';

/**
 * The runs on their own: what each row says, and that a run's Delete asks before it deletes, because a
 * run is a record of something that happened and nothing undoes its loss (issue 245). The panel's suite
 * logs and edits runs through the form beside it.
 */

const PLATFORMS = [platform(6, 'PC (Microsoft Windows)'), platform(48, 'PlayStation 4')];

const RUNS = [
    playthrough({ id: 5, type: 'completionist', platformId: 48, minutesPlayed: 135 }),
    playthrough({ id: 6, type: null, platformId: null }),
];

function renderList(state: { playthroughs?: PlaythroughDto[]; busyId?: number | null; disabled?: boolean } = {}) {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
        <PlaythroughList
            playthroughs={state.playthroughs ?? RUNS}
            platforms={PLATFORMS}
            onEdit={onEdit}
            onDelete={onDelete}
            busyId={state.busyId ?? null}
            disabled={state.disabled ?? false}
        />,
    );
    return { onEdit, onDelete };
}

describe('PlaythroughList', () => {
    it('says what a playthrough is for while there are none, rather than showing nothing', () => {
        renderList({ playthroughs: [] });

        expect(screen.getByText(/^Nothing logged yet\. A playthrough records how long a game took you and on what/))
            .toHaveTextContent('and a replay is a second one rather than an overwrite.');
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('lists each run with what it records, and its platform by name', () => {
        renderList();

        const [first, second] = screen.getAllByRole('listitem');
        expect(first).toHaveTextContent('PlayStation 4');
        expect(second).toHaveTextContent('No platform recorded');
    });

    it('hands the run to edit to whoever opens the form', async () => {
        const actor = quickActor();
        const { onEdit } = renderList();

        await actor.click(screen.getByRole('button', { name: 'Edit playthrough 2' }));

        expect(onEdit).toHaveBeenCalledWith(RUNS[1]);
    });

    it('asks before it deletes a run, naming the run by its place', async () => {
        const actor = quickActor();
        const { onDelete } = renderList();

        await actor.click(screen.getByRole('button', { name: 'Delete playthrough 2…' }));

        expect(onDelete).not.toHaveBeenCalled();
        const asking = screen.getByRole('group', { name: 'Delete playthrough 2?' });
        expect(within(asking).getByRole('button', { name: 'Delete playthrough 2' })).toHaveClass('danger');
        expect(within(asking).getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
        // The other run is untouched, and asks nothing.
        expect(screen.getByRole('button', { name: 'Delete playthrough 1…' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit playthrough 2' })).not.toBeInTheDocument();
    });

    it('deletes the run once that is confirmed', async () => {
        const actor = quickActor();
        const { onDelete } = renderList();

        await actor.click(screen.getByRole('button', { name: 'Delete playthrough 1…' }));
        await actor.click(screen.getByRole('button', { name: 'Delete playthrough 1' }));

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledWith(RUNS[0]);
        expect(screen.queryByRole('group', { name: 'Delete playthrough 1?' })).not.toBeInTheDocument();
    });

    it('backs out on Keep it, deleting nothing', async () => {
        const actor = quickActor();
        const { onDelete } = renderList();

        await actor.click(screen.getByRole('button', { name: 'Delete playthrough 1…' }));
        await actor.click(screen.getByRole('button', { name: 'Keep it' }));

        expect(onDelete).not.toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Delete playthrough 1?' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit playthrough 1' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Delete playthrough 1…' })).toBeEnabled();
    });

    it('quiets only the run being deleted, and says so on it', () => {
        renderList({ busyId: 5 });

        expect(screen.getByRole('button', { name: 'Deleting playthrough 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Edit playthrough 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete playthrough 2…' })).toBeEnabled();
    });
});
