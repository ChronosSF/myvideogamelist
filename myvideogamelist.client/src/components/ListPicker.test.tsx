import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ListPicker } from '@/components/ListPicker';
import { LIST_NAMES, type ListId } from '@/types/list';
import { quickActor } from '@/test/actor';

/**
 * The game page's list control (ADR 0084) on its own: a game in no list is offered the Backlog in one
 * press and the other four beside it; a game in one shows that list, with every other and a way out.
 */

const defaults = (listId: ListId) => LIST_NAMES[listId];

/** A reader who has renamed two of the lists (ADR 0031). */
const renamed = (listId: ListId) =>
    listId === 'backlog' ? 'Up Next' : listId === 'on_hold' ? 'Paused' : LIST_NAMES[listId];

function renderPicker(props: {
    current?: ListId | null;
    nameFor?: (listId: ListId) => string;
    disabled?: boolean;
    onSignIn?: () => void;
} = {}) {
    const onMove = vi.fn();
    const onTakeOut = vi.fn();
    render(
        <ListPicker
            current={props.current ?? null}
            nameFor={props.nameFor ?? defaults}
            disabled={props.disabled ?? false}
            onMove={onMove}
            onTakeOut={onTakeOut}
            onSignIn={props.onSignIn}
        />,
    );
    return { onMove, onTakeOut };
}

/** The Backlog button, by its accessible name: "Add to" and the list's name, which is what it shows. */
const addTo = (list: string) => screen.getByRole('button', { name: `Add to ${list}` });

const optionNames = (select: HTMLElement) =>
    within(select).getAllByRole('option', { hidden: true }).map(option => option.textContent);

describe('ListPicker, for a game in no list', () => {
    it('puts it in the Backlog in one press', async () => {
        const actor = quickActor();
        const { onMove } = renderPicker();

        await actor.click(addTo('Backlog'));

        expect(onMove).toHaveBeenCalledWith('backlog');
    });

    it('offers the other four lists beside it, and moves to the one chosen', async () => {
        const actor = quickActor();
        const { onMove } = renderPicker();

        const others = screen.getByRole('combobox', { name: 'Add to another list' });
        // The placeholder first, hidden from the list a reader picks from, then every list but the Backlog.
        expect(optionNames(others)).toEqual(['Add to another list', 'Playing', 'On Hold', 'Finished', 'Dropped']);

        await actor.selectOptions(others, 'Finished');

        expect(onMove).toHaveBeenCalledWith('finished');
    });

    it('calls every list what the reader calls it', () => {
        renderPicker({ nameFor: renamed });

        const add = addTo('Up Next');
        // "Add to" is in the button's name, for a screen reader and a voice control; what shows is the
        // list's name, which the name contains.
        expect(add).toHaveAccessibleName('Add to Up Next');
        expect(add).toHaveTextContent(/^Up Next$/);
        expect(optionNames(screen.getByRole('combobox', { name: 'Add to another list' })))
            .toEqual(['Add to another list', 'Playing', 'Paused', 'Finished', 'Dropped']);
    });

    it('offers nothing while it is disabled', () => {
        renderPicker({ disabled: true });

        expect(addTo('Backlog')).toBeDisabled();
        expect(screen.getByRole('combobox', { name: 'Add to another list' })).toBeDisabled();
    });

    it('asks a reader who is signed out to sign in, from the Backlog, while the other lists wait', async () => {
        const actor = quickActor();
        const onSignIn = vi.fn();
        const { onMove } = renderPicker({ disabled: true, onSignIn });

        const add = addTo('Backlog');
        expect(add).toBeEnabled();
        expect(screen.getByRole('combobox', { name: 'Add to another list' })).toBeDisabled();

        await actor.click(add);

        expect(onSignIn).toHaveBeenCalledTimes(1);
        expect(onMove).not.toHaveBeenCalled();
    });
});

describe('ListPicker, for a game in a list', () => {
    it('shows the list it is in', () => {
        renderPicker({ current: 'playing' });

        const select = screen.getByRole('combobox', { name: 'Your list' });
        expect(select).toHaveValue('playing');
        expect(optionNames(select)).toEqual(['Backlog', 'Playing', 'On Hold', 'Finished', 'Dropped', 'Take out of Playing']);
        expect(screen.queryByRole('button', { name: /Backlog/ })).not.toBeInTheDocument();
    });

    it('moves it to another list', async () => {
        const actor = quickActor();
        const { onMove, onTakeOut } = renderPicker({ current: 'playing' });

        await actor.selectOptions(screen.getByRole('combobox', { name: 'Your list' }), 'Finished');

        expect(onMove).toHaveBeenCalledWith('finished');
        expect(onTakeOut).not.toHaveBeenCalled();
    });

    it('takes it out of the list it is in', async () => {
        const actor = quickActor();
        const { onMove, onTakeOut } = renderPicker({ current: 'playing' });

        const select = screen.getByRole('combobox', { name: 'Your list' });
        expect(screen.getByRole('option', { name: 'Take out of Playing' })).toHaveValue('take-out');
        await actor.selectOptions(select, 'Take out of Playing');

        expect(onTakeOut).toHaveBeenCalledTimes(1);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('calls every list what the reader calls it, the way out included', () => {
        renderPicker({ current: 'backlog', nameFor: renamed });

        expect(optionNames(screen.getByRole('combobox', { name: 'Your list' })))
            .toEqual(['Up Next', 'Playing', 'Paused', 'Finished', 'Dropped', 'Take out of Up Next']);
    });

    it('offers nothing while it is disabled', () => {
        renderPicker({ current: 'dropped', disabled: true });

        expect(screen.getByRole('combobox', { name: 'Your list' })).toBeDisabled();
    });
});
