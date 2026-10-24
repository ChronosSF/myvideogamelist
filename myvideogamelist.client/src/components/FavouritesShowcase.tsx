import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useFavourites } from '@/hooks/useFavourites';
import { useReorder } from '@/hooks/useReorder';
import type { ProfileVisibility } from '@/types/auth';
import type { FavouriteDto } from '@/types/favourite';
import type { GameRefDto } from '@/types/game';
import { GameRefRail } from './GameRefRail';
import { GameRefTile } from './GameRefTile';
import { ReorderAnnouncer } from './ReorderAnnouncer';
import { ReorderHandle } from './ReorderHandle';
import './ProfileStats.css';
import './FavouritesShowcase.css';

interface FavouritesShowcaseProps {
    /** Decides what the caption says about who else sees these. */
    profileVisibility: ProfileVisibility;
}

/**
 * An arranged tile is a column of the showcase's grid, whose container sets its width
 * (FavouritesShowcase.css): three columns under 30rem and columns of 6.5rem or more beyond, so never as
 * much as 9.5rem. Less the cover's one-pixel border on either side. Lazy, so a browser that knows `auto`
 * takes the width it is really laid out at.
 */
const ARRANGED_COVER_SIZES = 'calc(9.5rem - 2px)';

function asRef(item: FavouriteDto): GameRefDto {
    return { id: item.game.id, name: item.game.title, coverImageUrl: item.game.coverImageUrl };
}

/** How the showcase is ordered, in the caption's words. */
function orderWords(items: FavouriteDto[]): string {
    const placed = items.filter(item => item.position != null).length;
    if (placed === 0) return 'most recent first';
    if (placed === items.length) return 'in the order you arranged them';
    return 'the ones you placed first, then the rest most recent first';
}

/**
 * The signed-in user's favourite games, as a row of covers on their own profile, in the order they
 * arrange.
 *
 * Read from `FavouritesProvider`, which the game page's toggle writes through, so a favourite made a
 * moment ago is already here without a request of this component's own. Made and unmade from each
 * game's page rather than from here (ADR 0029 §4); arranged here, because the order is the showcase's
 * own (ADR 0064).
 *
 * Arranging is a mode, pressed on and off. The row scrolls sideways, which suits looking and not
 * moving: a drag would have to scroll it to reach a far place, and a tap on one cover would lose the
 * game it held to the swipe that scrolls to the other. So while it is arranged the showcase is laid out
 * as a grid with every cover on screen, and the hand order's control is the backlog's, unchanged
 * (`useReorder`, ADR 0054): drag a grip, tap one grip and then another, or pick one up from the
 * keyboard.
 */
export function FavouritesShowcase({ profileVisibility }: FavouritesShowcaseProps) {
    const { items, loading, error, orderError, reload, isFavourite, isPending, moveInOrder } = useFavourites();
    const [arranging, setArranging] = useState(false);

    // Something to arrange: two or more, and a list known to be right.
    const canArrange = !loading && error === null && items.length > 1;

    // Down to one, or none, there is nothing to arrange any more, and the mode ends with it rather than
    // coming back by itself should a second arrive. Adjusted during render, React's pattern for state
    // that follows a prop; false again at once, so it cannot loop. Not while a reload is out, which
    // keeps the mode across a refetch.
    if (arranging && !loading && error === null && items.length < 2) setArranging(false);

    const arrangingNow = arranging && canArrange;

    const byId = useMemo(() => new Map(items.map(item => [item.game.id, item])), [items]);
    const reorder = useReorder({
        ids: items.map(item => item.game.id),
        nameOf: id => byId.get(id)?.game.title ?? 'This game',
        onMove: (id, afterId) => moveInOrder(id, afterId),
        canMove: id => !isPending(id),
        disabled: !arrangingNow,
    });

    // While a game is being moved it is drawn where it would land.
    const shown = arrangingNow ? reorder.order.flatMap(id => byId.get(id) ?? []) : items;

    const visibility = profileVisibility === 'public'
        ? 'Your public profile shows them too, in the same order.'
        : 'Your profile is private, so nobody else sees them.';

    return (
        <section className="profile-stats" aria-labelledby="favourites-showcase-heading">
            <div className="favourites-showcase-head">
                <h2 id="favourites-showcase-heading" className="profile-heading">Your favourites</h2>
                {canArrange && (
                    <button
                        type="button"
                        className="favourites-showcase-arrange"
                        aria-pressed={arranging}
                        onClick={() => setArranging(on => !on)}
                    >
                        Arrange
                    </button>
                )}
            </div>

            {loading ? (
                <p className="profile-empty">Loading your favourites…</p>
            ) : error !== null ? (
                <div className="profile-error" role="alert">
                    <p>{error}</p>
                    <button type="button" className="profile-retry" onClick={reload}>
                        Try again
                    </button>
                </div>
            ) : items.length === 0 ? (
                <>
                    <p className="profile-empty">
                        None yet. Open any game and mark it as one of your favourites, whatever list
                        it is in — or none.
                    </p>
                    <Link to="/games" className="profile-cta">Browse games</Link>
                </>
            ) : arrangingNow ? (
                <>
                    <p className="profile-caption">
                        Drag a cover by its handle to where you want it — or press a handle and then the
                        handle of the game whose place it should take, or pick one up with Space and move
                        it with the arrow keys. Favourites you have not placed follow, most recent first.
                        {` ${visibility}`}
                    </p>

                    {/* Beside the covers, never instead of them: a failed move has already been put
                        back. The order's own error, so a favourite toggle that failed on a game page
                        does not turn up here. */}
                    {orderError !== null && (
                        <p className="favourites-showcase-error" role="alert">{orderError}</p>
                    )}

                    <ReorderAnnouncer reorder={reorder} />

                    <ul
                        className="favourites-showcase-grid"
                        // Said outright: a list styled without its markers stops being one to WebKit's
                        // screen reader, and then nobody hears a favourite's place in it.
                        role="list"
                        aria-label="Your favourite games"
                        {...reorder.listProps()}
                    >
                        {shown.map((item, index) => (
                            <li key={item.game.id} className="reorder-tile" {...reorder.itemProps(item.game.id)}>
                                <ReorderHandle
                                    handle={reorder.handleProps(item.game.id)}
                                    rank={index + 1}
                                    variant="overlay"
                                />
                                {/* Not a link while it is arranged: a press that misses the grip would
                                    leave the page, and the mode with it. Not said in words either: the
                                    list is named as the reader's favourites. */}
                                <GameRefTile
                                    game={asRef(item)}
                                    favourite={isFavourite(item.game.id)}
                                    sayFavourite={false}
                                    linked={false}
                                    sizes={ARRANGED_COVER_SIZES}
                                />
                            </li>
                        ))}
                    </ul>
                </>
            ) : (
                <>
                    <GameRefRail
                        games={items.map(asRef)}
                        label="Your favourite games"
                        // At the top of the account page's main column, in view as it opens.
                        eager={6}
                        isFavourite={isFavourite}
                        sayFavourites={false}
                    />
                    <p className="profile-caption">
                        {`${items.length} ${items.length === 1 ? 'game' : 'games'}, ${orderWords(items)}. `}
                        {visibility}
                    </p>
                </>
            )}
        </section>
    );
}
