import { useState } from 'react';
import { Link } from 'react-router';
import { useLists } from '@/hooks/useLists';
import { formatCount } from '@/lib/format';
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
    const { lists, loading, error, isPending, addToList } = useLists();
    const backlog = lists.backlog;

    /**
     * Where the first pick lands, drawn once for this visit to the page. A number rather than a
     * game, because the backlog may not have loaded when it is drawn.
     */
    const [seed] = useState(() => Math.random());
    const [picked, setPicked] = useState<ListEntryDto | null>(null);

    /*
     * What is on screen: the backlog's own row for the pick while it is still there, and the row
     * that was picked while a start for it is in flight. Starting a game takes it out of the backlog
     * optimistically, and without the second case the card would jump to another game before the
     * request had answered — then jump back if it failed.
     */
    const current = picked === null
        ? null
        : backlog.find(entry => entry.game.id === picked.game.id)
            ?? (isPending(picked.game.id) ? picked : null);

    // Nothing picked yet, or the pick has left the backlog for good — started, moved or removed —
    // so draw again. Adjusted during render rather than in an effect, so no frame shows the card
    // empty; the condition is false as soon as the new pick is set, so it cannot loop.
    if (!loading && current === null && backlog.length > 0) {
        setPicked(backlog[Math.floor(seed * backlog.length)]);
    }

    // Nothing while the lists load, for the rail's reason: an empty-backlog message that turns into
    // a game a moment later is worse than a moment of nothing.
    if (loading) return null;

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
    const pending = isPending(game.id);
    const others = backlog.filter(entry => entry.game.id !== game.id);

    // Never the game already showing: a reroll that lands where it started looks broken.
    const reroll = () => setPicked(others[Math.floor(Math.random() * others.length)]);

    return (
        <div className="play-next">
            {/* Hidden from assistive technology and the tab order: the title beside it is the same
                link, and two stops for one destination is one too many. */}
            <Link to={`/games/${game.id}`} className="play-next-cover" tabIndex={-1} aria-hidden="true">
                {game.coverImageUrl && <img src={game.coverImageUrl} alt="" />}
            </Link>

            <div className="play-next-body">
                {/* A live region, so a reroll says what it landed on to somebody who cannot see
                    the cover change. */}
                <p className="play-next-title" aria-live="polite">
                    <Link to={`/games/${game.id}`}>{game.title}</Link>
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
                        onClick={() => void addToList('playing', game)}
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
