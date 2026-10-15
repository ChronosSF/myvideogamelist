import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { PlayNextPicker } from '@/components/PlayNextPicker';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import { DEFAULT_SORT } from '@/lib/listSort';
import { emptyLists, LIST_NAMES, type ListEntryDto, type ListId } from '@/types/list';
import { entry } from '@/test/factories';

/**
 * The lists context, mocked rather than provided: the real one fetches, and this component only
 * reads what it already holds.
 *
 * One module-level object handed back every call, never a fresh literal — a new object per render
 * re-runs any effect depending on it, which ends in a heap crash rather than an assertion failure.
 */
const listsValue = {
    lists: emptyLists() as Record<ListId, ListEntryDto[]>,
    loading: false,
    error: null as string | null,
    mutationError: null as string | null,
    pending: new Set<number>(),
    isPending: (gameId: number) => listsValue.pending.has(gameId),
    addToList: vi.fn(async () => {}),
    removeFromList: vi.fn(async () => {}),
    isInList: () => false,
    getListFor: () => null,
    scoreFor: () => null,
    setScore: vi.fn(async () => true),
    setOwnership: vi.fn(async () => true),
    setNotes: vi.fn(async () => true),
    deleteEntry: vi.fn(async () => true),
    view: 'tiles' as const,
    setView: vi.fn(),
    sortFor: () => DEFAULT_SORT,
    setSort: vi.fn(),
    names: {},
    nameFor: (id: ListId) => LIST_NAMES[id],
    namesStatus: 'ready',
    saveListNames: vi.fn(async () => ({ ok: true as const })),
};

vi.mock('@/hooks/useLists', () => ({ useLists: () => listsValue }));

/** The reader's favourites, as far as the rosette reads them. Hoisted and handed back whole, as above. */
const favoured = new Set<number>();
const favourites = {
    isFavourite: (gameId: number) => favoured.has(gameId),
} as unknown as FavouritesContextValue;

vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

const HADES = entry({ game: { id: 1, title: 'Hades' } });
const CELESTE = entry({ game: { id: 2, title: 'Celeste' } });
const OUTER_WILDS = entry({ game: { id: 3, title: 'Outer Wilds' } });

function backlog(entries: ListEntryDto[]) {
    listsValue.lists = { ...emptyLists(), backlog: entries };
}

const picker = () => <MemoryRouter><PlayNextPicker /></MemoryRouter>;

/** The title link, which is the one link on the card a screen reader is given. */
const pickedTitle = () => screen.getByRole('link').textContent;

beforeEach(() => {
    listsValue.lists = emptyLists();
    listsValue.loading = false;
    listsValue.error = null;
    listsValue.pending = new Set();
    listsValue.addToList.mockReset();
    listsValue.addToList.mockResolvedValue(undefined);
    // The first draw lands on the first game unless a test says otherwise.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    favoured.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('PlayNextPicker', () => {
    it('picks a game from the backlog', () => {
        backlog([HADES, CELESTE]);
        render(picker());

        expect(pickedTitle()).toBe('Hades');
        expect(screen.getByRole('link', { name: 'Hades' })).toHaveAttribute('href', '/games/1');
        expect(screen.getByText('Picked from the 2 games in your backlog.')).toBeInTheDocument();
    });

    it('lands wherever the draw says', () => {
        // Random per visit, not the first game every time.
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        backlog([HADES, CELESTE, OUTER_WILDS]);
        render(picker());

        expect(pickedTitle()).toBe('Outer Wilds');
    });

    it('rerolls to a different game, never the one showing', async () => {
        const actor = userEvent.setup();
        backlog([HADES, CELESTE, OUTER_WILDS]);
        render(picker());
        expect(pickedTitle()).toBe('Hades');

        // Drawn from the other two, so the first of those rather than the first of all three.
        await actor.click(screen.getByRole('button', { name: 'Pick another' }));

        expect(pickedTitle()).toBe('Celeste');
    });

    it('has nothing to reroll to with one game', () => {
        backlog([HADES]);
        render(picker());

        expect(screen.getByRole('button', { name: 'Pick another' })).toBeDisabled();
        expect(screen.getByText('The only game in your backlog.')).toBeInTheDocument();
    });

    it('announces what a reroll landed on', () => {
        backlog([HADES, CELESTE]);
        render(picker());

        expect(screen.getByRole('link', { name: 'Hades' }).closest('[aria-live]'))
            .toHaveAttribute('aria-live', 'polite');
    });
});

describe('PlayNextPicker starting the pick', () => {
    it('goes through the provider, which is what records the event', async () => {
        // A status change written any other way leaves a permanent hole in the history (ADR 0018).
        const actor = userEvent.setup();
        backlog([HADES, CELESTE]);
        render(picker());

        await actor.click(screen.getByRole('button', { name: 'Start playing' }));

        await waitFor(() => expect(listsValue.addToList).toHaveBeenCalledWith('playing', HADES.game));
    });

    it('stays on the game while its start is in flight', () => {
        // The provider takes the game out of the backlog before the request answers. The card must
        // not jump to another game in the meantime, and jump back if the request fails.
        backlog([HADES, CELESTE]);
        const view = render(picker());

        backlog([CELESTE]);
        listsValue.pending = new Set([HADES.game.id]);
        view.rerender(picker());

        expect(pickedTitle()).toBe('Hades');
        expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Pick another' })).toBeDisabled();
    });

    it('moves on to another game once the pick has left the backlog', () => {
        backlog([HADES, CELESTE]);
        const view = render(picker());

        backlog([CELESTE]);
        view.rerender(picker());

        expect(pickedTitle()).toBe('Celeste');
    });
});

describe('PlayNextPicker with nothing to pick', () => {
    it('says the backlog is empty, and points at the games', () => {
        render(picker());

        expect(screen.getByText(/your backlog is empty/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Browse games' })).toHaveAttribute('href', '/games');
    });

    it('renders nothing at all while the lists are still loading', () => {
        listsValue.loading = true;
        const { container } = render(picker());

        expect(container).toBeEmptyDOMElement();
    });

    it('says the backlog could not be loaded, rather than that it is empty', () => {
        // A failed load leaves every list empty, which is exactly what an empty backlog looks like.
        listsValue.error = 'Failed to load lists (500)';
        render(picker());

        expect(screen.getByText('Your backlog could not be loaded just now.')).toBeInTheDocument();
        expect(screen.queryByText(/your backlog is empty/i)).not.toBeInTheDocument();
    });
});

describe('PlayNextPicker favourites', () => {
    it('says so when the game it picked is one of the reader\'s favourites', () => {
        backlog([HADES]);
        favoured.add(HADES.game.id);
        render(picker());

        expect(screen.getByRole('img', { name: 'One of your favourites' })).toBeInTheDocument();
        expect(pickedTitle()).toBe('Hades');
        // Read whole when it changes, so a reroll or the favourites arriving late is heard with the
        // game it is about rather than as "One of your favourites" alone.
        expect(screen.getByRole('link', { name: 'Hades' }).closest('[aria-live]')).toHaveAttribute('aria-atomic', 'true');
    });

    it('marks nothing on a game that is not one', () => {
        backlog([HADES]);
        render(picker());

        expect(screen.queryByRole('img', { name: 'One of your favourites' })).not.toBeInTheDocument();
    });
});
