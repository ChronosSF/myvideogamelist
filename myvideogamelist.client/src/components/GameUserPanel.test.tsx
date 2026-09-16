import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameUserPanel } from '@/components/GameUserPanel';
import { ListsContext, type ListsContextValue } from '@/contexts/ListsContext';
import { WishlistContext, type WishlistContextValue } from '@/contexts/WishlistContext';
import { FavouritesContext, type FavouritesContextValue } from '@/contexts/FavouritesContext';
import { DEFAULT_SORT } from '@/lib/listSort';
import type { ProfileVisibility } from '@/types/auth';
import { LIST_NAMES, type ListId } from '@/types/list';
import type { PlaythroughDto, ReviewDto } from '@/types/playthrough';
import { entryDetail, game, platform, playthrough, review } from '@/test/factories';

const CELESTE = game({
    id: 1,
    title: 'Celeste',
    platforms: [platform(6, 'PC (Microsoft Windows)'), platform(48, 'PlayStation 4')],
});

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
        setOwnership: vi.fn(async () => true),
        setNotes: vi.fn(async () => true),
        deleteEntry: vi.fn(async () => true),
        view: 'tiles',
        setView: vi.fn(),
        sortFor: () => DEFAULT_SORT,
        setSort: vi.fn(),
        names: {},
        nameFor: (id: ListId) => LIST_NAMES[id],
        namesStatus: 'ready',
        saveListNames: vi.fn(async () => ({ ok: true as const })),
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
        add: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        reload: vi.fn(),
        ...overrides,
    };
}

/** And the favourites are a third, with a third context. */
function favouritesValue(overrides: Partial<FavouritesContextValue> = {}): FavouritesContextValue {
    return {
        items: [],
        loading: false,
        error: null,
        mutationError: null,
        isFavourite: () => false,
        isPending: () => false,
        add: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        reload: vi.fn(),
        ...overrides,
    };
}

function renderPanel(
    overrides: Partial<ListsContextValue> = {},
    wishlistOverrides: Partial<WishlistContextValue> = {},
    profileVisibility: ProfileVisibility = 'private',
    favouritesOverrides: Partial<FavouritesContextValue> = {},
) {
    const value = contextValue(overrides);
    const wishlist = wishlistValue(wishlistOverrides);
    const favourites = favouritesValue(favouritesOverrides);
    const onCommunityChange = vi.fn();
    render(
        <ListsContext.Provider value={value}>
            <WishlistContext.Provider value={wishlist}>
                <FavouritesContext.Provider value={favourites}>
                    <GameUserPanel
                        game={CELESTE}
                        profileVisibility={profileVisibility}
                        onCommunityChange={onCommunityChange}
                    />
                </FavouritesContext.Provider>
            </WishlistContext.Provider>
        </ListsContext.Provider>,
    );
    return { ...value, wishlist, favourites, onCommunityChange };
}

/**
 * The API the panel talks to: one read for the entry and its playthroughs, and the playthrough
 * writes.
 *
 * One stub rather than two, because the panel holds a single `fetch` and a second `stubGlobal`
 * would silently replace the first — the symptom being an entry read answered with a playthrough
 * response.
 */
function stubEntryFetch(
    score: number | null,
    status = 200,
    playthroughs: PlaythroughDto[] = [],
    onWrite?: (url: string, init: RequestInit | undefined) => Response,
    existingReview: ReviewDto | null = null,
) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/playthroughs') || url.includes('/review')) {
            return onWrite?.(url, init) ?? new Response(null, { status: 204 });
        }

        return status === 200
            ? new Response(
                JSON.stringify(entryDetail({
                    entry: { game: { id: 1, title: 'Celeste' }, score },
                    playthroughs,
                    review: existingReview,
                })),
                { status })
            : new Response('not found', { status });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** The body of the nth request the panel made, parsed. */
function bodyOf(fetchMock: ReturnType<typeof stubEntryFetch>, call: number): unknown {
    return JSON.parse(String(fetchMock.mock.calls[call][1]?.body));
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

describe('GameUserPanel when the entry cannot be read', () => {
    /*
     * Only a 404 means "nothing recorded". Any other failure leaves the score, ownership, notes,
     * playthroughs and review unknown — and shown as empty, the notes box and the review form would
     * invite a save over text the user already has.
     */

    it('does not take a failed read for an empty entry', async () => {
        stubEntryFetch(null, 500);
        renderPanel();

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
        expect(screen.getByLabelText('Your score for Celeste')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Owned' })).toBeDisabled();
        expect(screen.getByLabelText('Your notes')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Log playthrough' })).toBeDisabled();
        expect(screen.getByLabelText('What you thought')).toBeDisabled();
    });

    it('treats an unreachable API the same way', async () => {
        // fetch rejects rather than returning a bad response, which no status check sees.
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network down'); }));
        renderPanel();

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
        expect(screen.getByLabelText('Your score for Celeste')).toBeDisabled();
    });

    it('leaves the lists, the wishlist and the favourite usable, since they are not from this read', async () => {
        stubEntryFetch(null, 500);
        renderPanel();
        await screen.findByRole('alert');

        expect(screen.getByRole('button', { name: 'Playing' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Add to wishlist' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeEnabled();
    });

    it('reads it again on retry, and offers the controls once it arrives', async () => {
        const actor = userEvent.setup();
        let attempts = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            attempts++;
            return attempts === 1
                ? new Response('nope', { status: 500 })
                : new Response(
                    JSON.stringify(entryDetail({ entry: { game: { id: 1, title: 'Celeste' }, score: 8 } })),
                    { status: 200 });
        }));
        renderPanel();
        await screen.findByRole('alert');

        await actor.click(screen.getByRole('button', { name: 'Try again' }));

        await settled();
        expect(shownScore()).toBe(8);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

    it('warns that the ownership, notes, playthroughs and review go too', async () => {
        // All of them go with the entry — the playthroughs and review by cascade, the ownership and
        // notes because they are columns on it — so the confirmation has to name them.
        stubEntryFetch(null, 200, [playthrough({ id: 5 })]);
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));

        expect(screen.getByText(/score, list placement, ownership, notes, playthroughs\s+and review/i))
            .toBeInTheDocument();
    });

    it('offers it for a game that is only played, with no score and no list', async () => {
        stubEntryFetch(null, 200, [playthrough({ id: 5 })]);
        renderPanel();

        expect(await screen.findByRole('button', { name: /delete my data/i })).toBeInTheDocument();
    });

    it('clears the playthroughs after deleting, because they cascade', async () => {
        stubEntryFetch(null, 200, [playthrough({ id: 5, minutesPlayed: 260 })]);
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(screen.queryByText('4h 20m')).not.toBeInTheDocument());
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

    it('keeps everything on screen, and says so, when the delete fails', async () => {
        // The provider puts the lists back; the panel's own copy has to stay too, or the game reads
        // as empty until the next page load while everything is still recorded.
        stubEntryFetch(7, 200, [playthrough({ id: 5, minutesPlayed: 260 })]);
        const ctx = renderPanel({ deleteEntry: vi.fn(async () => false) });

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not delete your data/i);
        expect(shownScore()).toBe(7);
        expect(screen.getByText('4h 20m')).toBeInTheDocument();
        expect(ctx.onCommunityChange).not.toHaveBeenCalled();
    });

    it('offers the controls again once everything is deleted, even after a read that failed', async () => {
        // Nothing is recorded after a delete, which is known without reading it back.
        stubEntryFetch(null, 500);
        renderPanel({ getListFor: () => 'backlog', isInList: (id: ListId) => id === 'backlog' });
        await screen.findByRole('alert');

        await userEvent.click(screen.getByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await settled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe("GameUserPanel and the members' view of the game", () => {
    /*
     * The member score and the review list on the same page are fetched once, so a write here has to
     * say so or they go on showing the game as it was — the look of a write that failed.
     */

    it('asks for it again once a score has saved', async () => {
        stubEntryFetch(6);
        const { setScore, finish } = deferredSetScore();
        const ctx = renderPanel({ setScore });

        await waitFor(() => expect(shownScore()).toBe(6));
        await userEvent.click(screen.getByRole('radio', { name: '2 out of 10' }));

        // Not while the save is still out: the view would be fetched before the score it should show.
        expect(ctx.onCommunityChange).not.toHaveBeenCalled();

        await finish(true);

        expect(ctx.onCommunityChange).toHaveBeenCalledTimes(1);
    });

    it('leaves it alone when the score did not save', async () => {
        stubEntryFetch(6);
        const { setScore, finish } = deferredSetScore();
        const ctx = renderPanel({ setScore });

        await waitFor(() => expect(shownScore()).toBe(6));
        await userEvent.click(screen.getByRole('radio', { name: '2 out of 10' }));
        await finish(false);

        expect(ctx.onCommunityChange).not.toHaveBeenCalled();
    });

    it('asks for it again once a review has saved', async () => {
        stubEntryFetch(null, 200, [], url =>
            url.includes('/review')
                ? new Response(JSON.stringify(review({ id: 3, body: 'Superb.' })), { status: 200 })
                : new Response(null, { status: 204 }));
        const ctx = renderPanel();
        await settled();

        await userEvent.type(screen.getByLabelText('What you thought'), 'Superb.');
        await userEvent.click(screen.getByRole('button', { name: 'Save review' }));

        await waitFor(() => expect(ctx.onCommunityChange).toHaveBeenCalledTimes(1));
    });

    it('leaves it alone when the review did not save', async () => {
        stubEntryFetch(null, 200, [], () => new Response('nope', { status: 500 }));
        const ctx = renderPanel();
        await settled();

        await userEvent.type(screen.getByLabelText('What you thought'), 'Superb.');
        await userEvent.click(screen.getByRole('button', { name: 'Save review' }));

        await screen.findByRole('alert');
        expect(ctx.onCommunityChange).not.toHaveBeenCalled();
    });

    it('asks for it again once a review has been deleted', async () => {
        stubEntryFetch(
            null,
            200,
            [],
            () => new Response(null, { status: 204 }),
            review({ id: 3, body: 'On reflection, no.' }));
        const ctx = renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: 'Delete review' }));

        await waitFor(() => expect(ctx.onCommunityChange).toHaveBeenCalledTimes(1));
    });

    it('asks for it again after deleting everything recorded about the game', async () => {
        // The score and the review both go with the entry, so both halves of the view can change.
        stubEntryFetch(7);
        const ctx = renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(ctx.onCommunityChange).toHaveBeenCalledTimes(1));
        expect(ctx.deleteEntry).toHaveBeenCalledWith(1);
    });

    it('does not ask for it over a change of list, which it does not show', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Playing' }));

        expect(ctx.addToList).toHaveBeenCalled();
        expect(ctx.onCommunityChange).not.toHaveBeenCalled();
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
        // Not `settled()`: the score control stays disabled for as long as a list mutation is
        // pending, so there is nothing here that becomes enabled to wait for. The panel's own
        // entry fetch still has to land before the test ends, or React reports its state update
        // outside `act(...)` — a warning that goes on to mask real ones.
        await act(async () => {});

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

describe('GameUserPanel favourite', () => {
    it('offers to make a favourite of a game that is not one', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByRole('button', { name: 'Add to favourites' }))
            .toHaveAttribute('aria-pressed', 'false');
    });

    it('says so for a game that already is one', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, {}, 'private', { isFavourite: () => true });
        await settled();

        expect(screen.getByRole('button', { name: 'One of your favourites' }))
            .toHaveAttribute('aria-pressed', 'true');
    });

    it('passes the whole game when adding, and the id when removing', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Add to favourites' }));
        expect(ctx.favourites.add).toHaveBeenCalledWith(CELESTE);
        expect(ctx.favourites.remove).not.toHaveBeenCalled();
    });

    it('stops it being a favourite when clicked while it is one', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel({}, {}, 'private', { isFavourite: () => true });
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'One of your favourites' }));

        expect(ctx.favourites.remove).toHaveBeenCalledWith(1);
    });

    it('is its own axis: a wishlisted, listed game can be a favourite too', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel(
            { isInList: (id: ListId) => id === 'finished', getListFor: () => 'finished' },
            { isWishlisted: () => true },
            'private',
            { isFavourite: () => true },
        );
        await settled();

        expect(screen.getByRole('button', { name: 'Finished' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'On your wishlist' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'One of your favourites' })).toHaveAttribute('aria-pressed', 'true');
        expect(ctx.wishlist.remove).not.toHaveBeenCalled();
    });

    it('is disabled while its own mutation is in flight', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, {}, 'private', { isPending: () => true });
        await settled();

        expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeDisabled();
    });

    it('stays usable while the wishlist has a mutation in flight', async () => {
        // Separate pending sets, so the two toggles beside each other never block one another.
        stubEntryFetch(null, 404);
        renderPanel({}, { isPending: () => true });
        await settled();

        expect(screen.getByRole('button', { name: 'Add to wishlist' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeEnabled();
    });

    it('says the public profile shows favourites when it is public', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, {}, 'public');
        await settled();

        expect(screen.getByText(/favourites are shown on your public profile/i)).toBeInTheDocument();
    });

    it('says nobody else sees them while the profile is private', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, {}, 'private');
        await settled();

        expect(screen.getByText(/your profile is private, so nobody else sees them/i)).toBeInTheDocument();
    });

    it('explains a control stuck by a failed load, and offers a retry', async () => {
        // Favourites have no page of their own to report this on, unlike the wishlist.
        const actor = userEvent.setup();
        stubEntryFetch(null, 404);
        const ctx = renderPanel({}, {}, 'private', {
            error: 'Failed to load your favourites (500)',
            isPending: () => true,
        });
        await settled();

        expect(screen.getByRole('alert')).toHaveTextContent(/favourites could not be loaded/i);
        expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeDisabled();

        await actor.click(screen.getByRole('button', { name: 'Try again' }));
        expect(ctx.favourites.reload).toHaveBeenCalled();
    });

    it('surfaces a failed toggle', async () => {
        stubEntryFetch(null, 404);
        renderPanel({}, {}, 'private', { mutationError: 'Failed to update your favourites. Please try again.' });
        await settled();

        expect(screen.getByRole('alert')).toHaveTextContent(/failed to update your favourites/i);
    });
});

describe('GameUserPanel playthroughs', () => {
    it('lists what the entry read returned', async () => {
        stubEntryFetch(null, 200, [
            playthrough({
                id: 5,
                type: 'completionist',
                platformId: 48,
                minutesPlayed: 260,
                startedOn: '2026-05-01',
                finishedOn: '2026-06-12',
                notes: 'Every strawberry.',
            }),
        ]);
        renderPanel();

        // Scoped to the list: both labels are also options in the selects below it.
        const row = within(await screen.findByRole('list'));
        expect(row.getByText('Completionist')).toBeInTheDocument();
        expect(row.getByText('PlayStation 4')).toBeInTheDocument();
        expect(row.getByText('4h 20m')).toBeInTheDocument();
        // Case-sensitive on purpose: the finish label is lowercase here because it is the second
        // half of one sentence, and capital-cased when it stands alone. See the test below.
        expect(row.getByText('Started 1 May 2026, finished 12 June 2026')).toBeInTheDocument();
        expect(row.getByText('Every strawberry.')).toBeInTheDocument();
    });

    it('capitalises the finish date when it has no start date to follow', async () => {
        // Both dates are optional, so this row is reachable — and it renders on a line of its own,
        // where the joined sentence's lowercase "finished" would read as a typo.
        stubEntryFetch(null, 200, [
            playthrough({ id: 5, startedOn: null, finishedOn: '2026-06-12' }),
        ]);
        renderPanel();

        const row = within(await screen.findByRole('list'));
        expect(row.getByText('Finished 12 June 2026')).toBeInTheDocument();
    });

    it('says so for a platform the game does not list rather than hiding it', async () => {
        // The id is stored bare and never validated against IGDB, so it can name something this
        // game's metadata does not carry — and the user did record it.
        stubEntryFetch(null, 200, [playthrough({ id: 5, platformId: 9999 })]);
        renderPanel();

        expect(await screen.findByText('Unknown platform')).toBeInTheDocument();
    });

    it('calls an untyped playthrough in progress rather than blank', async () => {
        stubEntryFetch(null, 200, [playthrough({ id: 5, type: null })]);
        renderPanel();

        expect(await screen.findByText('In progress')).toBeInTheDocument();
    });

    it('invites a first one when there are none', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByText(/nothing logged yet/i)).toBeInTheDocument();
    });

    it('says to leave the type blank while still playing', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByText(/leave this blank while you are still playing/i))
            .toBeInTheDocument();
    });

    it('offers the game own platforms', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        const select = screen.getByLabelText('Platform');
        expect(within(select).getByRole('option', { name: 'PlayStation 4' })).toBeInTheDocument();
        expect(within(select).getByRole('option', { name: 'Not recorded' })).toBeInTheDocument();
    });

    it('logs a new one and shows it', async () => {
        const saved = playthrough({ id: 9, type: 'rushed', platformId: 6, minutesPlayed: 195 });
        const fetchMock = stubEntryFetch(null, 200, [], () =>
            new Response(JSON.stringify(saved), { status: 201 }));
        renderPanel();
        await settled();

        await userEvent.selectOptions(screen.getByLabelText('Platform'), '6');
        await userEvent.selectOptions(screen.getByLabelText('How you played it'), 'rushed');
        await userEvent.type(screen.getByLabelText('Hours'), '3');
        await userEvent.type(screen.getByLabelText('Minutes'), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(await screen.findByText('3h 15m')).toBeInTheDocument();
        // Scoped to the list: 'Rushed' is also an option in the type select above it.
        expect(within(screen.getByRole('list')).getByText('Rushed')).toBeInTheDocument();

        // Hours and minutes are two fields on screen and one number in the API.
        expect(bodyOf(fetchMock, 1)).toMatchObject({
            type: 'rushed',
            platformId: 6,
            minutesPlayed: 195,
        });
    });

    it('sends nulls rather than empty strings for the fields left blank', async () => {
        // The API range starts at one minute, so a zero would be a valid-looking value the
        // database would reject.
        const fetchMock = stubEntryFetch(null, 200, [], () =>
            new Response(JSON.stringify(playthrough({ id: 9 })), { status: 201 }));
        renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Log playthrough' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(bodyOf(fetchMock, 1)).toEqual({
            type: null,
            platformId: null,
            minutesPlayed: null,
            startedOn: null,
            finishedOn: null,
            notes: null,
        });
    });

    it('shows what the server said was wrong with it', async () => {
        stubEntryFetch(null, 200, [], () => new Response(
            JSON.stringify({
                title: 'One or more validation errors occurred.',
                errors: { FinishedOn: ['The finish date cannot be before the start date.'] },
            }),
            { status: 400 }));
        renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent(/finish date cannot be before the start date/i);
    });

    it('reports a dead API rather than clearing the form as though it saved', async () => {
        // An unreachable API makes `fetch` reject; it does not return a bad response.
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            if (String(input).includes('/playthroughs')) throw new Error('Network down');
            return new Response('not found', { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);
        renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Log playthrough' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent(/could not save your playthrough/i);
    });

    it('loads a playthrough into the form to edit it', async () => {
        stubEntryFetch(null, 200, [
            playthrough({ id: 5, type: 'completionist', platformId: 48, minutesPlayed: 260 }),
        ]);
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: 'Edit playthrough 1' }));

        expect(screen.getByLabelText('How you played it')).toHaveValue('completionist');
        expect(screen.getByLabelText('Platform')).toHaveValue('48');
        expect(screen.getByLabelText('Hours')).toHaveValue(4);
        expect(screen.getByLabelText('Minutes')).toHaveValue(20);
        expect(screen.getByRole('button', { name: 'Save playthrough' })).toBeInTheDocument();
    });

    it('replaces the row it edited rather than adding a second', async () => {
        const fetchMock = stubEntryFetch(
            null,
            200,
            [playthrough({ id: 5, type: 'rushed', minutesPlayed: 60 })],
            () => new Response(
                JSON.stringify(playthrough({ id: 5, type: 'completionist', minutesPlayed: 300 })),
                { status: 200 }));
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: 'Edit playthrough 1' }));
        await userEvent.click(screen.getByRole('button', { name: 'Save playthrough' }));

        expect(await screen.findByText('5h')).toBeInTheDocument();
        expect(screen.queryByText('1h')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit playthrough 2' })).not.toBeInTheDocument();

        // A PUT at the row's own address, not another POST.
        expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
        expect(String(fetchMock.mock.calls[1][0])).toBe('/api/entries/1/playthroughs/5');
    });

    it('backs out of an edit without saving', async () => {
        const fetchMock = stubEntryFetch(null, 200, [playthrough({ id: 5, minutesPlayed: 60 })]);
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: 'Edit playthrough 1' }));
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.getByRole('button', { name: 'Log playthrough' })).toBeInTheDocument();
        expect(screen.getByLabelText('Hours')).toHaveValue(null);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('removes a deleted row', async () => {
        const fetchMock = stubEntryFetch(
            null,
            200,
            [playthrough({ id: 5, minutesPlayed: 260 })],
            () => new Response(null, { status: 204 }));
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: 'Delete playthrough 1' }));

        await waitFor(() => expect(screen.queryByText('4h 20m')).not.toBeInTheDocument());
        expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
        expect(String(fetchMock.mock.calls[1][0])).toBe('/api/entries/1/playthroughs/5');
    });

    it('keeps the row and says so when the delete fails', async () => {
        stubEntryFetch(
            null,
            200,
            [playthrough({ id: 5, minutesPlayed: 260 })],
            () => new Response('nope', { status: 500 }));
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: 'Delete playthrough 1' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent(/could not delete that playthrough/i);
        expect(screen.getByText('4h 20m')).toBeInTheDocument();
    });
});

describe('GameUserPanel review', () => {
    it('starts empty for a game with nothing written', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByLabelText('What you thought')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Save review' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete review' })).not.toBeInTheDocument();
    });

    it('loads a review that was already written', async () => {
        stubEntryFetch(null, 200, [], undefined, review({
            body: 'The best side quests in the genre.',
            hasSpoilers: true,
            visibility: 'public',
        }));
        renderPanel();

        await waitFor(() => expect(screen.getByLabelText('What you thought'))
            .toHaveValue('The best side quests in the genre.'));
        expect(screen.getByLabelText(/contains spoilers/i)).toBeChecked();
        expect(screen.getByLabelText('Who can see it')).toHaveValue('public');
        expect(screen.getByRole('button', { name: 'Update review' })).toBeInTheDocument();
    });

    it('defaults a new review to private', async () => {
        // The default is a consent decision, so it is the one that publishes nothing.
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByLabelText('Who can see it')).toHaveValue('private');
    });

    it('tells an author with a private profile that "Anyone" publishes nothing yet', async () => {
        // The narrower gate wins, and it is the one that is easy to forget is there: a review for
        // anyone on a private profile is shown nowhere, and its author must not believe otherwise.
        stubEntryFetch(null, 404);
        renderPanel({}, {}, 'private');
        await settled();

        expect(screen.getByLabelText('Who can see it'))
            .toHaveAccessibleDescription(/once your profile is public\. Yours is private, so it is not shown anywhere yet\.$/);
    });

    it('tells an author with a public profile where "Anyone" publishes it', async () => {
        // Both places — including the game page, which a reader of their profile alone would not
        // think to expect.
        stubEntryFetch(null, 404);
        renderPanel({}, {}, 'public');
        await settled();

        expect(screen.getByLabelText('Who can see it'))
            .toHaveAccessibleDescription('"Anyone" shows it on this game\'s page and on your public profile.');
    });

    it('saves what was written', async () => {
        const fetchMock = stubEntryFetch(null, 200, [], (url) =>
            url.includes('/review')
                ? new Response(JSON.stringify(review({ id: 3, body: 'Superb.' })), { status: 200 })
                : new Response(null, { status: 204 }));
        renderPanel();
        await settled();

        await userEvent.type(screen.getByLabelText('What you thought'), 'Superb.');
        await userEvent.click(screen.getByLabelText(/contains spoilers/i));
        await userEvent.selectOptions(screen.getByLabelText('Who can see it'), 'public');
        await userEvent.click(screen.getByRole('button', { name: 'Save review' }));

        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Update review' })).toBeInTheDocument());

        // A PUT, because there is one review per game.
        expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
        expect(String(fetchMock.mock.calls[1][0])).toBe('/api/entries/1/review');
        expect(bodyOf(fetchMock, 1)).toEqual({
            body: 'Superb.',
            hasSpoilers: true,
            visibility: 'public',
            playthroughId: null,
        });
    });

    it('offers to name the playthrough it is about, once there are any', async () => {
        stubEntryFetch(null, 200, [playthrough({ id: 5, type: 'completionist' })]);
        renderPanel();

        const select = await screen.findByLabelText('About which playthrough');
        expect(within(select).getByRole('option', { name: 'The game in general' })).toBeInTheDocument();
        expect(within(select).getByRole('option', { name: '1. Completionist' })).toBeInTheDocument();
    });

    it('does not offer that select when nothing has been logged', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.queryByLabelText('About which playthrough')).not.toBeInTheDocument();
    });

    it('shows what the server said was wrong with it', async () => {
        stubEntryFetch(null, 200, [], () => new Response(
            JSON.stringify({
                title: 'One or more validation errors occurred.',
                errors: { PlaythroughId: ['That playthrough is not one of yours for this game.'] },
            }),
            { status: 400 }));
        renderPanel();
        await settled();

        await userEvent.type(screen.getByLabelText('What you thought'), 'Hmm.');
        await userEvent.click(screen.getByRole('button', { name: 'Save review' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent(/not one of yours for this game/i);
    });

    it('reports a dead API rather than looking as though it saved', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            if (String(input).includes('/review')) throw new Error('Network down');
            return new Response('not found', { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);
        renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Save review' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not save your review/i);
    });

    it('deletes it and clears the field', async () => {
        const fetchMock = stubEntryFetch(
            null,
            200,
            [],
            () => new Response(null, { status: 204 }),
            review({ id: 3, body: 'On reflection, no.' }));
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: 'Delete review' }));

        await waitFor(() => expect(screen.getByLabelText('What you thought')).toHaveValue(''));
        expect(screen.getByRole('button', { name: 'Save review' })).toBeInTheDocument();
        expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
    });

    it('offers the whole-game delete for a game that only has a review', async () => {
        stubEntryFetch(null, 200, [], undefined, review({ id: 3 }));
        renderPanel();

        expect(await screen.findByRole('button', { name: /delete my data/i })).toBeInTheDocument();
    });
});

describe('GameUserPanel ownership and notes', () => {
    /** The entry read, carrying whatever ownership and notes a test gives it. */
    function stubDetail(detail: { ownership?: 'owned' | 'subscription' | 'borrowed' | null; notes?: string | null } = {}) {
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify(entryDetail({
                entry: { game: { id: 1, title: 'Celeste' } },
                ownership: detail.ownership ?? null,
                notes: detail.notes ?? null,
            })),
            { status: 200 },
        ));
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    const notesBox = () => screen.getByLabelText('Your notes');

    it('shows how the user has the game, from the entry read', async () => {
        stubDetail({ ownership: 'subscription' });
        renderPanel();
        await settled();

        await waitFor(() => expect(screen.getByRole('button', { name: 'Subscription' }))
            .toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByRole('button', { name: 'Owned' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('marks a kind at once and saves it', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel();
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Borrowed' }));

        expect(ctx.setOwnership).toHaveBeenCalledWith(1, 'borrowed');
        expect(screen.getByRole('button', { name: 'Borrowed' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('clears it when the kind already on is pressed again', async () => {
        stubDetail({ ownership: 'owned' });
        const ctx = renderPanel();
        await settled();

        await userEvent.click(await screen.findByRole('button', { name: 'Owned', pressed: true }));

        expect(ctx.setOwnership).toHaveBeenCalledWith(1, null);
        expect(screen.getByRole('button', { name: 'Owned' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('puts the previous kind back when the save fails', async () => {
        stubDetail({ ownership: 'owned' });
        renderPanel({ setOwnership: vi.fn(async () => false) });
        await settled();
        await screen.findByRole('button', { name: 'Owned', pressed: true });

        await userEvent.click(screen.getByRole('button', { name: 'Subscription' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Owned' }))
            .toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByRole('button', { name: 'Subscription' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers no ownership change while another write to the entry is out', async () => {
        stubEntryFetch(null, 404);
        renderPanel({ isPending: () => true });
        await act(async () => {});

        expect(screen.getByRole('button', { name: 'Owned' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled();
    });

    it('loads the notes into the box, with nothing to save until they change', async () => {
        stubDetail({ notes: 'Save is on the old laptop.' });
        renderPanel();
        await settled();

        await waitFor(() => expect(notesBox()).toHaveValue('Save is on the old laptop.'));
        expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled();
    });

    it('says the notes are private', async () => {
        stubEntryFetch(null, 404);
        renderPanel();
        await settled();

        expect(screen.getByText(/only you can see these/i)).toBeInTheDocument();
    });

    it('saves the notes trimmed', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel();
        await settled();

        await userEvent.type(notesBox(), '  Try the hard mode.  ');
        await userEvent.click(screen.getByRole('button', { name: 'Save notes' }));

        expect(ctx.setNotes).toHaveBeenCalledWith(1, 'Try the hard mode.');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled());
    });

    it('clears the notes when the box is emptied and saved', async () => {
        stubDetail({ notes: 'Old thought.' });
        const ctx = renderPanel();
        await settled();
        await waitFor(() => expect(notesBox()).toHaveValue('Old thought.'));

        await userEvent.clear(notesBox());
        await userEvent.click(screen.getByRole('button', { name: 'Clear notes' }));

        expect(ctx.setNotes).toHaveBeenCalledWith(1, null);
    });

    it('keeps what was typed and says so when the notes do not save', async () => {
        stubEntryFetch(null, 404);
        renderPanel({ setNotes: vi.fn(async () => false) });
        await settled();

        await userEvent.type(notesBox(), 'Worth keeping.');
        await userEvent.click(screen.getByRole('button', { name: 'Save notes' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not save your notes/i);
        expect(notesBox()).toHaveValue('Worth keeping.');
    });

    it('offers to delete a game that has only ownership and notes', async () => {
        // Both live on the entry, so the one control that erases the entry has to be there.
        stubDetail({ ownership: 'borrowed', notes: 'Return it.' });
        renderPanel();

        expect(await screen.findByRole('button', { name: /delete my data/i })).toBeInTheDocument();
    });

    it('clears both after deleting everything', async () => {
        stubDetail({ ownership: 'borrowed', notes: 'Return it.' });
        renderPanel();

        await userEvent.click(await screen.findByRole('button', { name: /delete my data/i }));
        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(notesBox()).toHaveValue(''));
        expect(screen.getByRole('button', { name: 'Borrowed' })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('GameUserPanel and renamed lists', () => {
    it('labels the list buttons with the names their owner gave them', async () => {
        stubEntryFetch(null, 404);
        const ctx = renderPanel({ nameFor: (id: ListId) => (id === 'backlog' ? 'Pile of Shame' : LIST_NAMES[id]) });
        await settled();

        await userEvent.click(screen.getByRole('button', { name: 'Pile of Shame' }));

        // The label is the user's; what is sent is still the permanent key.
        expect(ctx.addToList).toHaveBeenCalledWith('backlog', CELESTE);
    });
});
