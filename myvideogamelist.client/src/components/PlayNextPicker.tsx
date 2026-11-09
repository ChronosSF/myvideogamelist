import { useState } from 'react';
import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { PlayNextSkeleton } from '@/components/PlayNextSkeleton';
import { useLists } from '@/hooks/useLists';
import { useListsPending } from '@/hooks/useListPending';
import { useFavourites } from '@/hooks/useFavourites';
import { formatCount } from '@/lib/format';
import { FavouriteMark } from './FavouriteMark';
import type { ListEntryDto } from '@/types/list';

/**
 * One game from the backlog, picked at random, with a reroll and a way to start it (ROADMAP H5).
 *
 * **No new API**, like the Continue Playing rail above it: the backlog is already in
 * `ListsProvider`. Starting the game goes through that provider too, so it takes the per-game lock,
 * rolls back on failure and records the event — a status must never be written any other way
 * (ADR 0018). The started game then leads the rail above, which is the whole loop in one screen.
 */
export function PlayNextPicker() {
    const { lists, loading, error, addToList } = useLists();
    const isPending = useListsPending();
    const { isFavourite } = useFavourites();
    const backlog = lists.backlog;

    /**
     * Where the first pick lands, drawn once for this visit to the page. A number rather than a
     * game, because the backlog may not have loaded when it is drawn.
     */
    const [seed] = useState(() => Math.random());
    const [picked, setPicked] = useState<ListEntryDto | null>(null);
    /** The game whose start this card sent, until the provider has answered it. */
    const [starting, setStarting] = useState<number | null>(null);

    /*
     * What is on screen: the backlog's own row for the pick while it is still there, and the row
     * that was picked while this card's start for it is out. Starting a game takes it out of the
     * backlog optimistically, and without the second case the card would jump to another game before
     * the request had answered, and stay there if it failed.
     *
     * The card's own start, never the provider's lock: the lock reaches a component one render after
     * the backlog it goes with (`docs/decisions/0086-*`), and in that render the pick has left the
     * backlog unlocked, so the draw below would already have replaced it.
     */
    const current = picked === null
        ? null
        : backlog.find(entry => entry.game.id === picked.game.id)
            ?? (starting === picked.game.id ? picked : null);

    // Nothing picked yet, or the pick has left the backlog for good — started, moved or removed —
    // so draw again. Adjusted during render rather than in an effect, so no frame shows the card
    // empty; the condition is false as soon as the new pick is set, so it cannot loop.
    if (!loading && current === null && backlog.length > 0) {
        setPicked(backlog[Math.floor(seed * backlog.length)]);
    }

    // The card's own shapes while the lists load, for the rail's reason: an empty-backlog message that
    // turns into a game a moment later is worse, and nothing at all moved the line below it (ADR 0070).
    if (loading) return <PlayNextSkeleton />;

    // A failed load leaves every list empty, which is exactly what an empty backlog looks like — so
    // it has to be asked about before the empty state, or a failure tells somebody with a hundred
    // games waiting that they have none.
    if (error !== null) {
        return (
            <div className="continue-empty">
                <p>Your backlog could not be loaded just now.</p>
            </div>
        );
    }

    if (current === null) {
        return (
            <div className="continue-empty">
                <p>
                    Your backlog is empty. Add the games you mean to get to, and one of them will be
                    waiting here.
                </p>
                <Link to="/games" className="continue-empty-link">Browse games</Link>
            </div>
        );
    }

    const { game } = current;
    // Its own start as well as the lock, for the same render: the lock arrives one later.
    const pending = starting === game.id || isPending(game.id);
    const others = backlog.filter(entry => entry.game.id !== game.id);

    // Never the game already showing: a reroll that lands where it started looks broken.
    const reroll = () => setPicked(others[Math.floor(Math.random() * others.length)]);

    // The provider has committed its answer before this resolves, the game moved or put back, so the
    // pick is let go only once the backlog says where it went.
    const start = async () => {
        setStarting(game.id);
        await addToList('playing', game);
        setStarting(null);
    };

    return (
        <div className="play-next">
            {/* Hidden from assistive technology and the tab order: the title beside it is the same
                link, and two stops for one destination is one too many. */}
            <Link to={`/games/${game.id}`} className="play-next-cover" tabIndex={-1} aria-hidden="true">
                {/* In the first screen of the signed-in home page, so it loads with the rail above;
                    drawn across the 5rem box. */}
                {game.coverImageUrl && (
                    <CoverImage url={game.coverImageUrl} alt="" sizes="5rem" eager />
                )}
            </Link>

            <div className="play-next-body">
                {/* A live region, so a reroll says what it landed on to somebody who cannot see
                    the cover change. */}
                <p className="play-next-title" aria-live="polite" aria-atomic="true">
                    <Link to={`/games/${game.id}`}>{game.title}</Link>
                    {/* After the title, on a cover too small for the round mark. In the live region,
                        so a reroll onto a favourite says so. */}
                    {isFavourite(game.id) && <FavouriteMark variant="inline" />}
                </p>
                {/* Counted as the others plus this one rather than as the backlog's length, which is
                    one short while a start is in flight. */}
                <p className="play-next-meta">
                    {others.length === 0
                        ? 'The only game in your backlog.'
                        : `Picked from the ${formatCount(others.length + 1)} games in your backlog.`}
                </p>

                <div className="play-next-actions">
                    <button
                        type="button"
                        className="play-next-btn play-next-btn-primary"
                        disabled={pending}
                        onClick={() => void start()}
                    >
                        {pending ? 'Starting…' : 'Start playing'}
                    </button>
                    <button
                        type="button"
                        className="play-next-btn"
                        disabled={pending || others.length === 0}
                        onClick={reroll}
                    >
                        Pick another
                    </button>
                </div>
            </div>
        </div>
    );
}
