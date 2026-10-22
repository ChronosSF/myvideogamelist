import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ProfileHistory } from '@/components/ProfileHistory';
import type { UseHistoryResult } from '@/hooks/useHistory';
import type { ListsContextValue } from '@/contexts/ListsContext';
import type { HistoryItem } from '@/types/history';
import { LIST_NAMES, type ListId } from '@/types/list';
import { playthroughDateItem, scoreItem, statusItem } from '@/test/factories';

/**
 * The hook, mocked: its fetching and its guards are tested beside it, and this file is about what
 * the page says and where focus goes. One module-level object, mutated per test and never rebuilt,
 * because a fresh object per render re-runs every effect depending on it.
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

const page = () => <MemoryRouter><ProfileHistory userId="user-1" /></MemoryRouter>;

function game(id: number, name: string) {
    return { gameId: id, game: { id, name, coverImageUrl: null } };
}

/** The item a game's title links from. */
function itemFor(title: string): HTMLElement {
    const item = screen.getByRole('link', { name: title }).closest('li');
    if (item === null) throw new Error(`no item for ${title}`);
    return item;
}

/**
 * What the item says happened. The item's whole text, which is its title and then the sentence, so a
 * word too many or too few — or two run together — fails.
 */
function says(title: string, sentence: string) {
    expect(itemFor(title).textContent).toBe(`${title}${sentence}`);
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
            statusItem({ ...game(1, 'Hades'), fromStatus: 'backlog', toStatus: 'playing' }),
            statusItem({ ...game(2, 'Celeste'), fromStatus: null, toStatus: 'backlog' }),
            statusItem({ ...game(3, 'Tunic'), fromStatus: 'dropped', toStatus: null }),
            scoreItem({ ...game(4, 'Outer Wilds'), score: 9 }),
            playthroughDateItem({ ...game(5, 'Inside'), kind: 'playthrough_started', playthroughType: 'completionist' }),
            playthroughDateItem({ ...game(6, 'Limbo'), kind: 'playthrough_finished', playthroughType: null }),
        ];

        render(page());

        says('Hades', 'Moved from Backlog to Playing');
        says('Celeste', 'Added to Backlog');
        says('Tunic', 'Removed from Dropped');
        // The owner's own score on the scale they gave it, never a percentage (ADR 0021).
        says('Outer Wilds', 'Scored 9/10');
        // The type a word of its own, read aloud and copied as one.
        says('Inside', 'Started a playthrough Completionist');
        says('Limbo', 'Finished a playthrough');
    });

    it('names a list as its owner renamed it, the caption included', () => {
        // The owner's page reads `nameFor`, never the defaults (ADR 0031).
        history.items = [statusItem({ ...game(1, 'Hades'), fromStatus: 'playing', toStatus: 'finished' })];

        render(page());

        says('Hades', 'Moved from Playing to Beaten');
        expect(screen.getByText(/by a move to Beaten is listed twice here/)).toBeInTheDocument();
    });

    it('puts the items under their days, newest first as they came', () => {
        history.items = [
            statusItem({ ...game(1, 'Hades'), at: '2026-10-16T12:00:00+00:00' }),
            playthroughDateItem({ ...game(2, 'Inside'), on: '2026-10-16' }),
            scoreItem({ ...game(3, 'Celeste'), at: '2026-09-02T12:00:00+00:00' }),
        ];

        render(page());

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

        render(page());

        expect(screen.getByRole('link', { name: 'Hades' })).toHaveAttribute('href', '/games/42');
        expect(screen.getByText('This game\'s details are not available')).toBeInTheDocument();
        expect(screen.getAllByRole('link')).toHaveLength(1);
    });

    it('says what it leaves out, and why', () => {
        history.items = [statusItem()];
        history.importedStatuses = 312;
        history.undatedScores = 1;

        render(page());

        expect(screen.getByText(/312 of your games were put in their lists by an import/)).toBeInTheDocument();
        expect(screen.getByText(/One of your scores has no date/)).toBeInTheDocument();
    });

    it('says nothing about absences when nothing is missing', () => {
        history.items = [statusItem()];

        render(page());

        expect(screen.queryByText(/by an import/)).not.toBeInTheDocument();
        expect(screen.queryByText(/no date/)).not.toBeInTheDocument();
    });

    it('with nothing dated, says so without claiming nothing was recorded', () => {
        // An imported library can have hundreds of games and not one item. The empty line speaks of
        // dates, and the note under it says where those games went.
        history.importedStatuses = 600;

        render(page());

        expect(screen.getByText(/Nothing with a date yet/)).toBeInTheDocument();
        expect(screen.getByText(/600 of your games were put in their lists by an import/)).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Your history, newest first' })).not.toBeInTheDocument();
    });

    it('does not call a page of kinds it cannot draw empty', () => {
        // A newer API in front of an older client: the items are there, and the next page may hold
        // some this client knows, so the button stays and "nothing yet" would be false.
        history.items = [{ ...statusItem(), kind: 'review' } as unknown as HistoryItem];
        history.hasMore = true;

        render(page());

        expect(screen.queryByText(/Nothing with a date yet/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show older history' })).toBeInTheDocument();
    });

    it('is busy while the first page is on its way', () => {
        history.loading = true;

        render(page());

        expect(screen.getByRole('region', { name: 'Your history' })).toHaveAttribute('aria-busy', 'true');
    });

    it('offers to try again when the first page failed', async () => {
        history.error = 'Failed to load your history (500)';

        render(page());
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load your history (500)');
        expect(history.reload).toHaveBeenCalledOnce();
    });
});

describe('ProfileHistory\'s next page', () => {
    it('offers no button when there is nothing older', () => {
        history.items = [statusItem()];

        render(page());

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('stays focusable while a page loads, and ignores a second press', async () => {
        // aria-disabled rather than disabled: a disabled button would drop the focus it holds.
        history.items = [statusItem()];
        history.hasMore = true;
        history.loadingMore = true;

        render(page());
        const button = screen.getByRole('button', { name: 'Loading…' });
        await userEvent.click(button);

        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toBeEnabled();
        expect(history.loadMore).not.toHaveBeenCalled();
    });

    it('hands focus to the first item a page adds once it lands', async () => {
        history.items = [statusItem({ ...game(1, 'Hades') })];
        history.hasMore = true;
        const view = render(page());

        await userEvent.click(screen.getByRole('button', { name: 'Show older history' }));
        expect(history.loadMore).toHaveBeenCalledOnce();

        history.loadingMore = true;
        view.rerender(page());
        history.loadingMore = false;
        history.items = [...history.items, statusItem({ ...game(2, 'Celeste') }), statusItem({ ...game(3, 'Tunic') })];
        view.rerender(page());

        expect(document.activeElement).toBe(itemFor('Celeste'));
    });

    it('leaves focus on the button when the page failed', async () => {
        history.items = [statusItem({ ...game(1, 'Hades') })];
        history.hasMore = true;
        const view = render(page());
        const button = screen.getByRole('button', { name: 'Show older history' });

        await userEvent.click(button);
        history.loadingMore = true;
        view.rerender(page());
        history.loadingMore = false;
        history.moreError = { message: 'More of your history could not be loaded. Please try again.', restart: false };
        view.rerender(page());

        expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
        expect(document.activeElement).toBe(button);
        expect(button).toHaveAccessibleName('Show older history');
    });

    it('becomes the way back to the first page when the cursor is refused', async () => {
        // A refused cursor fails the same way however often it is sent, so pressing again offers
        // the first page instead — on the same button, so focus does not fall to the page — and
        // the heading takes focus as the list makes way for it.
        history.items = [statusItem()];
        history.hasMore = true;
        history.moreError = { message: 'That is not a page of this history. Start again from the first.', restart: true };

        render(page());
        await userEvent.click(screen.getByRole('button', { name: 'Start again' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Start again from the first.');
        expect(history.reload).toHaveBeenCalledOnce();
        expect(history.loadMore).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Your history' }));
    });
});
