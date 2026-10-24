import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntryTagEditor } from '@/components/EntryTagEditor';
import { MAX_TAGS_PER_GAME, type TagDto } from '@/types/tag';
import { tag } from '@/test/factories';

const COOP = tag({ id: 1, name: 'Co-op', count: 5 });
const COUCH = tag({ id: 2, name: 'Couch co-op', count: 2 });
const SHORT = tag({ id: 3, name: 'short', count: 9 });
const VOCABULARY = [COOP, COUCH, SHORT];

function renderEditor(overrides: Partial<Parameters<typeof EntryTagEditor>[0]> = {}) {
    const handlers = { onAdd: vi.fn(), onCreate: vi.fn(async (_name: string) => true), onRemove: vi.fn() };
    const view = render(
        <EntryTagEditor
            tags={[]}
            vocabulary={VOCABULARY}
            busy={false}
            disabled={false}
            error={null}
            gameTitle="Celeste"
            {...handlers}
            {...overrides}
        />,
    );
    return { ...handlers, view };
}

const box = () => screen.getByRole('combobox', { name: 'Add a tag to Celeste' });
const options = () => within(screen.getByRole('listbox', { hidden: true })).queryAllByRole('option');
const status = () => screen.getByRole('status');

/** The suggestions, by the names a screen reader reads, in the order they are offered. */
function expectOptions(names: string[]) {
    const offered = options();
    expect(offered).toHaveLength(names.length);
    offered.forEach((option, index) => expect(option).toHaveAccessibleName(names[index]));
}

describe('EntryTagEditor showing the tags', () => {
    it('lists the game’s tags under the section’s name, each with a named remove button', () => {
        renderEditor({ tags: [COOP, SHORT] });

        const list = screen.getByRole('list', { name: 'Tags' });
        expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Co-op', 'short']);
        expect(screen.getByRole('button', { name: 'Remove the tag Co-op' })).toBeEnabled();
    });

    it('says so when the game carries none', () => {
        renderEditor();

        expect(screen.getByText('No tags on this game yet.')).toBeInTheDocument();
    });
});

describe('EntryTagEditor suggesting', () => {
    it('offers nothing until something is typed, and keeps the list collapsed', () => {
        renderEditor();

        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(options()).toHaveLength(0);
    });

    it('offers the account’s tags that match, starting with the typed text first, then the most used', async () => {
        renderEditor();

        await userEvent.type(box(), 'co');

        expect(box()).toHaveAttribute('aria-expanded', 'true');
        expectOptions(['Co-op, 5 games', 'Couch co-op, 2 games', 'Create “co”']);
    });

    it('leaves out the tags the game already carries', async () => {
        renderEditor({ tags: [COOP] });

        await userEvent.type(box(), 'co');

        expectOptions(['Couch co-op, 2 games', 'Create “co”']);
    });

    it('offers no create for a name the account already has, in any case', async () => {
        renderEditor();

        await userEvent.type(box(), 'SHORT');

        expectOptions(['short, 9 games']);
    });

    it('opens on an empty box with ArrowDown, most used first', async () => {
        renderEditor();

        await userEvent.click(box());
        await userEvent.keyboard('{ArrowDown}');

        expectOptions(['short, 9 games', 'Co-op, 5 games', 'Couch co-op, 2 games']);
    });

    it('moves through the suggestions with the arrows, telling a screen reader which is active', async () => {
        renderEditor();

        await userEvent.type(box(), 'co');
        expect(box()).not.toHaveAttribute('aria-activedescendant');

        await userEvent.keyboard('{ArrowDown}{ArrowDown}');

        const active = options()[1];
        expect(active).toHaveAttribute('aria-selected', 'true');
        expect(box()).toHaveAttribute('aria-activedescendant', active.id);

        // Round the end and back to the top.
        await userEvent.keyboard('{ArrowDown}{ArrowDown}');
        expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('closes on Escape, and clears the box on a second one', async () => {
        renderEditor();

        await userEvent.type(box(), 'co');
        await userEvent.keyboard('{Escape}');

        expect(box()).toHaveAttribute('aria-expanded', 'false');
        expect(box()).toHaveValue('co');

        await userEvent.keyboard('{Escape}');
        expect(box()).toHaveValue('');
    });
});

describe('EntryTagEditor committing', () => {
    it('adds the account’s tag of exactly the typed name on Enter, in any case', async () => {
        const { onAdd, onCreate } = renderEditor();

        await userEvent.type(box(), 'co-OP{Enter}');

        expect(onAdd).toHaveBeenCalledWith(COOP);
        expect(onCreate).not.toHaveBeenCalled();
        expect(box()).toHaveValue('');
        expect(status()).toHaveTextContent('Added Co-op.');
    });

    it('makes a new tag of the typed name on Enter, tidied, when the account has none of it', async () => {
        // Not the suggestion it happens to start: nothing is chosen that nobody chose.
        const { onAdd, onCreate } = renderEditor();

        await userEvent.type(box(), '  co   {Enter}');

        expect(onCreate).toHaveBeenCalledWith('co');
        expect(onAdd).not.toHaveBeenCalled();
        await waitFor(() => expect(status()).toHaveTextContent('Added co.'));
        expect(box()).toHaveValue('');
    });

    it('keeps a name it could not make in the box to correct, and announces no "added"', async () => {
        // The account is full, say: the panel shows why in its alert, and the name is still there.
        const onCreate = vi.fn(async (_name: string) => false);
        renderEditor({ onCreate });

        await userEvent.type(box(), 'replay{Enter}');

        expect(onCreate).toHaveBeenCalledWith('replay');
        await waitFor(() => expect(box()).toHaveValue('replay'));
        expect(status()).not.toHaveTextContent('Added');
    });

    it('leaves alone what was typed while a new tag was being made', async () => {
        let finish!: (added: boolean) => void;
        const onCreate = vi.fn((_name: string) => new Promise<boolean>(resolve => { finish = resolve; }));
        renderEditor({ onCreate });

        await userEvent.type(box(), 'replay{Enter}');
        await userEvent.clear(box());
        await userEvent.type(box(), 'short');
        finish(true);

        await waitFor(() => expect(status()).toHaveTextContent('Added replay.'));
        expect(box()).toHaveValue('short');
    });

    it('does not commit on Enter while an input method is composing', () => {
        // Enter there confirms a candidate in Chinese, Japanese or Korean, mid-word.
        const { onAdd, onCreate } = renderEditor();
        fireEvent.change(box(), { target: { value: 'co' } });

        fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
        fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });

        expect(onAdd).not.toHaveBeenCalled();
        expect(onCreate).not.toHaveBeenCalled();
        expect(box()).toHaveValue('co');
    });

    it('keeps the highlighted suggestion in sight', async () => {
        const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
        renderEditor();

        await userEvent.type(box(), 'co');
        await userEvent.keyboard('{ArrowDown}');

        expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('adds the highlighted suggestion on Enter', async () => {
        const { onAdd } = renderEditor();

        await userEvent.type(box(), 'co');
        await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

        expect(onAdd).toHaveBeenCalledWith(COUCH);
    });

    it('adds a suggestion that is clicked, keeping the focus in the box', async () => {
        const { onAdd } = renderEditor();

        await userEvent.type(box(), 'sh');
        await userEvent.click(screen.getByRole('option', { name: 'short, 9 games' }));

        expect(onAdd).toHaveBeenCalledWith(SHORT);
        expect(box()).toHaveFocus();
    });

    it('makes the tag a "Create" option names', async () => {
        const { onCreate } = renderEditor();

        await userEvent.type(box(), 'replay');
        await userEvent.click(screen.getByRole('option', { name: 'Create “replay”' }));

        expect(onCreate).toHaveBeenCalledWith('replay');
    });

    it('says a tag is already on the game rather than adding it twice', async () => {
        const { onAdd } = renderEditor({ tags: [COOP] });

        await userEvent.type(box(), 'co-op');
        expect(screen.getByText('Co-op is already on this game.')).toBeInTheDocument();

        await userEvent.keyboard('{Enter}');

        expect(onAdd).not.toHaveBeenCalled();
        expect(status()).toHaveTextContent('Co-op is already on Celeste.');
    });

    it('removes a tag, says so, and puts the focus in the box rather than on the page', async () => {
        const { onRemove } = renderEditor({ tags: [COOP, SHORT] });

        await userEvent.click(screen.getByRole('button', { name: 'Remove the tag short' }));

        expect(onRemove).toHaveBeenCalledWith(SHORT);
        expect(status()).toHaveTextContent('Removed short.');
        expect(box()).toHaveFocus();
    });
});

describe('EntryTagEditor while a write is out', () => {
    it('commits nothing, and says why, without taking the focus away', async () => {
        const { onAdd, onCreate, onRemove } = renderEditor({ tags: [COOP], busy: true });

        await userEvent.type(box(), 'short{Enter}');
        await userEvent.click(screen.getByRole('button', { name: 'Remove the tag Co-op' }));

        expect(onAdd).not.toHaveBeenCalled();
        expect(onCreate).not.toHaveBeenCalled();
        expect(onRemove).not.toHaveBeenCalled();
        expect(status()).toHaveTextContent('Still saving your last change');
        // Not disabled, which would drop the focus mid-word; what was typed is kept to retry.
        expect(box()).toBeEnabled();
        expect(box()).toHaveValue('short');
        expect(screen.getByRole('button', { name: 'Remove the tag Co-op' })).toHaveAttribute('aria-disabled', 'true');
    });
});

describe('EntryTagEditor with nothing to edit against', () => {
    it('is disabled', () => {
        renderEditor({ tags: [COOP], disabled: true });

        expect(box()).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove the tag Co-op' })).toBeDisabled();
    });
});

describe('EntryTagEditor at the cap', () => {
    it('takes no more, and says how to make room', async () => {
        const full: TagDto[] = Array.from({ length: MAX_TAGS_PER_GAME }, (_, i) => tag({ id: 100 + i, name: `tag ${i}` }));
        renderEditor({ tags: full });

        expect(box()).toHaveAttribute('readonly');
        expect(screen.getByText(/at most 20 tags\. Remove one to add another\./i)).toBeInTheDocument();

        await userEvent.click(box());
        await userEvent.keyboard('{ArrowDown}');

        expect(box()).toHaveAttribute('aria-expanded', 'false');
    });

    it('refuses Enter once the game is full, even with text left in the box', async () => {
        // Typed while the twentieth tag was saving, and still there when it landed.
        const nineteen: TagDto[] = Array.from({ length: MAX_TAGS_PER_GAME - 1 }, (_, i) => tag({ id: 100 + i, name: `tag ${i}` }));
        const { onAdd, onCreate, view } = renderEditor({ tags: nineteen });
        await userEvent.type(box(), 'Co-op');

        const twenty = [...nineteen, tag({ id: 99, name: 'twentieth' })];
        view.rerender(
            <EntryTagEditor
                tags={twenty}
                vocabulary={VOCABULARY}
                busy={false}
                disabled={false}
                error={null}
                gameTitle="Celeste"
                onAdd={onAdd}
                onCreate={onCreate}
                onRemove={vi.fn()}
            />,
        );
        fireEvent.keyDown(box(), { key: 'Enter' });

        expect(onAdd).not.toHaveBeenCalled();
        expect(onCreate).not.toHaveBeenCalled();
        expect(status()).toHaveTextContent('A game can carry at most 20 tags.');
    });
});

describe('EntryTagEditor reporting', () => {
    it('shows a failure in an alert', () => {
        renderEditor({ error: 'Could not save your tags. Please try again.' });

        expect(screen.getByRole('alert')).toHaveTextContent('Could not save your tags.');
    });
});
