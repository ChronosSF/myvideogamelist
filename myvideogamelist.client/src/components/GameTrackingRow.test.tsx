import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GameTrackingRow } from '@/components/GameTrackingRow';
import { AuthDialogContext, type AuthDialogContextValue } from '@/contexts/AuthDialogContext';
import { GameEntryContext, type GameEntryContextValue } from '@/contexts/GameEntryContext';
import { ListsContext, type ListsContextValue } from '@/contexts/ListsContext';
import { LIST_NAMES, type ListId } from '@/types/list';
import { quickActor } from '@/test/actor';
import { game, playthrough, review } from '@/test/factories';

/**
 * The reader's controls in the game page's hero (ADR 0084), in its three states: auth not answered,
 * signed out, and signed in with an entry. The contexts are provided directly, each value a module-level
 * object, so that no render hands the row a fresh one.
 */

const GAME = game({ id: 1942, title: 'The Witcher 3: Wild Hunt' });

const dialog: AuthDialogContextValue = { open: vi.fn() };

/** The lists, as far as the row reads them: the reader's names for each, and whether they loaded. */
const listsValue = (overrides: Partial<ListsContextValue> = {}) => ({
    nameFor: (id: ListId) => LIST_NAMES[id],
    error: null,
    reload: vi.fn(),
    ...overrides,
}) as unknown as ListsContextValue;
const lists = listsValue();

/**
 * The provider's value with nothing recorded and nothing out, every write a mock. Built afresh per test;
 * a test changes it before rendering, never between renders.
 */
function entryValue(overrides: Partial<GameEntryContextValue> = {}): GameEntryContextValue {
    return {
        game: GAME,
        profileVisibility: 'private',
        entryStatus: 'ready',
        ready: true,
        retryEntry: vi.fn(),
        pending: false,
        hasData: false,
        currentList: null,
        listsKnown: true,
        moveTo: vi.fn(async () => {}),
        takeOut: vi.fn(async () => {}),
        listError: null,
        score: null,
        changeScore: vi.fn(async () => {}),
        scoreError: null,
        wishlisted: false,
        wishlistPending: false,
        toggleWishlist: vi.fn(async () => {}),
        wishlistError: null,
        favourite: false,
        favouritePending: false,
        toggleFavourite: vi.fn(async () => {}),
        favouritesFailed: false,
        reloadFavourites: vi.fn(),
        favouriteError: null,
        ownership: null,
        changeOwnership: vi.fn(async () => {}),
        ownershipError: null,
        tags: [],
        vocabulary: [],
        tagsStatus: 'ready',
        reloadTags: vi.fn(),
        addTag: vi.fn(),
        removeTag: vi.fn(),
        createTag: vi.fn(async () => true),
        tagsError: null,
        notes: null,
        saveNotes: vi.fn(async () => {}),
        savingNotes: false,
        notesError: null,
        playthroughs: [],
        editing: null,
        setEditing: vi.fn(),
        savePlaythrough: vi.fn(async () => true),
        savingPlaythrough: false,
        deletePlaythrough: vi.fn(async () => {}),
        deletingPlaythroughId: null,
        playthroughError: null,
        review: null,
        saveReview: vi.fn(async () => {}),
        deleteReview: vi.fn(async () => {}),
        savingReview: false,
        reviewError: null,
        deleteAll: vi.fn(async () => true),
        deleteError: null,
        ...overrides,
    };
}

function renderRow({ authLoading = false, linkToYours = true, entry = null, listsContext = lists }: {
    authLoading?: boolean;
    linkToYours?: boolean;
    entry?: GameEntryContextValue | null;
    listsContext?: ListsContextValue;
} = {}) {
    return render(
        <MemoryRouter>
            <AuthDialogContext.Provider value={dialog}>
                <ListsContext.Provider value={listsContext}>
                    <GameEntryContext.Provider value={entry}>
                        <GameTrackingRow game={GAME} authLoading={authLoading} linkToYours={linkToYours} />
                    </GameEntryContext.Provider>
                </ListsContext.Provider>
            </AuthDialogContext.Provider>
        </MemoryRouter>,
    );
}

/** The Backlog button, by its accessible name: "Add to" and the list's name, which is what it shows. */
const addTo = (list: string) => screen.getByRole('button', { name: `Add to ${list}` });
const stars = () => screen.getByRole('group', { name: 'Your score for The Witcher 3: Wild Hunt' });

beforeEach(() => {
    dialog.open = vi.fn();
    lists.nameFor = (id: ListId) => LIST_NAMES[id];
});

describe('GameTrackingRow, before auth has answered', () => {
    it('draws every control, and lets none be used', () => {
        renderRow({ authLoading: true });

        expect(addTo('Backlog')).toBeDisabled();
        expect(screen.getByRole('combobox', { name: 'Add to another list' })).toBeDisabled();
        expect(stars()).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add to wishlist' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeDisabled();
    });

    it('says nothing yet about signing in, since it does not know who is reading', () => {
        renderRow({ authLoading: true });

        expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
        expect(screen.queryByText(/to keep this game in your lists/)).not.toBeInTheDocument();
    });
});

describe('GameTrackingRow, signed out', () => {
    it('asks the reader to sign in, under the row', async () => {
        const actor = quickActor();
        renderRow();

        const signIn = screen.getByRole('button', { name: 'Sign in' });
        expect(signIn.parentElement).toHaveTextContent('Sign in to keep this game in your lists, score it and wish for it.');

        await actor.click(signIn);

        expect(dialog.open).toHaveBeenCalledWith('login');
    });

    it('asks the reader to sign in from the Backlog, the heart and the rosette', async () => {
        const actor = quickActor();
        renderRow();

        await actor.click(addTo('Backlog'));
        await actor.click(screen.getByRole('button', { name: 'Add to wishlist' }));
        await actor.click(screen.getByRole('button', { name: 'Add to favourites' }));

        expect(vi.mocked(dialog.open).mock.calls).toEqual([['login'], ['login'], ['login']]);
    });

    it('asks the reader to sign in from a star too, and gives no score meanwhile', async () => {
        const actor = quickActor();
        renderRow();

        expect(stars()).toBeEnabled();
        await actor.click(within(stars()).getAllByRole('radio')[7]);

        expect(dialog.open).toHaveBeenCalledWith('login');
        expect(within(stars()).getAllByRole('radio').filter(radio => (radio as HTMLInputElement).checked)).toHaveLength(0);
    });

    it('keeps the other lists for after signing in', () => {
        renderRow();

        expect(screen.getByRole('combobox', { name: 'Add to another list' })).toBeDisabled();
    });

    it('says nothing about a profile beside the rosette, since nobody is signed in to have one', () => {
        renderRow();

        expect(screen.getByRole('button', { name: 'Add to favourites' })).not.toHaveAccessibleDescription(/profile/);
    });

    it('calls the Backlog what the lists call it', () => {
        lists.nameFor = (id: ListId) => (id === 'backlog' ? 'Up Next' : LIST_NAMES[id]);
        renderRow();

        expect(addTo('Up Next')).toBeEnabled();
    });
});

describe('GameTrackingRow, signed in', () => {
    it('shows the list the game is in, and moves it or takes it out', async () => {
        const actor = quickActor();
        const entry = entryValue({ currentList: 'playing' });
        renderRow({ entry });

        const select = screen.getByRole('combobox', { name: 'Your list' });
        expect(select).toHaveValue('playing');

        await actor.selectOptions(select, 'Finished');
        expect(entry.moveTo).toHaveBeenCalledWith('finished');

        await actor.selectOptions(select, 'Take out of Playing');
        expect(entry.takeOut).toHaveBeenCalledTimes(1);
    });

    it('puts a game in no list in the Backlog, rather than asking anybody to sign in', async () => {
        const actor = quickActor();
        const entry = entryValue();
        renderRow({ entry });

        await actor.click(addTo('Backlog'));

        expect(entry.moveTo).toHaveBeenCalledWith('backlog');
        expect(dialog.open).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    });

    it('scores it, and toggles the wishlist and the favourite', async () => {
        const actor = quickActor();
        const entry = entryValue();
        renderRow({ entry });

        await actor.click(screen.getByRole('radio', { name: '8 out of 10' }));
        await actor.click(screen.getByRole('button', { name: 'Add to wishlist' }));
        await actor.click(screen.getByRole('button', { name: 'Add to favourites' }));

        expect(entry.changeScore).toHaveBeenCalledWith(8);
        expect(entry.toggleWishlist).toHaveBeenCalledTimes(1);
        expect(entry.toggleFavourite).toHaveBeenCalledTimes(1);
        expect(dialog.open).not.toHaveBeenCalled();
    });

    it('shows the wishlist and the favourite as pressed once they are', () => {
        renderRow({ entry: entryValue({ wishlisted: true, favourite: true }) });

        expect(screen.getByRole('button', { name: 'On your wishlist' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'One of your favourites' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('holds the list and the stars while a write to the entry is out, and the stars until it is read', () => {
        const { unmount } = renderRow({ entry: entryValue({ currentList: 'backlog', pending: true }) });
        expect(screen.getByRole('combobox', { name: 'Your list' })).toBeDisabled();
        expect(stars()).toBeDisabled();
        unmount();

        renderRow({ entry: entryValue({ ready: false, entryStatus: 'loading' }) });
        expect(stars()).toBeDisabled();
        expect(addTo('Backlog')).toBeEnabled();
    });

    it('says nothing of the playthroughs and the review until the entry has been read', () => {
        renderRow({ entry: entryValue({ ready: false, entryStatus: 'loading', playthroughs: [] }), linkToYours: true });

        expect(screen.queryByText(/No playthroughs or review yet/)).not.toBeInTheDocument();
        // The way to the tab is offered all the same.
        expect(screen.getByRole('link', { name: 'Your game' })).toHaveAttribute('href', '/games/1942/yours');
    });

    it('holds the heart while its change is out, and the rosette while its change is out or the favourites are unknown', () => {
        const { unmount } = renderRow({ entry: entryValue({ wishlistPending: true, favouritePending: true }) });
        expect(screen.getByRole('button', { name: 'Add to wishlist' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeDisabled();
        unmount();

        renderRow({ entry: entryValue({ favouritesFailed: true }) });
        expect(screen.getByRole('button', { name: 'Add to wishlist' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeDisabled();
    });

    it('says what else is recorded, with the way to the Your game tab', () => {
        renderRow({ entry: entryValue({ playthroughs: [playthrough()], review: review({ visibility: 'public' }) }) });

        const yours = screen.getByRole('link', { name: 'Your game' });
        expect(yours).toHaveAttribute('href', '/games/1942/yours');
        expect(yours.parentElement).toHaveTextContent('1 playthrough · Reviewed, for anyone · Your game');
    });

    it('counts the runs, says who a review is for, and mentions notes', () => {
        renderRow({
            entry: entryValue({
                playthroughs: [playthrough({ id: 1 }), playthrough({ id: 2 })],
                review: review({ visibility: 'private' }),
                notes: 'Went Team Yen.',
            }),
        });

        expect(screen.getByRole('link', { name: 'Your game' }).parentElement)
            .toHaveTextContent('2 playthroughs · Reviewed, for you only · Notes · Your game');
    });

    it('says when nothing else is recorded, and has no link to the tab it is already on', () => {
        renderRow({ entry: entryValue(), linkToYours: false });

        expect(screen.getByText('No playthroughs or review yet')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Your game' })).not.toBeInTheDocument();
    });

    it('shows each refusal where the reader is looking', () => {
        renderRow({
            entry: entryValue({
                listError: 'Could not move it to Finished.',
                scoreError: 'Could not save your score.',
                wishlistError: 'Could not update your wishlist.',
                favouriteError: 'Could not update your favourites.',
            }),
        });

        expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([
            'Could not move it to Finished.',
            'Could not save your score.',
            'Could not update your wishlist.',
            'Could not update your favourites.',
        ]);
    });

    it('offers no list while the lists are unknown, since a game in one reads as in none until they come', () => {
        renderRow({ entry: entryValue({ listsKnown: false }) });

        expect(addTo('Backlog')).toBeDisabled();
        expect(screen.getByLabelText('Add to another list')).toBeDisabled();
    });

    it('says the lists could not be loaded, with a way to try again', async () => {
        const actor = quickActor();
        const listsContext = listsValue({ error: 'Failed to load lists.' });
        renderRow({ entry: entryValue({ listsKnown: false }), listsContext });

        expect(screen.getByRole('alert')).toHaveTextContent('Your lists could not be loaded, so this game cannot be moved between them just now.');

        await actor.click(screen.getByRole('button', { name: 'Try again' }));
        expect(listsContext.reload).toHaveBeenCalledTimes(1);
    });

    it('says why the rosette is stuck when the favourites could not be loaded, with a way to try again', async () => {
        const actor = quickActor();
        const entry = entryValue({ favouritesFailed: true });
        renderRow({ entry });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Your favourites could not be loaded, so this cannot be changed just now.');

        await actor.click(screen.getByRole('button', { name: 'Try again' }));
        expect(entry.reloadFavourites).toHaveBeenCalledTimes(1);
    });

    it('says the entry could not be read, beside the controls rather than instead of them, with a way to try again', async () => {
        const actor = quickActor();
        const entry = entryValue({ entryStatus: 'failed', ready: false });
        renderRow({ entry });

        expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded, so they cannot be changed just now.');
        expect(stars()).toBeDisabled();
        // Nor does the line above it claim there is nothing: it does not know.
        expect(screen.queryByText(/No playthroughs or review yet/)).not.toBeInTheDocument();

        await actor.click(screen.getByRole('button', { name: 'Try again' }));
        expect(entry.retryEntry).toHaveBeenCalledTimes(1);
    });

    it('tells a reader with a public profile that favourites are shown on it', () => {
        renderRow({ entry: entryValue({ profileVisibility: 'public' }) });

        expect(screen.getByRole('button', { name: 'Add to favourites' }))
            .toHaveAccessibleDescription('Favourites are shown on your public profile.');
    });

    it('tells a reader with a private profile that nobody else sees them', () => {
        renderRow({ entry: entryValue({ profileVisibility: 'private' }) });

        expect(screen.getByRole('button', { name: 'Add to favourites' }))
            .toHaveAccessibleDescription('Shown on your own profile page. Your profile is private, so nobody else sees them.');
    });
});
