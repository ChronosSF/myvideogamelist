import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameUserPanel } from '@/components/GameUserPanel';
import { ListsContext, type ListsContextValue } from '@/contexts/ListsContext';
import { WishlistContext, type WishlistContextValue } from '@/contexts/WishlistContext';
import { DEFAULT_SORT } from '@/lib/listSort';
import type { ListId } from '@/types/list';
import { entry, game } from '@/test/factories';

const CELESTE = game({ id: 1, title: 'Celeste' });

/** A context whose behaviour each test can steer, without the provider's fetches in the way. */
function contextValue(overrides: Partial<ListsContextValue> = {}): ListsContextValue {
    return {
        lists: { backlog: [], playing: [], on_hold: [], finished: [], dropped: [] },
        loading: false,
        error: null,
        mutationError: null,
        isPending: () => false,
        addToList: vi.fn(async () => {}),
        removeFromList: vi.fn(async () => {}),
        isInList: () => false,
        getListFor: () => null,
        scoreFor: () => null,
        setScore: vi.fn(async () => true),
        deleteEntry: vi.fn(async () => {}),
        view: 'tiles',
        setView: vi.fn(),
        sortFor: () => DEFAULT_SORT,
        setSort: vi.fn(),
        ...overrides,
    };
}

/** The wishlist is a second axis with its own context, so the panel needs both. */
function wishlistValue(overrides: Partial<WishlistContextValue> = {}): WishlistContextValue {
    return {
        items: [],
        loading: false,
        error: null,
        mutationError: null,
        isWishlisted: () => false,
        isPending: () => false,
        add: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        ...overrides,
    };
}

function renderPanel(
    overrides: Partial<ListsContextValue> = {},
    wishlistOverrides: Partial<WishlistContextValue> = {},
) {
    const value = contextValue(overrides);
    const wishlist = wishlistValue(wishlistOverrides);
    render(
        <ListsContext.Provider value={value}>
            <WishlistContext.Provider value={wishlist}>
                <GameUserPanel game={CELESTE} />
            </WishlistContext.Provider>
        </ListsContext.Provider>,
    );
    return { ...value, wishlist };
}

/** The entry the panel fetches for itself, since the provider only knows about listed games. */
function stubEntryFetch(score: number | null, status = 200) {
    // The parameter is declared, unused, so `fetchMock.mock.calls` is typed and the URL can be
    // asserted rather than just the fact that something was fetched.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
        status === 200
            ? new Response(JSON.stringify(entry({ game: { id: 1, title: 'Celeste' }, score })), { status })
            : new Response('not found', { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/**
 * Waits for the panel's own entry fetch to land.
 *
 * Without this, a synchronous assertion races the fetch and React reports a state update outside
 * `act(...)` — a warning that would go on to mask real ones. The score control is disabled until
 * the entry has loaded, either way, so it doubles as the "settled" signal.
 */
async function settled() {
    await waitFor(() => expect(screen.getByLabelText('Your score for Celeste')).toBeEnabled());
}

/** The score the star control is showing, or null when no star is selected. */
function shownScore(): number | null {
    const checked = screen.getAllByRole('radio').find(radio => (radio as HTMLInputElement).checked);
    return checked === undefined ? null : Number((checked as HTMLInputElement).value);
}

/** A `setScore` whose promise the test resolves, so the optimistic state is observable. */
function deferredSetScore() {
    let settle!: (saved: boolean) => void;
    const setScore = vi.fn(() => new Promise<boolean>(resolve => { settle = resolve; }));
    return { setScore, finish: (saved: boolean) => act(async () => { settle(saved); }) };
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('GameUserPanel list placement', () => {
    it('offers all five statuses', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        for (const name of ['Backlog', 'Playing', 'On Hold', 'Finished', 'Dropped']) {
            expect(screen.getByRole('button', { name }), name).toBeInTheDocument();
        }
    });

    it('marks the status the game is in', async () => {
        stubEntryFetch(null, 404);
        renderPanel({ isInList: (listId: ListId) => listId === 'on_hold', getListFor: () => 'on_hold' });
        await settled();

        expect(screen.getByRole('button', { name: 'On Hold' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Playing' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('says so when the game is in no list', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByText('Not in any of your lists.')).toBeInTheDocument();
    });

    it('moves the game when an inactive status is clicked', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Finished' }));

        expect(ctx.addToList).toHaveBeenCalledWith('finished', CELESTE);
    });

    it('takes the game out when the active status is clicked again', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel({ isInList: (listId: ListId) => listId === 'playing', getListFor: () => 'playing' });
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Playing' }));

        expect(ctx.removeFromList).toHaveBeenCalledWith('playing', 1);
    });
});

describe('GameUserPanel scoring', () => {
    it('loads the score for a game that is in no list', async () => {
        // The whole reason the panel fetches its own entry: the provider only carries listed games.
        stubEntryFetch(8);
        renderPanel();

        await waitFor(() => expect(shownScore()).toBe(8));
    });

    it('asks the entry endpoint for it', async () => {
        const fetchMock = stubEntryFetch(8);
        renderPanel();

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(String(fetchMock.mock.calls[0][0])).toBe('/api/entries/1');
    });

    it('stays usable when the game has never been touched', async () => {
        stubEntryFetch(null, 404);
        renderPanel();

        await settled();
    });

    it('says that the score outlives list membership', async () => {
        // The opposite of what most trackers do, so the panel states it rather than assuming.
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByText(/kept whatever list this is in, or none/i)).toBeInTheDocument();
    });

    it('saves a chosen score', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel();

        await settled();
        await userEvent.click(screen.getByRole('radio', { name: '9 out of 10' }));

        expect(ctx.setScore).toHaveBeenCalledWith(1, 9);
    });

    it('shows a half-star score, which the old dropdown could not', async () => {
        // Nine is a whole star and a half. Half-star steps exist so the odd scores the API has
        // always accepted are actually reachable — see ADR 0021.
        stubEntryFetch(null, 404);
        const ctx = renderPanel();

        await settled();
        await userEvent.click(screen.getByRole('radio', { name: '9 out of 10' }));

        expect(ctx.setScore).toHaveBeenCalledWith(1, 9);
        await waitFor(() => expect(shownScore()).toBe(9));
    });

    it('reverts the shown score when the save fails', async () => {
        stubEntryFetch(6);
        const { setScore, finish } = deferredSetScore();
        renderPanel({ setScore });

        await waitFor(() => expect(shownScore()).toBe(6));
        await userEvent.click(screen.getByRole('radio', { name: '2 out of 10' }));

        // Optimistic first, so the control never feels laggy...
        expect(shownScore()).toBe(2);

        await finish(false);

        // ...and back to what the server still holds once the save is refused.
        expect(shownScore()).toBe(6);
    });

    it('keeps the shown score when the save succeeds', async () => {
        stubEntryFetch(6);
        const { setScore, finish } = deferredSetScore();
        renderPanel({ setScore });

        await waitFor(() => expect(shownScore()).toBe(6));
        await userEvent.click(screen.getByRole('radio', { name: '2 out of 10' }));

        await finish(true);

        expect(shownScore()).toBe(2);
    });

    it('takes the score off when the star already given is clicked again', async () => {
        stubEntryFetch(7);
        const ctx = renderPanel();

        await waitFor(() => expect(shownScore()).toBe(7));
        await userEvent.click(screen.getByRole('radio', { name: '7 out of 10' }));

        expect(ctx.setScore).toHaveBeenCalledWith(1, null);
    });
});

describe('GameUserPanel deleting everything', () => {
    it('offers no delete for a game with nothing recorded', async () => {
        stubEntryFetch(null, 404);
        renderPanel();

        await settled();
        expect(screen.queryByRole('button', { name: /delete my data/i })).not.toBeInTheDocument();
    });

    it('offers it for a game that is only scored, with no list', async () => {
        stubEntryFetch(7);
        renderPanel();

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /delete my data/i })).toBeInTheDocument());
    });

    it('offers it for a game that is only listed, with no score', async () => {
        stubEntryFetch(null, 404);
        renderPanel({ getListFor: () => 'backlog', isInList: (id: ListId) => id === 'backlog' });
        await settled();

        expect(screen.getByRole('button', { name: /delete my data/i })).toBeInTheDocument();
    });

    it('asks before deleting', async () => {
        stubEntryFetch(7);
        const ctx = renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));

        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(ctx.deleteEntry).not.toHaveBeenCalled();
    });

    it('says that the status history is kept', async () => {
        stubEntryFetch(7);
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));

        expect(screen.getByText(/history of moving it between lists is kept/i)).toBeInTheDocument();
    });

    it('deletes once confirmed', async () => {
        stubEntryFetch(7);
        const ctx = renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(ctx.deleteEntry).toHaveBeenCalledWith(1);
    });

    it('clears the shown score after deleting', async () => {
        stubEntryFetch(7);
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(shownScore()).toBeNull());
    });

    it('backs out on cancel without deleting', async () => {
        stubEntryFetch(7);
        const ctx = renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(ctx.deleteEntry).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /delete my data/i })).toBeInTheDocument();
    });
});

describe('GameUserPanel wishlist', () => {
    it('offers to wishlist a game that is not on it', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        const button = screen.getByRole('button', { name: 'Add to wishlist' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    it('says so for a game already on it', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, { isWishlisted: () => true });
        await settled();

        expect(screen.getByRole('button', { name: 'On your wishlist' }))
            .toHaveAttribute('aria-pressed', 'true');
    });

    it('passes the whole game when adding, not just the id', async () => {
        // The provider inserts the row optimistically, so it needs something to render.
        stubEntryFetch(null, 404);
        const ctx = renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }));

        expect(ctx.wishlist.add).toHaveBeenCalledWith(CELESTE);
    });

    it('takes it off when clicked while already wishlisted', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel({}, { isWishlisted: () => true });
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'On your wishlist' }));

        expect(ctx.wishlist.remove).toHaveBeenCalledWith(1);
    });

    it('can be wishlisted while sitting in a status list', async () => {
        // The whole point of the separate axis: wanting a game and playing it are not exclusive,
        // which a sixth status could not have expressed.
        stubEntryFetch(null, 404);
        const ctx = renderPanel(
            { isInList: (id: ListId) => id === 'playing', getListFor: () => 'playing' },
            { isWishlisted: () => true },
        );
        await settled();

        expect(screen.getByRole('button', { name: 'Playing' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'On your wishlist' })).toHaveAttribute('aria-pressed', 'true');
        expect(ctx.wishlist.remove).not.toHaveBeenCalled();
    });

    it('is disabled while its own mutation is in flight', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, { isPending: () => true });
        await settled();

        expect(screen.getByRole('button', { name: 'Add to wishlist' })).toBeDisabled();
    });

    it('stays usable while a list mutation is in flight', async () => {
        // Two independent axes with two pending sets. Sharing one would block a wishlist click
        // because an unrelated status change happened to be in flight.
        stubEntryFetch(null, 404);
        renderPanel({ isPending: () => true });

        expect(screen.getByRole('button', { name: 'Add to wishlist' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Playing' })).toBeDisabled();
    });

    it('surfaces a failed toggle', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, { mutationError: 'Failed to update your wishlist. Please try again.' });
        await settled();

        expect(screen.getByRole('alert')).toHaveTextContent(/failed to update your wishlist/i);
    });

    it('leaves a wishlist that failed to load to the page, not to this panel', async () => {
        // A load failure is a whole-page condition. This panel is about one game, and repeating
        // it here would put the same message in two places on the game page.
        stubEntryFetch(null, 404);
        renderPanel({}, { error: 'Failed to load your wishlist (500)' });
        await settled();

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
