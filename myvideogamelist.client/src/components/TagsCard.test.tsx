import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagsCard } from '@/components/TagsCard';
import { TagsContext, type TagsContextValue, type TagWriteResult, type TagsStatus } from '@/contexts/TagsContext';
import { sortTags, type TagDto } from '@/types/tag';
import { tag } from '@/test/factories';

const COOP = tag({ id: 1, name: 'Co-op', count: 3 });
const SOMEDAY = tag({ id: 2, name: 'someday', count: 0 });

interface Options {
    status?: TagsStatus;
    tags?: TagDto[];
    /** What a rename answers; by default it succeeds with the name it was sent. */
    rename?: (id: number, name: string) => TagWriteResult;
    deleted?: boolean;
}

/**
 * The tags context with state of its own, so a rename or a delete shows on the card as it would with
 * the real provider, and the calls can be asserted.
 */
function renderCard(options: Options = {}) {
    const renameTag = vi.fn(async (id: number, name: string): Promise<TagWriteResult> =>
        options.rename?.(id, name) ?? { ok: true, tag: tag({ id, name, count: 3 }) });
    const deleteTag = vi.fn(async (_id: number) => options.deleted ?? true);
    const reload = vi.fn();

    function Harness() {
        const [tags, setTags] = useState(options.tags ?? [COOP, SOMEDAY]);
        const byId = new Map(tags.map(t => [t.id, t]));
        const value: TagsContextValue = {
            tags,
            status: options.status ?? 'ready',
            reload,
            tagFor: id => byId.get(id),
            byId,
            createTag: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
            renameTag: async (id, name) => {
                const result = await renameTag(id, name);
                if (result.ok) setTags(current => sortTags([...current.filter(t => t.id !== id), result.tag]));
                // A tag found gone is dropped by the real provider, so its row goes with it.
                else if (result.gone) setTags(current => current.filter(t => t.id !== id));
                return result;
            },
            deleteTag: async id => {
                const ok = await deleteTag(id);
                if (ok) setTags(current => current.filter(t => t.id !== id));
                return ok;
            },
            adjustCounts: vi.fn(),
        };
        return <TagsContext.Provider value={value}><TagsCard /></TagsContext.Provider>;
    }

    render(<Harness />);
    return { renameTag, deleteTag, reload };
}

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

describe('TagsCard states', () => {
    it('says it is loading', () => {
        renderCard({ status: 'loading', tags: [] });
        expect(screen.getByText('Loading your tags…')).toBeInTheDocument();
    });

    it('says the tags did not arrive, and offers to ask again', async () => {
        const { reload } = renderCard({ status: 'failed', tags: [] });

        expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
        await press('Try again');
        expect(reload).toHaveBeenCalled();
    });

    it('says when there are none', () => {
        renderCard({ tags: [] });
        expect(screen.getByText('You have not tagged any games yet.')).toBeInTheDocument();
    });

    it('lists every tag with how many games carry it, and says nobody else sees them', () => {
        renderCard();

        const rows = within(screen.getByRole('list', { name: 'Your tags' })).getAllByRole('listitem');
        expect(rows.map(row => row.textContent)).toEqual([
            'Co-op3 gamesRenameDelete',
            'someday0 gamesRenameDelete',
        ]);
        expect(screen.getByText(/nobody else sees them, and your public profile never shows them/i))
            .toBeInTheDocument();
    });
});

describe('TagsCard renaming', () => {
    it('opens a box holding the name, with the focus in it', async () => {
        renderCard();

        await press('Rename Co-op');

        const box = screen.getByRole('textbox', { name: 'New name for Co-op' });
        expect(box).toHaveValue('Co-op');
        expect(box).toHaveFocus();
    });

    it('saves the name tidied, says so, and puts the focus back on the row', async () => {
        const { renameTag } = renderCard();
        await press('Rename Co-op');

        const box = screen.getByRole('textbox', { name: 'New name for Co-op' });
        await userEvent.clear(box);
        await userEvent.type(box, '  Couch   co-op {Enter}');

        expect(renameTag).toHaveBeenCalledWith(1, 'Couch co-op');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Couch co-op' })).toHaveFocus());
        expect(screen.getByRole('status')).toHaveTextContent('Renamed Co-op to Couch co-op.');
    });

    it('keeps what was typed and shows the refusal beside the box', async () => {
        renderCard({ rename: () => ({ ok: false, error: 'You already have a tag called "someday".' }) });
        await press('Rename Co-op');

        const box = screen.getByRole('textbox', { name: 'New name for Co-op' });
        await userEvent.clear(box);
        await userEvent.type(box, 'SOMEDAY{Enter}');

        expect(await screen.findByRole('alert')).toHaveTextContent('You already have a tag called "someday".');
        expect(box).toHaveValue('SOMEDAY');
        expect(box).toHaveAttribute('aria-invalid', 'true');
        expect(box).toHaveAccessibleDescription('You already have a tag called "someday".');
    });

    it('sends nothing for a name that has not changed, or for none at all', async () => {
        const { renameTag } = renderCard();
        await press('Rename Co-op');

        const box = screen.getByRole('textbox', { name: 'New name for Co-op' });
        await userEvent.clear(box);
        await userEvent.type(box, '   {Enter}');
        expect(screen.getByRole('alert')).toHaveTextContent('A tag needs a name.');

        await userEvent.clear(box);
        await userEvent.type(box, 'Co-op{Enter}');

        expect(renameTag).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('keeps the focus in the box when the rename is refused, so the name can be fixed there', async () => {
        renderCard({ rename: () => ({ ok: false, error: 'You already have a tag called "someday".' }) });
        await press('Rename Co-op');

        const box = screen.getByRole('textbox', { name: 'New name for Co-op' });
        await userEvent.clear(box);
        await userEvent.type(box, 'someday{Enter}');

        await screen.findByRole('alert');
        expect(box).toHaveFocus();
    });

    it('says above the list that a tag was deleted elsewhere, and moves the focus to the heading', async () => {
        // Its row, and the box the focus was in, are gone with it.
        renderCard({ rename: () => ({ ok: false, error: 'That tag no longer exists.', gone: true }) });
        await press('Rename Co-op');

        const box = screen.getByRole('textbox', { name: 'New name for Co-op' });
        await userEvent.clear(box);
        await userEvent.type(box, 'Coop{Enter}');

        expect(await screen.findByRole('alert')).toHaveTextContent('Co-op was deleted somewhere else');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your tags' })).toHaveFocus();
    });

    it('backs out on Escape, with the focus back on the button that opened it', async () => {
        const { renameTag } = renderCard();
        await press('Rename Co-op');

        await userEvent.keyboard('{Escape}');

        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rename Co-op' })).toHaveFocus();
        expect(renameTag).not.toHaveBeenCalled();
    });
});

describe('TagsCard deleting', () => {
    it('asks first, saying how many games the tag comes off, with the focus on Cancel', async () => {
        renderCard();

        await press('Delete Co-op');

        const confirm = screen.getByRole('group', { name: 'Delete Co-op?' });
        expect(confirm).toHaveTextContent('It comes off 3 games; the games stay as they are.');
        const cancel = within(confirm).getByRole('button', { name: 'Cancel' });
        expect(cancel).toHaveFocus();
        // So the focus landing there reads the number of games, not only the name.
        expect(cancel).toHaveAccessibleDescription(/It comes off 3 games/);
    });

    it('backs out on Escape, with the focus back on the button that asked', async () => {
        const { deleteTag } = renderCard();
        await press('Delete Co-op');

        await userEvent.keyboard('{Escape}');

        expect(screen.queryByRole('group', { name: 'Delete Co-op?' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Co-op' })).toHaveFocus();
        expect(deleteTag).not.toHaveBeenCalled();
    });

    it('deletes once confirmed, and moves the focus to the heading rather than the page', async () => {
        const { deleteTag } = renderCard();
        await press('Delete someday');

        await userEvent.click(within(screen.getByRole('group', { name: 'Delete someday?' }))
            .getByRole('button', { name: 'Delete' }));

        expect(deleteTag).toHaveBeenCalledWith(2);
        await waitFor(() => expect(screen.queryByText('someday')).not.toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Your tags' })).toHaveFocus();
        expect(screen.getByRole('status')).toHaveTextContent('Deleted someday.');
    });

    it('keeps the tag and the question when the delete fails', async () => {
        renderCard({ deleted: false });
        await press('Delete Co-op');

        await userEvent.click(within(screen.getByRole('group', { name: 'Delete Co-op?' }))
            .getByRole('button', { name: 'Delete' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete that tag.');
        const confirm = screen.getByRole('group', { name: 'Delete Co-op?' });
        // Still on the button that was pressed, which was held rather than disabled while it was out.
        expect(within(confirm).getByRole('button', { name: 'Delete' })).toHaveFocus();
    });
});
