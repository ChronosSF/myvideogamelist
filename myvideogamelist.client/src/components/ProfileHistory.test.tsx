import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ProfileHistory } from '@/components/ProfileHistory';
import type { UseHistoryResult } from '@/hooks/useHistory';
import type { ListsContextValue } from '@/contexts/ListsContext';
import { LIST_NAMES, type ListId } from '@/types/list';
import { playthroughDateItem, scoreItem, statusItem } from '@/test/factories';

/**
 * The hook, mocked: its fetching and its guards are tested beside it, and this file is about what
 * the page says. One module-level object, mutated per test and never rebuilt, because a fresh
 * object per render re-runs every effect depending on it.
 */
const history: UseHistoryResult = {
    items: [],
    importedStatuses: 0,
    undatedScores: 0,
    loading: false,
    error: null,
    hasMore: false,
    loadingMore: false,
    moreError: null,
    loadMore: vi.fn(),
    reload: vi.fn(),
};

vi.mock('@/hooks/useHistory', () => ({ useHistory: () => history }));

/** The owner has renamed Finished, so a label that reads the defaults would show. */
const lists = {
    nameFor: (id: ListId) => (id === 'finished' ? 'Beaten' : LIST_NAMES[id]),
} as unknown as ListsContextValue;

vi.mock('@/hooks/useLists', () => ({ useLists: () => lists }));

function renderHistory() {
    return render(<MemoryRouter><ProfileHistory userId="user-1" /></MemoryRouter>);
}

/** The line under a game's title: what happened to it. */
function sentenceFor(title: string): string {
    const item = screen.getByRole('link', { name: title }).closest('li');
    if (item === null) throw new Error(`no item for ${title}`);
    return item.querySelector('.history-item-what')?.textContent ?? '';
}

beforeEach(() => {
    Object.assign(history, {
        items: [],
        importedStatuses: 0,
        undatedScores: 0,
        loading: false,
        error: null,
        hasMore: false,
        loadingMore: false,
        moreError: null,
    });
    vi.mocked(history.loadMore).mockReset();
    vi.mocked(history.reload).mockReset();
});

describe('ProfileHistory', () => {
    it('says each kind in its own words', () => {
        history.items = [
            statusItem({ gameId: 1, game: { id: 1, name: 'Hades', coverImageUrl: null }, fromStatus: 'backlog', toStatus: 'playing' }),
            statusItem({ gameId: 2, game: { id: 2, name: 'Celeste', coverImageUrl: null }, fromStatus: null, toStatus: 'backlog' }),
            statusItem({ gameId: 3, game: { id: 3, name: 'Tunic', coverImageUrl: null }, fromStatus: 'dropped', toStatus: null }),
            scoreItem({ gameId: 4, game: { id: 4, name: 'Outer Wilds', coverImageUrl: null }, score: 9 }),
            playthroughDateItem({ gameId: 5, game: { id: 5, name: 'Inside', coverImageUrl: null }, kind: 'playthrough_started', playthroughType: 'completionist' }),
            playthroughDateItem({ gameId: 6, game: { id: 6, name: 'Limbo', coverImageUrl: null }, kind: 'playthrough_finished', playthroughType: null }),
        ];

        renderHistory();

        expect(sentenceFor('Hades')).toBe('Moved from Backlog to Playing');
        expect(sentenceFor('Celeste')).toBe('Added to Backlog');
        expect(sentenceFor('Tunic')).toBe('Removed from Dropped');
        // The owner's own score on the scale they gave it, never a percentage (ADR 0021).
        expect(sentenceFor('Outer Wilds')).toBe('Scored 9/10');
        expect(sentenceFor('Inside')).toBe('Started a playthroughCompletionist');
        expect(sentenceFor('Limbo')).toBe('Finished a playthrough');
    });

    it('names a list as its owner renamed it', () => {
        // The owner's page reads `nameFor`, never the defaults (ADR 0031).
        history.items = [statusItem({ game: { id: 1, name: 'Hades', coverImageUrl: null }, fromStatus: 'playing', toStatus: 'finished' })];

        renderHistory();

        expect(sentenceFor('Hades')).toBe('Moved from Playing to Beaten');
    });

    it('puts the items under their days, newest first as they came', () => {
        history.items = [
            statusItem({ gameId: 1, game: { id: 1, name: 'Hades', coverImageUrl: null }, at: '2026-10-16T12:00:00+00:00' }),
            playthroughDateItem({ gameId: 2, game: { id: 2, name: 'Inside', coverImageUrl: null }, on: '2026-10-16' }),
            scoreItem({ gameId: 3, game: { id: 3, name: 'Celeste', coverImageUrl: null }, at: '2026-09-02T12:00:00+00:00' }),
        ];

        renderHistory();

        const days = within(screen.getByRole('list', { name: 'Your history, newest first' }))
            .getAllByRole('heading', { level: 3 })
            .map(heading => heading.textContent);
        expect(days).toEqual(['16 October 2026', '2 September 2026']);
    });

    it('links a game to its page, and keeps an item whose game cannot be named', () => {
        // The record is still the owner's when the game's details are not to hand, so it is listed,
        // unlinked, rather than dropped.
        history.items = [
            statusItem({ gameId: 42, game: { id: 42, name: 'Hades', coverImageUrl: 'https://images.example/42.jpg' } }),
            statusItem({ gameId: 43, game: null }),
        ];

        renderHistory();

        expect(screen.getByRole('link', { name: 'Hades' })).toHaveAttribute('href', '/games/42');
        expect(screen.getByText('A game whose details could not be loaded')).toBeInTheDocument();
        expect(screen.getAllByRole('link')).toHaveLength(1);
    });

    it('says what it leaves out, and why', () => {
        history.items = [statusItem()];
        history.importedStatuses = 312;
        history.undatedScores = 1;

        renderHistory();

        expect(screen.getByText(/312 of your games were put in their lists by an import/)).toBeInTheDocument();
        expect(screen.getByText(/One of your scores has no date/)).toBeInTheDocument();
    });

    it('says nothing about absences when nothing is missing', () => {
        history.items = [statusItem()];

        renderHistory();

        expect(screen.queryByText(/import/)).not.toBeInTheDocument();
        expect(screen.queryByText(/no date/)).not.toBeInTheDocument();
    });

    it('with nothing dated, says so without claiming nothing was recorded', () => {
        // An imported library can have hundreds of games and not one item. The empty line speaks of
        // dates, and the note under it says where those games went.
        history.importedStatuses = 600;

        renderHistory();

        expect(screen.getByText(/Nothing with a date yet/)).toBeInTheDocument();
        expect(screen.getByText(/600 of your games were put in their lists by an import/)).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Your history, newest first' })).not.toBeInTheDocument();
    });

    it('is busy while the first page is on its way', () => {
        history.loading = true;

        renderHistory();

        expect(screen.getByRole('region', { name: 'Your history' })).toHaveAttribute('aria-busy', 'true');
    });

    it('offers to try again when the first page failed', async () => {
        history.error = 'Failed to load your history (500)';

        renderHistory();
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load your history (500)');
        expect(history.reload).toHaveBeenCalledOnce();
    });

    it('asks for the next page, and starts again when the cursor is refused', async () => {
        history.items = [statusItem()];
        history.hasMore = true;
        history.moreError = { message: 'That is not a page of this history. Start again from the first.', restart: true };

        renderHistory();
        await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
        await userEvent.click(screen.getByRole('button', { name: 'Start again' }));

        expect(history.loadMore).toHaveBeenCalledOnce();
        expect(history.reload).toHaveBeenCalledOnce();
        // The list stays: what failed was the next page, not the one on screen.
        expect(screen.getByRole('list', { name: 'Your history, newest first' })).toBeInTheDocument();
    });

    it('offers no restart for a next page that only needs another press', () => {
        history.items = [statusItem()];
        history.hasMore = true;
        history.moreError = { message: 'More of your history could not be loaded. Please try again.', restart: false };

        renderHistory();

        expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
        expect(screen.queryByRole('button', { name: 'Start again' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled();
    });
});
