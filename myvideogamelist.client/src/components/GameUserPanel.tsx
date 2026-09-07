import { useEffect, useState } from 'react';
import type { GameDto } from '@/types/game';
import { type ListId, LIST_IDS, LIST_NAMES } from '@/types/list';
import type {
    EntryDetailDto,
    PlaythroughDto,
    PlaythroughInputDto,
    ReviewDto,
    ReviewInputDto,
} from '@/types/playthrough';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import { ScoreInput } from '@/components/ScoreInput';
import { PlaythroughForm } from '@/components/PlaythroughForm';
import { PlaythroughList } from '@/components/PlaythroughList';
import { ReviewForm } from '@/components/ReviewForm';
import './GameUserPanel.css';

interface GameUserPanelProps {
    game: GameDto;
}

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
 */
export function GameUserPanel({ game }: GameUserPanelProps) {
    const { isInList, getListFor, addToList, removeFromList, setScore, deleteEntry, isPending } = useLists();
    const wishlist = useWishlist();

    // The provider only knows about games that are in a list. A game that was scored and then
    // taken out of every list still has an entry, so the panel asks for it directly — and that
    // read carries the playthroughs too, because this panel shows them together.
    const [score, setLocalScore] = useState<number | null>(null);
    const [playthroughs, setPlaythroughs] = useState<PlaythroughDto[]>([]);
    const [review, setReview] = useState<ReviewDto | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const [editing, setEditing] = useState<PlaythroughDto | null>(null);
    const [savingPlaythrough, setSavingPlaythrough] = useState(false);
    const [deletingPlaythroughId, setDeletingPlaythroughId] = useState<number | null>(null);
    const [playthroughError, setPlaythroughError] = useState<string | null>(null);

    const [savingReview, setSavingReview] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);

    const [lastGameId, setLastGameId] = useState(game.id);

    // Reset when navigating straight from one game page to another. Adjusted during render
    // rather than in the effect: resetting in the effect would flash the previous game's score
    // under the new title for one commit, and trips react-hooks/set-state-in-effect.
    if (lastGameId !== game.id) {
        setLastGameId(game.id);
        setLocalScore(null);
        setPlaythroughs([]);
        setReview(null);
        setLoaded(false);
        setConfirmingDelete(false);
        setEditing(null);
        setSavingPlaythrough(false);
        setDeletingPlaythroughId(null);
        setPlaythroughError(null);
        setSavingReview(false);
        setReviewError(null);
    }

    const currentList = getListFor(game.id);
    const pending = isPending(game.id);
    const wishlisted = wishlist.isWishlisted(game.id);

    useEffect(() => {
        const controller = new AbortController();

        fetch(`/api/entries/${game.id}`, { credentials: 'include', signal: controller.signal })
            .then(res => (res.ok ? (res.json() as Promise<EntryDetailDto>) : null))
            .then(detail => {
                if (controller.signal.aborted) return;
                setLocalScore(detail?.entry.score ?? null);
                setPlaythroughs(detail?.playthroughs ?? []);
                setReview(detail?.review ?? null);
                setLoaded(true);
            })
            .catch(() => {
                // A 404 is the normal case for a game the user has never touched, and a failure
                // here should leave the panel usable rather than blocking it.
                if (!controller.signal.aborted) setLoaded(true);
            });

        return () => controller.abort();
    }, [game.id]);

    const handleScore = async (next: number | null) => {
        const previous = score;
        setLocalScore(next);
        const saved = await setScore(game.id, next);
        if (!saved) setLocalScore(previous);
    };

    const handleDelete = async () => {
        setConfirmingDelete(false);
        await deleteEntry(game.id);
        setLocalScore(null);

        // The playthroughs and the review go with the entry — the composite foreign key cascades
        // both — so the panel must not go on showing what the server has just discarded.
        setPlaythroughs([]);
        setReview(null);
        setEditing(null);
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
            const res = await fetch(url, {
                method: editingId === null ? 'POST' : 'PUT',
                credentials: 'include',
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
            const res = await fetch(
                `/api/entries/${game.id}/playthroughs/${playthrough.id}`,
                { method: 'DELETE', credentials: 'include' },
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
            const res = await fetch(`/api/entries/${game.id}/review`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (!res.ok) {
                setReviewError(await problemMessage(res, 'saveReview'));
                return;
            }

            setReview((await res.json()) as ReviewDto);
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
            const res = await fetch(`/api/entries/${game.id}/review`, {
                method: 'DELETE',
                credentials: 'include',
            });

            if (!res.ok) {
                setReviewError(await problemMessage(res, 'deleteReview'));
                return;
            }

            setReview(null);
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

    const handleListClick = async (listId: ListId) => {
        if (pending) return;
        if (isInList(listId, game.id)) await removeFromList(listId, game.id);
        else await addToList(listId, game);
    };

    const hasData =
        currentList !== null || score !== null || playthroughs.length > 0 || review !== null;

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
                                title={active ? `Take out of ${LIST_NAMES[listId]}` : `Move to ${LIST_NAMES[listId]}`}
                            >
                                {LIST_NAMES[listId]}
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

            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Your score</p>
                <div className="game-user-panel-score">
                    <ScoreInput
                        size="md"
                        score={score}
                        gameTitle={game.title}
                        disabled={!loaded || pending}
                        onChange={next => void handleScore(next)}
                    />
                    <span className="game-user-panel-hint">
                        {/* Worth saying, because it is the opposite of what most trackers do. */}
                        Kept whatever list this is in, or none.
                    </span>
                </div>
            </div>

            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Playthroughs</p>
                <PlaythroughList
                    playthroughs={playthroughs}
                    platforms={game.platforms}
                    onEdit={setEditing}
                    onDelete={playthrough => void handlePlaythroughDelete(playthrough)}
                    busyId={deletingPlaythroughId}
                    disabled={!loaded || savingPlaythrough}
                />
                <PlaythroughForm
                    platforms={game.platforms}
                    editing={editing}
                    onSubmit={input => void handlePlaythroughSubmit(input)}
                    onCancelEdit={() => setEditing(null)}
                    pending={!loaded || savingPlaythrough}
                    error={playthroughError}
                />
            </div>

            <div className="game-user-panel-section">
                <p className="game-user-panel-label">Your review</p>
                <ReviewForm
                    review={review}
                    playthroughs={playthroughs}
                    onSave={input => void handleReviewSave(input)}
                    onDelete={() => void handleReviewDelete()}
                    pending={!loaded || savingReview}
                    error={reviewError}
                />
            </div>

            {hasData && (
                <div className="game-user-panel-danger">
                    {confirmingDelete ? (
                        <>
                            <p className="game-user-panel-hint">
                                Delete your score, list placement, playthroughs and review for
                                this game? Your history of moving it between lists is kept.
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
