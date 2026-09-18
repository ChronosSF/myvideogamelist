import { useEffect, useId, useState } from 'react';
import type { ProfileVisibility } from '@/types/auth';
import type { GameDto } from '@/types/game';
import { type ListId, type Ownership, LIST_IDS, OWNERSHIPS, OWNERSHIP_NAMES } from '@/types/list';
import type {
    EntryDetailDto,
    PlaythroughDto,
    PlaythroughInputDto,
    ReviewDto,
    ReviewInputDto,
} from '@/types/playthrough';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import { useFavourites } from '@/hooks/useFavourites';
import { ScoreInput } from '@/components/ScoreInput';
import { PlaythroughForm } from '@/components/PlaythroughForm';
import { PlaythroughList } from '@/components/PlaythroughList';
import { ReviewForm } from '@/components/ReviewForm';
import { EntryNotesForm } from '@/components/EntryNotesForm';
import { apiFetch } from '@/lib/api';
import './GameUserPanel.css';

interface GameUserPanelProps {
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
}

/**
 * Where the panel's own read of the entry stands. Nothing that writes the entry is offered until it
 * is `ready`: a read that failed is not an empty entry, and a form filled from one would save over a
 * score, notes or a review the user already has.
 */
type EntryStatus = 'loading' | 'ready' | 'failed';

/**
 * Everything this user has recorded about one game, in one place: which list it is in, their
 * score, and a single control that erases the lot.
 *
 * The panel exists because those things are independent. Moving a game between lists, or taking
 * it out of all of them, leaves the score alone — so there has to be somewhere that shows what is
 * actually held and one deliberate way to discard it. Playthroughs live here for the same reason,
 * rather than getting controls of their own scattered around the page.
 *
 * The playthrough writes are plain submits with a pending state and an inline error — no
 * optimistic update, and nothing touching `ListsProvider`. Optimism pays for itself on a status
 * toggle, where the change is one field and the gesture has to feel instant; a seven-field form
 * has nothing to gain from showing a row that may be about to vanish, and everything to lose from
 * the user editing it while it does.
 *
 * **Mounted per game and per account**, by the key the page gives it: every write here settles after
 * it was made, and the page stays mounted when a link goes from one game to the next. A panel that
 * outlived its game would write the first game's saved value, or its error, into the second game's
 * form — and a marker kept in a ref cannot close that window, because writing it from an effect
 * lags the commit, which is the same trap ADR 0022 records for the account. Unmounting is the one
 * guard React applies during the commit itself.
 */
export function GameUserPanel({ game, profileVisibility, onCommunityChange }: GameUserPanelProps) {
    const {
        isInList, getListFor, addToList, removeFromList, setScore, setOwnership, setNotes, deleteEntry, isPending,
        nameFor,
    } = useLists();
    const wishlist = useWishlist();
    const favourites = useFavourites();

    // The provider only knows about games that are in a list. A game that was scored and then
    // taken out of every list still has an entry, so the panel asks for it directly — and that
    // read carries the playthroughs too, because this panel shows them together.
    const [score, setLocalScore] = useState<number | null>(null);
    const [ownership, setLocalOwnership] = useState<Ownership | null>(null);
    const [notes, setLocalNotes] = useState<string | null>(null);
    const [playthroughs, setPlaythroughs] = useState<PlaythroughDto[]>([]);
    const [review, setReview] = useState<ReviewDto | null>(null);
    const [entryStatus, setEntryStatus] = useState<EntryStatus>('loading');
    // Bumped by "Try again", which is what re-runs the read.
    const [entryAttempt, setEntryAttempt] = useState(0);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
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

    const ownershipLabelId = useId();
    const currentList = getListFor(game.id);
    const pending = isPending(game.id);
    const wishlisted = wishlist.isWishlisted(game.id);
    const favourite = favourites.isFavourite(game.id);
    const ready = entryStatus === 'ready';

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
                setPlaythroughs(detail?.playthroughs ?? []);
                setReview(detail?.review ?? null);
                setEntryStatus('ready');
            })
            .catch(() => {
                // Including the rejection an unreachable API gives, which no status check sees. The
                // lists, wishlist and favourite above do not come from this read and stay usable.
                if (!controller.signal.aborted) setEntryStatus('failed');
            });

        return () => controller.abort();
    }, [game.id, entryAttempt]);

    /** From the click rather than the effect, which may not set state synchronously. */
    const retryEntry = () => {
        setEntryStatus('loading');
        setEntryAttempt(attempt => attempt + 1);
    };

    const handleScore = async (next: number | null) => {
        const previous = score;
        setLocalScore(next);
        const saved = await setScore(game.id, next);
        if (saved) onCommunityChange();
        else setLocalScore(previous);
    };

    /**
     * Shown at once and put back if the save fails, as the score is — with a message, unlike the
     * score's revert: a toggle that goes back on its own reads as a click that did not register.
     * The provider takes the per-game lock, so no other write to this entry can be out at the time.
     */
    const handleOwnership = async (next: Ownership | null) => {
        const previous = ownership;
        setLocalOwnership(next);
        setOwnershipError(null);

        if (!await setOwnership(game.id, next)) {
            setLocalOwnership(previous);
            setOwnershipError('Could not save how you have this game. Please try again.');
        }
    };

    /** Not optimistic: the box keeps what was typed until the server has it, as the review does. */
    const handleNotesSave = async (next: string | null) => {
        setSavingNotes(true);
        setNotesError(null);

        const saved = await setNotes(game.id, next);

        if (saved) setLocalNotes(next);
        else setNotesError('Could not save your notes. Please try again.');
        setSavingNotes(false);
    };

    const handleDelete = async () => {
        setConfirmingDelete(false);
        setDeleteError(null);

        const deleted = await deleteEntry(game.id);

        // Everything is still recorded, so everything stays on screen. Cleared anyway, the panel
        // would show an empty game until the next page load, and saving from it would write over
        // what is still there.
        if (!deleted) {
            setDeleteError('Could not delete your data for this game. Please try again.');
            return;
        }

        setLocalScore(null);
        setLocalOwnership(null);
        setLocalNotes(null);

        // The playthroughs and the review go with the entry — the composite foreign key cascades
        // both — so the panel must not go on showing what the server has just discarded.
        setPlaythroughs([]);
        setReview(null);
        setEditing(null);

        // Nothing is recorded now, which is known without asking — even after a read that failed.
        setEntryStatus('ready');
        onCommunityChange();
    };

    /**
     * Logs a new playthrough, or saves an edit to one.
     *
     * `catch` rather than only `!res.ok`, because an unreachable API makes `fetch` reject rather
     * than return a bad response — without it the form would clear as though it had saved.
     */
    const handlePlaythroughSubmit = async (input: PlaythroughInputDto) => {
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
                return;
            }

            const saved = (await res.json()) as PlaythroughDto;
            setPlaythroughs(current => sorted(editingId === null
                ? [...current, saved]
                : current.map(p => (p.id === editingId ? saved : p))));
            setEditing(null);
        } catch {
            setPlaythroughError('Could not save your playthrough. Please try again.');
        } finally {
            setSavingPlaythrough(false);
        }
    };

    const handlePlaythroughDelete = async (playthrough: PlaythroughDto) => {
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

    const handleReviewSave = async (input: ReviewInputDto) => {
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

    const handleReviewDelete = async () => {
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

    const handleWishlistToggle = async () => {
        if (wishlisted) await wishlist.remove(game.id);
        else await wishlist.add(game);
    };

    const handleFavouriteToggle = async () => {
        if (favourite) await favourites.remove(game.id);
        else await favourites.add(game);
    };

    const handleListClick = async (listId: ListId) => {
        if (pending) return;
        if (isInList(listId, game.id)) await removeFromList(listId, game.id);
        else await addToList(listId, game);
    };

    const hasData = currentList !== null
        || score !== null
        || ownership !== null
        || notes !== null
        || playthroughs.length > 0
        || review !== null;

    return (
        <div className="game-user-panel">
            <h2 className="game-user-panel-title">Your copy</h2>

            <div className="game-user-panel-section">
                <p className="game-user-panel-label">List</p>
                <div className="game-user-panel-lists">
                    {LIST_IDS.map(listId => {
                        const active = isInList(listId, game.id);
                        return (
                            <button
                                key={listId}
                                type="button"
                                className={`game-user-panel-list-btn${active ? ' active' : ''}`}
                                onClick={() => void handleListClick(listId)}
                                disabled={pending}
                                aria-pressed={active}
                                title={active ? `Take out of ${nameFor(listId)}` : `Move to ${nameFor(listId)}`}
                            >
                                {nameFor(listId)}
                            </button>
                        );
                    })}
                </div>
                {currentList === null && (
                    <p className="game-user-panel-hint">Not in any of your lists.</p>
                )}
            </div>

            {/* Its own section, not a sixth button above: the five statuses are exclusive and the
                wishlist is not, so a game can sit here and in Backlog at the same time. */}
            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Wishlist</p>
                <button
                    type="button"
                    className={`game-user-panel-wishlist${wishlisted ? ' active' : ''}`}
                    onClick={() => void handleWishlistToggle()}
                    disabled={wishlist.isPending(game.id)}
                    aria-pressed={wishlisted}
                >
                    <svg
                        fill={wishlisted ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    {wishlisted ? 'On your wishlist' : 'Add to wishlist'}
                </button>
                {/* The mutation error, not the load error: a wishlist that failed to load is a
                    whole-page condition, and this panel is about one game. */}
                {wishlist.mutationError && (
                    <p className="game-user-panel-hint" role="alert">{wishlist.mutationError}</p>
                )}
            </div>

            {/* A third axis, beside the wishlist rather than folded into it: loving a game is not
                wanting one, and a game can be both. A rosette, never a star — stars are the score
                below and nothing else (ADR 0021). */}
            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Favourite</p>
                <button
                    type="button"
                    className={`game-user-panel-favourite${favourite ? ' active' : ''}`}
                    onClick={() => void handleFavouriteToggle()}
                    disabled={favourites.isPending(game.id)}
                    aria-pressed={favourite}
                >
                    <svg
                        fill={favourite ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a6 6 0 100-12 6 6 0 000 12zM8.2 13.7L7 21l5-3 5 3-1.2-7.3" />
                    </svg>
                    {favourite ? 'One of your favourites' : 'Add to favourites'}
                </button>
                {/* Where a favourite shows is the question worth answering here, and the answer
                    depends on the one setting that decides it — as the review form's does. */}
                <p className="game-user-panel-hint">
                    {profileVisibility === 'public'
                        ? 'Favourites are shown on your public profile.'
                        : 'Shown on your own profile page. Your profile is private, so nobody else sees them.'}
                </p>
                {/* Unlike the wishlist, favourites have no page of their own to report a failed
                    load and offer a retry, so the one control that is stuck says why. */}
                {favourites.error && (
                    <p className="game-user-panel-hint" role="alert">
                        Your favourites could not be loaded, so this cannot be changed just now.{' '}
                        <button type="button" className="game-user-panel-retry" onClick={favourites.reload}>
                            Try again
                        </button>
                    </p>
                )}
                {favourites.mutationError && (
                    <p className="game-user-panel-hint" role="alert">{favourites.mutationError}</p>
                )}
            </div>

            {/* Above the first section this read feeds, and not instead of them: shown empty, the
                forms would invite a save over data that only failed to arrive. */}
            {entryStatus === 'failed' && (
                <div className="game-user-panel-section">
                    <p className="game-user-panel-hint" role="alert">
                        Your score, ownership, notes, playthroughs and review for this game could not
                        be loaded, so they cannot be changed just now.{' '}
                        <button type="button" className="game-user-panel-retry" onClick={retryEntry}>
                            Try again
                        </button>
                    </p>
                </div>
            )}

            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Your score</p>
                <div className="game-user-panel-score">
                    <ScoreInput
                        size="md"
                        score={score}
                        gameTitle={game.title}
                        disabled={!ready || pending}
                        onChange={next => void handleScore(next)}
                    />
                    <span className="game-user-panel-hint">
                        {/* Worth saying, because it is the opposite of what most trackers do. */}
                        Kept whatever list this is in, or none.
                    </span>
                </div>
            </div>

            {/* Toggles like the statuses above, so pressing the one that is on clears it — but a
                colour of their own, because this is about the copy and not about the playing. */}
            <div className="game-user-panel-section">
                <p className="game-user-panel-label" id={ownershipLabelId}>How you have it</p>
                <div className="game-user-panel-lists" role="group" aria-labelledby={ownershipLabelId}>
                    {OWNERSHIPS.map(kind => {
                        const active = ownership === kind;
                        return (
                            <button
                                key={kind}
                                type="button"
                                className={`game-user-panel-list-btn game-user-panel-ownership-btn${active ? ' active' : ''}`}
                                onClick={() => void handleOwnership(active ? null : kind)}
                                disabled={!ready || pending}
                                aria-pressed={active}
                                title={active ? 'Clear' : `Mark as ${OWNERSHIP_NAMES[kind].toLowerCase()}`}
                            >
                                {OWNERSHIP_NAMES[kind]}
                            </button>
                        );
                    })}
                </div>
                <p className="game-user-panel-hint">
                    {ownership === null
                        ? 'Not recorded. Whether the copy is yours to keep; where you play it goes on a playthrough.'
                        : 'Press it again to clear it.'}
                </p>
                {ownershipError !== null && (
                    <p className="game-user-panel-hint" role="alert">{ownershipError}</p>
                )}
            </div>

            <div className="game-user-panel-section">
                <EntryNotesForm
                    notes={notes}
                    onSave={next => void handleNotesSave(next)}
                    pending={!ready || pending || savingNotes}
                    error={notesError}
                />
            </div>

            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Playthroughs</p>
                <PlaythroughList
                    playthroughs={playthroughs}
                    platforms={game.platforms}
                    onEdit={setEditing}
                    onDelete={playthrough => void handlePlaythroughDelete(playthrough)}
                    busyId={deletingPlaythroughId}
                    disabled={!ready || savingPlaythrough}
                />
                <PlaythroughForm
                    platforms={game.platforms}
                    editing={editing}
                    onSubmit={input => void handlePlaythroughSubmit(input)}
                    onCancelEdit={() => setEditing(null)}
                    pending={!ready || savingPlaythrough}
                    error={playthroughError}
                />
            </div>

            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Your review</p>
                <ReviewForm
                    review={review}
                    playthroughs={playthroughs}
                    profileVisibility={profileVisibility}
                    onSave={input => void handleReviewSave(input)}
                    onDelete={() => void handleReviewDelete()}
                    pending={!ready || savingReview}
                    error={reviewError}
                />
            </div>

            {hasData && (
                <div className="game-user-panel-danger">
                    {confirmingDelete ? (
                        <>
                            <p className="game-user-panel-hint">
                                Delete your score, list placement, ownership, notes, playthroughs
                                and review for this game? Your history of moving it between lists
                                is kept.
                            </p>
                            <div className="game-user-panel-confirm">
                                <button type="button" className="danger" onClick={() => void handleDelete()}>
                                    Delete
                                </button>
                                <button type="button" onClick={() => setConfirmingDelete(false)}>
                                    Cancel
                                </button>
                            </div>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="game-user-panel-delete"
                            onClick={() => setConfirmingDelete(true)}
                            disabled={pending}
                        >
                            Delete my data for this game
                        </button>
                    )}
                    {deleteError !== null && (
                        <p className="game-user-panel-hint" role="alert">{deleteError}</p>
                    )}
                </div>
            )}
        </div>
    );
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
