import { useEffect, useState } from 'react';
import type { GameDto } from '@/types/game';
import { type ListId, type ListEntryDto, LIST_IDS, LIST_NAMES } from '@/types/list';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import { ScoreInput } from '@/components/ScoreInput';
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
 * actually held and one deliberate way to discard it. Playthroughs and a review will join the same
 * panel rather than getting controls of their own scattered around the page.
 */
export function GameUserPanel({ game }: GameUserPanelProps) {
    const { isInList, getListFor, addToList, removeFromList, setScore, deleteEntry, isPending } = useLists();
    const wishlist = useWishlist();

    // The provider only knows about games that are in a list. A game that was scored and then
    // taken out of every list still has an entry, so the panel asks for it directly.
    const [score, setLocalScore] = useState<number | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const [lastGameId, setLastGameId] = useState(game.id);

    // Reset when navigating straight from one game page to another. Adjusted during render
    // rather than in the effect: resetting in the effect would flash the previous game's score
    // under the new title for one commit, and trips react-hooks/set-state-in-effect.
    if (lastGameId !== game.id) {
        setLastGameId(game.id);
        setLocalScore(null);
        setLoaded(false);
        setConfirmingDelete(false);
    }

    const currentList = getListFor(game.id);
    const pending = isPending(game.id);
    const wishlisted = wishlist.isWishlisted(game.id);

    useEffect(() => {
        const controller = new AbortController();

        fetch(`/api/entries/${game.id}`, { credentials: 'include', signal: controller.signal })
            .then(res => (res.ok ? (res.json() as Promise<ListEntryDto>) : null))
            .then(entry => {
                if (controller.signal.aborted) return;
                setLocalScore(entry?.score ?? null);
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

    const hasData = currentList !== null || score !== null;

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
                {wishlist.error && (
                    <p className="game-user-panel-hint" role="alert">{wishlist.error}</p>
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

            {hasData && (
                <div className="game-user-panel-danger">
                    {confirmingDelete ? (
                        <>
                            <p className="game-user-panel-hint">
                                Delete your score and list placement for this game? Your history of
                                moving it between lists is kept.
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
