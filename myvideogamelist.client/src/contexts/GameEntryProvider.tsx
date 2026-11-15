import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ProfileVisibility } from '@/types/auth';
import type { GameDto } from '@/types/game';
import type { ListId, Ownership } from '@/types/list';
import type {
    EntryDetailDto,
    PlaythroughDto,
    PlaythroughInputDto,
    ReviewDto,
    ReviewInputDto,
} from '@/types/playthrough';
import { useLists } from '@/hooks/useLists';
import { useListPending } from '@/hooks/useListPending';
import { useWishlist } from '@/hooks/useWishlist';
import { useFavourites } from '@/hooks/useFavourites';
import { useTags } from '@/hooks/useTags';
import { type TagDto, tagsFor } from '@/types/tag';
import { apiFetch } from '@/lib/api';
import { type EntryStatus, GameEntryContext, type GameEntryContextValue } from '@/contexts/GameEntryContext';

interface GameEntryProviderProps {
    game: GameDto;
    /**
     * Whether the signed-in user's profile is public, which decides what marking their review for
     * anyone actually publishes. Passed in by the page, which already reads the account.
     */
    profileVisibility: ProfileVisibility;
    /**
     * Called after a write that the members' view of this game shows — a score, a review, or
     * deleting the lot — so the page can ask for that view again. Without it the member score and
     * the review list go on showing the game as it was, which reads as the write having failed.
     */
    onCommunityChange: () => void;
    children: ReactNode;
}

/**
 * Everything this user has recorded about one game, in one place: which list it is in, their score,
 * whether they want it and love it, how they have it, their tags, notes, playthroughs and review, and
 * a single way to erase the lot. The game page's tracking row in the hero and its Your game tab are
 * both drawn from it (ADR 0084), so a score changed in one and a delete in the other agree.
 *
 * It exists because those things are independent. Moving a game between lists, or taking it out of
 * all of them, leaves the score alone — so there has to be somewhere that shows what is actually held
 * and one deliberate way to discard it.
 *
 * The playthrough writes are plain submits with a pending state and an inline error — no optimistic
 * update, and nothing touching `ListsProvider`. Optimism pays for itself on a status toggle, where the
 * change is one field and the gesture has to feel instant; a seven-field form has nothing to gain from
 * showing a row that may be about to vanish, and everything to lose from the user editing it while it
 * does.
 *
 * **Mounted per game and per account**, by the key the page gives it: every write here settles after
 * it was made, and the page stays mounted when a link goes from one game to the next. A provider that
 * outlived its game would write the first game's saved value, or its error, into the second game's
 * form — and a marker kept in a ref cannot close that window, because writing it from an effect lags
 * the commit, which is the same trap ADR 0022 records for the account. Unmounting is the one guard
 * React applies during the commit itself. The page keeps the Overview tab outside it, so that the
 * remount when auth answers costs only the hero.
 */
export function GameEntryProvider({ game, profileVisibility, onCommunityChange, children }: GameEntryProviderProps) {
    const {
        getListFor, addToList, removeFromList, setScore, setOwnership, setNotes, setTags, deleteEntry,
        nameFor, loading: listsLoading, error: listsError,
    } = useLists();
    const listPending = useListPending(game.id);
    const wishlist = useWishlist();
    const favourites = useFavourites();
    const tags = useTags();

    // The provider only knows about games that are in a list. A game that was scored and then
    // taken out of every list still has an entry, so this asks for it directly — and that read
    // carries the playthroughs and the review too.
    const [score, setLocalScore] = useState<number | null>(null);
    const [ownership, setLocalOwnership] = useState<Ownership | null>(null);
    const [notes, setLocalNotes] = useState<string | null>(null);
    // Ids, as the entry carries them; the names are the account's tags, from `useTags`.
    const [tagIds, setLocalTagIds] = useState<number[]>([]);
    const [playthroughs, setPlaythroughs] = useState<PlaythroughDto[]>([]);
    const [review, setReview] = useState<ReviewDto | null>(null);
    const [entryStatus, setEntryStatus] = useState<EntryStatus>('loading');
    // Bumped by "Try again", which is what re-runs the read.
    const [entryAttempt, setEntryAttempt] = useState(0);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const [editing, setEditing] = useState<PlaythroughDto | null>(null);
    const [savingPlaythrough, setSavingPlaythrough] = useState(false);
    const [deletingPlaythroughId, setDeletingPlaythroughId] = useState<number | null>(null);
    const [playthroughError, setPlaythroughError] = useState<string | null>(null);

    const [savingReview, setSavingReview] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);

    const [savingNotes, setSavingNotes] = useState(false);
    const [notesError, setNotesError] = useState<string | null>(null);

    const [ownershipError, setOwnershipError] = useState<string | null>(null);

    const [tagsError, setTagsError] = useState<string | null>(null);
    /**
     * A tag being made for this game. Two requests — the tag, then the game's set — and the second runs
     * from the first one's continuation, so for the time between them this treats the game as locked:
     * its own controls are the only other writers of this entry, and holding them off is what keeps the
     * set-write from overlapping a move or a score of the same game.
     */
    const [creatingTag, setCreatingTag] = useState(false);

    /**
     * Whether this is still mounted. The page keys it per game and per account, so a tag still being
     * made when the reader leaves must not go on to write the set for a game nobody is looking at,
     * under whatever cookie is current by then.
     */
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const currentList = getListFor(game.id);
    // Until the lists have loaded, a game in Finished reads as in none, so the list it is in is not known
    // and nothing may be decided from it (`addToList`).
    const listsKnown = !listsLoading && listsError === null;
    const pending = listPending || creatingTag;
    const wishlisted = wishlist.isWishlisted(game.id);
    const favourite = favourites.isFavourite(game.id);
    const ready = entryStatus === 'ready';

    // A list move or a score the API refused. The provider puts either back itself, which on its own
    // reads as a choice that did not register, and says why only on the lists page.
    const [listError, setListError] = useState<string | null>(null);
    const [scoreError, setScoreError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        fetch(`/api/entries/${game.id}`, { credentials: 'include', signal: controller.signal })
            .then(res => {
                // A 404 is the normal case, a game the user has never touched, and it is an empty
                // entry. Any other refusal is a read that failed, which is not the same thing.
                if (res.status === 404) return null;
                if (!res.ok) throw new Error(`Failed to load the entry (${res.status})`);
                return res.json() as Promise<EntryDetailDto>;
            })
            .then(detail => {
                if (controller.signal.aborted) return;
                setLocalScore(detail?.entry.score ?? null);
                setLocalOwnership(detail?.ownership ?? null);
                setLocalNotes(detail?.notes ?? null);
                setLocalTagIds(detail?.entry.tagIds ?? []);
                setPlaythroughs(detail?.playthroughs ?? []);
                setReview(detail?.review ?? null);
                setEntryStatus('ready');
            })
            .catch(() => {
                // Including the rejection an unreachable API gives, which no status check sees. The
                // lists, wishlist and favourite do not come from this read and stay usable.
                if (!controller.signal.aborted) setEntryStatus('failed');
            });

        return () => controller.abort();
    }, [game.id, entryAttempt]);

    // A tag on this game that the account's tags do not know was made after they were read — in another
    // tab. Asked for again once, so its chip can be drawn; never more than once a mount, because a read
    // that still lacks it would otherwise be asked for for ever.
    const { reload: reloadTags } = tags;
    const unknownTag = ready && tags.status === 'ready' && tagIds.some(id => !tags.byId.has(id));
    const resyncedTags = useRef(false);
    useEffect(() => {
        if (!unknownTag || resyncedTags.current) return;
        resyncedTags.current = true;
        reloadTags();
    }, [unknownTag, reloadTags]);

    /** From the click rather than the effect, which may not set state synchronously. */
    const retryEntry = () => {
        setEntryStatus('loading');
        setEntryAttempt(attempt => attempt + 1);
    };

    const changeScore = async (next: number | null) => {
        const previous = score;
        setLocalScore(next);
        setScoreError(null);
        const saved = await setScore(game.id, next);
        if (saved) {
            onCommunityChange();
        } else {
            setLocalScore(previous);
            setScoreError('Could not save your score. Please try again.');
        }
    };

    /**
     * Shown at once, and put back with a message if the save fails, as the score is: a toggle that
     * goes back on its own reads as a click that did not register.
     * The provider takes the per-game lock, so no other write to this entry can be out at the time.
     */
    const changeOwnership = async (next: Ownership | null) => {
        const previous = ownership;
        setLocalOwnership(next);
        setOwnershipError(null);

        if (!await setOwnership(game.id, next)) {
            setLocalOwnership(previous);
            setOwnershipError('Could not save how you have this game. Please try again.');
        }
    };

    /**
     * Shown at once and put back if the save fails, as the ownership is. The set sent keeps every id
     * the entry carries, including one this tab's list of tags does not know yet — made in another tab —
     * so a change here never takes off a tag it could not show.
     */
    const saveTags = async (next: number[]): Promise<boolean> => {
        const previous = tagIds;
        setLocalTagIds(next);
        setTagsError(null);

        const saved = await setTags(game.id, next);
        if (!saved.ok) {
            // The server's own sentence where it gave one — a tag deleted in another tab says to reload —
            // and the provider's otherwise.
            setLocalTagIds(previous);
            setTagsError(saved.error);
            return false;
        }

        tags.adjustCounts(previous, next);
        return true;
    };

    const addTag = (tag: TagDto) => {
        if (!tagIds.includes(tag.id)) void saveTags([...tagIds, tag.id]);
    };

    const removeTag = (tag: TagDto) => {
        void saveTags(tagIds.filter(id => id !== tag.id));
    };

    /**
     * Not optimistic for the tag itself, which has no id until the server gives it one. Answers whether
     * the game now carries it, so the editor clears its box only for a name that landed.
     */
    const createTag = async (name: string): Promise<boolean> => {
        setCreatingTag(true);
        setTagsError(null);

        const created = await tags.createTag(name);
        if (!mounted.current) return false;

        if (!created.ok) {
            setCreatingTag(false);
            setTagsError(created.error);
            return false;
        }

        // Released in the same update that takes the provider's lock below, so no frame is painted between
        // the two with this game unlocked: the lock reaches this component as that update's commit is laid
        // out, before the browser draws it (`useListPending`). A name the game already carries — this tab's
        // list was out of date — is nothing to write.
        setCreatingTag(false);
        if (tagIds.includes(created.tag.id)) return true;
        return saveTags([...tagIds, created.tag.id]);
    };

    /** Not optimistic: the box keeps what was typed until the server has it, as the review does. */
    const saveNotes = async (next: string | null) => {
        setSavingNotes(true);
        setNotesError(null);

        const saved = await setNotes(game.id, next);

        if (saved) setLocalNotes(next);
        else setNotesError('Could not save your notes. Please try again.');
        setSavingNotes(false);
    };

    const deleteAll = async (): Promise<boolean> => {
        // Another write to this entry is out — or a tag is being made, which the provider's own lock does
        // not see. A delete now could land before that write, which would then bring the entry back.
        if (pending) return false;

        setDeleteError(null);

        const deleted = await deleteEntry(game.id);

        // Everything is still recorded, so everything stays on screen. Cleared anyway, the page would
        // show an empty game until the next page load, and saving from it would write over what is
        // still there.
        if (!deleted) {
            setDeleteError('Could not delete your data for this game. Please try again.');
            return false;
        }

        setLocalScore(null);
        setLocalOwnership(null);
        setLocalNotes(null);
        setListError(null);
        setScoreError(null);

        // The links go with the entry, so the games each tag is on are one fewer.
        tags.adjustCounts(tagIds, []);
        setLocalTagIds([]);

        // The playthroughs and the review go with the entry — the composite foreign key cascades
        // both — so the page must not go on showing what the server has just discarded.
        setPlaythroughs([]);
        setReview(null);
        setEditing(null);

        // Nothing is recorded now, which is known without asking — even after a read that failed.
        setEntryStatus('ready');
        onCommunityChange();
        return true;
    };

    /**
     * Logs a new playthrough, or saves an edit to one.
     *
     * `catch` rather than only `!res.ok`, because an unreachable API makes `fetch` reject rather
     * than return a bad response — without it the form would clear as though it had saved.
     */
    const savePlaythrough = async (input: PlaythroughInputDto): Promise<boolean> => {
        setSavingPlaythrough(true);
        setPlaythroughError(null);

        const editingId = editing?.id ?? null;
        const url = editingId === null
            ? `/api/entries/${game.id}/playthroughs`
            : `/api/entries/${game.id}/playthroughs/${editingId}`;

        try {
            const res = await apiFetch(url, {
                method: editingId === null ? 'POST' : 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (!res.ok) {
                setPlaythroughError(await problemMessage(res, 'save'));
                return false;
            }

            const saved = (await res.json()) as PlaythroughDto;
            setPlaythroughs(current => sorted(editingId === null
                ? [...current, saved]
                : current.map(p => (p.id === editingId ? saved : p))));
            setEditing(null);
            return true;
        } catch {
            setPlaythroughError('Could not save your playthrough. Please try again.');
            return false;
        } finally {
            setSavingPlaythrough(false);
        }
    };

    const deletePlaythrough = async (playthrough: PlaythroughDto) => {
        setDeletingPlaythroughId(playthrough.id);
        setPlaythroughError(null);

        try {
            const res = await apiFetch(
                `/api/entries/${game.id}/playthroughs/${playthrough.id}`,
                { method: 'DELETE' },
            );

            if (!res.ok) {
                setPlaythroughError(await problemMessage(res, 'delete'));
                return;
            }

            setPlaythroughs(current => current.filter(p => p.id !== playthrough.id));
            if (editing?.id === playthrough.id) setEditing(null);
        } catch {
            setPlaythroughError('Could not delete that playthrough. Please try again.');
        } finally {
            setDeletingPlaythroughId(null);
        }
    };

    const saveReview = async (input: ReviewInputDto) => {
        setSavingReview(true);
        setReviewError(null);

        try {
            // A PUT, not a POST: there is one review per game, so writing a second replaces the
            // first rather than adding one.
            const res = await apiFetch(`/api/entries/${game.id}/review`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (!res.ok) {
                setReviewError(await problemMessage(res, 'saveReview'));
                return;
            }

            setReview((await res.json()) as ReviewDto);
            onCommunityChange();
        } catch {
            setReviewError('Could not save your review. Please try again.');
        } finally {
            setSavingReview(false);
        }
    };

    const deleteReview = async () => {
        setSavingReview(true);
        setReviewError(null);

        try {
            const res = await apiFetch(`/api/entries/${game.id}/review`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                setReviewError(await problemMessage(res, 'deleteReview'));
                return;
            }

            setReview(null);
            onCommunityChange();
        } catch {
            setReviewError('Could not delete your review. Please try again.');
        } finally {
            setSavingReview(false);
        }
    };

    /** Opening or closing a run's form takes down what the last save of it said, which was about that form. */
    const editPlaythrough = (playthrough: PlaythroughDto | null) => {
        setPlaythroughError(null);
        setEditing(playthrough);
    };

    const toggleWishlist = async () => {
        if (wishlisted) await wishlist.remove(game.id);
        else await wishlist.add(game);
    };

    const toggleFavourite = async () => {
        if (favourite) await favourites.remove(game.id);
        else await favourites.add(game);
    };

    const moveTo = async (listId: ListId) => {
        if (!listsKnown || pending || currentList === listId) return;
        // The last refusal comes down as this one goes out, so a second is a new alert.
        setListError(null);
        if (!await addToList(listId, game)) {
            setListError(`Could not move this game to ${nameFor(listId)}. Please try again.`);
        }
    };

    const takeOut = async () => {
        if (!listsKnown || pending || currentList === null) return;
        const from = currentList;
        setListError(null);
        if (!await removeFromList(from, game.id)) {
            setListError(`Could not take this game out of ${nameFor(from)}. Please try again.`);
        }
    };

    const hasData = currentList !== null
        || score !== null
        || ownership !== null
        || notes !== null
        || tagIds.length > 0
        || playthroughs.length > 0
        || review !== null;

    const value: GameEntryContextValue = {
        game,
        profileVisibility,
        entryStatus,
        ready,
        retryEntry,
        pending,
        hasData,

        currentList,
        listsKnown,
        moveTo,
        takeOut,
        listError,

        score,
        changeScore,
        scoreError,

        wishlisted,
        wishlistPending: wishlist.isPending(game.id),
        toggleWishlist,
        // The mutation error, not the load error: a wishlist that failed to load is a whole-page
        // condition, and this is about one game.
        wishlistError: wishlist.mutationError,

        favourite,
        favouritePending: favourites.isPending(game.id),
        toggleFavourite,
        favouritesFailed: favourites.error !== null,
        reloadFavourites: favourites.reload,
        favouriteError: favourites.mutationError,

        ownership,
        changeOwnership,
        ownershipError,

        tags: tagsFor(tagIds, tags.byId),
        vocabulary: tags.tags,
        tagsStatus: tags.status,
        reloadTags,
        addTag,
        removeTag,
        createTag,
        tagsError,

        notes,
        saveNotes,
        savingNotes,
        notesError,

        playthroughs,
        editing,
        setEditing: editPlaythrough,
        savePlaythrough,
        savingPlaythrough,
        deletePlaythrough,
        deletingPlaythroughId,
        playthroughError,

        review,
        saveReview,
        deleteReview,
        savingReview,
        reviewError,

        deleteAll,
        deleteError,
    };

    return <GameEntryContext.Provider value={value}>{children}</GameEntryContext.Provider>;
}

/**
 * The same order the server reads them back in: by start date, then by when they were logged.
 *
 * Applied after every write rather than appending, because a run logged today with last year's
 * start date belongs in the middle. Appending would put it at the bottom until the next page
 * load moved it, which reads as the list having reshuffled itself.
 */
function sorted(playthroughs: PlaythroughDto[]): PlaythroughDto[] {
    return [...playthroughs].sort((a, b) =>
        compare(a.startedOn, b.startedOn)
        || compare(a.createdAt, b.createdAt)
        || a.id - b.id);
}

/** Nulls first, matching the server, and ISO strings compare correctly as strings. */
function compare(a: string | null, b: string | null): number {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : 1;
}

const FALLBACKS: Record<'save' | 'delete' | 'saveReview' | 'deleteReview', (status: number) => string> = {
    save: status => `Could not save your playthrough (${status}).`,
    delete: status => `Could not delete that playthrough (${status}).`,
    saveReview: status => `Could not save your review (${status}).`,
    deleteReview: status => `Could not delete your review (${status}).`,
};

/**
 * What the server said went wrong, as one sentence.
 *
 * ASP.NET returns a `ValidationProblemDetails` for a 400, whose `errors` carry the message the
 * user actually needs — "The finish date cannot be before the start date" beats "Could not save
 * your playthrough". Falls back to something plain rather than throwing on a body that is not
 * JSON at all, which is what a 500 or a proxy error looks like.
 */
async function problemMessage(
    response: Response,
    verb: 'save' | 'delete' | 'saveReview' | 'deleteReview',
): Promise<string> {
    const fallback = FALLBACKS[verb](response.status);

    try {
        const problem = (await response.json()) as {
            title?: string;
            detail?: string;
            errors?: Record<string, string[]>;
        };

        const firstFieldError = Object.values(problem.errors ?? {}).flat()[0];
        return firstFieldError ?? problem.detail ?? problem.title ?? fallback;
    } catch {
        return fallback;
    }
}
