import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListNamesCard } from '@/components/ListNamesCard';
import type { ListsContextValue, SaveListNamesResult } from '@/contexts/ListsContext';
import { LIST_NAMES, type ListId, type ListNames } from '@/types/list';

/**
 * The lists context, mocked: the card reads the names, their status and the save, and nothing else.
 * One module-level object, handed back on every call, for the reason the other page tests give.
 */
const lists = {
    names: {} as ListNames,
    namesStatus: 'ready' as ListsContextValue['namesStatus'],
    nameFor: (id: ListId) => LIST_NAMES[id],
    saveListNames: vi.fn(async (): Promise<SaveListNamesResult> => ({ ok: true })),
};

vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));

const box = (listName: string) => screen.getByLabelText(listName);
const save = () => screen.getByRole('button', { name: /save names|saved|saving/i });

beforeEach(() => {
    lists.names = {};
    lists.namesStatus = 'ready';
    lists.saveListNames.mockReset();
    lists.saveListNames.mockResolvedValue({ ok: true });
});

describe('ListNamesCard', () => {
    it('labels each box with the default name and fills in the renamed ones', () => {
        lists.names = { finished: 'Beaten' };
        render(<ListNamesCard />);

        expect(box('Finished')).toHaveValue('Beaten');
        expect(box('Backlog')).toHaveValue('');
        expect(box('Backlog')).toHaveAttribute('placeholder', 'Backlog');
    });

    it('has nothing to save until something changes', () => {
        render(<ListNamesCard />);

        expect(save()).toBeDisabled();
    });

    it('saves only the renamed lists, trimmed and with their spaces folded', async () => {
        const actor = userEvent.setup();
        render(<ListNamesCard />);

        await actor.type(box('Backlog'), '  Pile   of Shame ');
        await actor.click(save());

        expect(lists.saveListNames).toHaveBeenCalledWith({ backlog: 'Pile of Shame' });
    });

    it('treats typing the default name back in as no rename', async () => {
        const actor = userEvent.setup();
        lists.names = { finished: 'Beaten' };
        render(<ListNamesCard />);

        await actor.clear(box('Finished'));
        await actor.type(box('Finished'), 'Finished');
        await actor.click(save());

        expect(lists.saveListNames).toHaveBeenCalledWith({});
    });

    it('puts the refusal beside the list it is about and keeps what was typed', async () => {
        const actor = userEvent.setup();
        lists.saveListNames.mockResolvedValue({
            ok: false,
            fieldErrors: { dropped: 'Another of your lists is already called "Playing".' },
            error: null,
        });
        render(<ListNamesCard />);

        await actor.type(box('Dropped'), 'Playing');
        await actor.click(save());

        expect(await screen.findByText('Another of your lists is already called "Playing".')).toBeInTheDocument();
        expect(box('Dropped')).toHaveValue('Playing');
        expect(box('Dropped')).toHaveAttribute('aria-invalid', 'true');
        expect(box('Dropped')).toHaveAccessibleDescription('Another of your lists is already called "Playing".');
    });

    it('announces a failure that is about no one list', async () => {
        const actor = userEvent.setup();
        lists.saveListNames.mockResolvedValue({
            ok: false,
            fieldErrors: {},
            error: 'Failed to save your list names. Please try again.',
        });
        render(<ListNamesCard />);

        await actor.type(box('Playing'), 'Now');
        await actor.click(save());

        expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save your list names/i);
        expect(box('Playing')).toHaveValue('Now');
    });

    it('offers nothing to edit while the names are loading', () => {
        lists.namesStatus = 'loading';
        render(<ListNamesCard />);

        expect(screen.getByText(/loading your list names/i)).toBeInTheDocument();
        expect(screen.queryByLabelText('Finished')).not.toBeInTheDocument();
    });

    it('offers nothing to edit when the names failed to load', () => {
        // The empty set a failed read leaves looks exactly like "nothing renamed", and saving from it
        // would put every list back to its default over what the user had chosen.
        lists.namesStatus = 'failed';
        render(<ListNamesCard />);

        expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
        expect(screen.queryByRole('button', { name: /save names/i })).not.toBeInTheDocument();
    });

    it('keeps a half-typed name when the same names arrive again', async () => {
        // The provider refetches whenever the account object changes — toggling the theme on this
        // page does it — and a fresh copy of unchanged names must not wipe the form.
        const actor = userEvent.setup();
        lists.names = { finished: 'Beaten' };
        const view = render(<ListNamesCard />);

        await actor.type(box('Playing'), 'Right n');
        lists.names = { finished: 'Beaten' };
        view.rerender(<ListNamesCard />);

        expect(box('Playing')).toHaveValue('Right n');
    });

    it('follows the names when they really change', async () => {
        lists.names = {};
        const view = render(<ListNamesCard />);

        lists.names = { backlog: 'Someday' };
        view.rerender(<ListNamesCard />);

        await waitFor(() => expect(box('Backlog')).toHaveValue('Someday'));
    });
});
