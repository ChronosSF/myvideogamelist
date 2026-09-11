import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ContinuePlayingRail } from '@/components/ContinuePlayingRail';
import { DEFAULT_SORT } from '@/lib/listSort';
import { emptyLists, type ListEntryDto, type ListId } from '@/types/list';
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
    deleteEntry: vi.fn(async () => {}),
    view: 'tiles' as const,
    setView: vi.fn(),
    sortFor: () => DEFAULT_SORT,
    setSort: vi.fn(),
};

vi.mock('@/hooks/useLists', () => ({ useLists: () => listsValue }));

function playing(entries: ListEntryDto[]) {
    listsValue.lists = { ...emptyLists(), playing: entries };
}

function renderRail() {
    return render(<MemoryRouter><ContinuePlayingRail /></MemoryRouter>);
}

beforeEach(() => {
    listsValue.lists = emptyLists();
    listsValue.loading = false;
    listsValue.pending = new Set();
    listsValue.addToList.mockReset();
    listsValue.addToList.mockResolvedValue(undefined);
});

describe('ContinuePlayingRail', () => {
    it('shows what the user is playing', () => {
        playing([entry({ game: { id: 1, title: 'Hollow Knight' } })]);
        renderRail();

        expect(screen.getByRole('link', { name: /hollow knight/i }))
            .toHaveAttribute('href', '/games/1');
    });

    it('puts the most recently started game first', () => {
        // Not "recently added", which is the lists page's default and would bury the game somebody
        // added to their backlog a year ago and started last night — exactly the one this is for.
        playing([
            entry({
                game: { id: 1, title: 'Older' },
                addedAt: '2026-01-01T00:00:00+00:00',
                statusChangedAt: '2026-01-02T00:00:00+00:00',
            }),
            entry({
                game: { id: 2, title: 'Newer' },
                addedAt: '2025-01-01T00:00:00+00:00',
                statusChangedAt: '2026-09-01T00:00:00+00:00',
            }),
        ]);
        renderRail();

        const titles = screen.getAllByRole('link').map(link => link.textContent);
        expect(titles).toEqual(['Newer', 'Older']);
    });

    it('is a named, focusable region because it scrolls on its own', () => {
        playing([entry({ game: { id: 1 } })]);
        renderRail();

        expect(screen.getByRole('list', { name: /games you are playing/i })).toBeInTheDocument();
    });
});

describe('ContinuePlayingRail marking a game finished', () => {
    it('goes through the provider, which is what records the event', () => {
        // A status change written any other way leaves a permanent hole in the history
        // (ADR 0018), so what is asserted here is the call rather than any visible outcome.
        const playingCeleste = entry({ game: { id: 7, title: 'Celeste' } });
        playing([playingCeleste]);
        renderRail();

        return userEvent.setup()
            .click(screen.getByRole('button', { name: /mark finished/i }))
            .then(() => waitFor(() => expect(listsValue.addToList)
                .toHaveBeenCalledWith('finished', playingCeleste.game)));
    });

    it('locks the control while that game has a request out', () => {
        // The per-game lock, which is what stops two overlapping writes to one entry rolling back
        // over each other.
        playing([entry({ game: { id: 7 } })]);
        listsValue.pending = new Set([7]);
        renderRail();

        expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
    });
});

describe('ContinuePlayingRail with nothing to continue', () => {
    it('says so, and points at the lists', () => {
        renderRail();

        expect(screen.getByText(/nothing in your playing list/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /go to your lists/i }))
            .toHaveAttribute('href', '/lists');
    });

    it('renders nothing at all while the lists are still loading', () => {
        // An empty-state message that turns into six covers a moment later is worse than a moment
        // of nothing.
        listsValue.loading = true;
        const { container } = renderRail();

        expect(container).toBeEmptyDOMElement();
    });
});
