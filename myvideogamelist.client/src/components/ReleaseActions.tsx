import type { ReleaseGameState } from '@/hooks/useReleaseGame';

interface ReleaseActionsProps {
    /** The game's title, which names both buttons, so that a screen reader can tell one card's from the next. */
    title: string;
    /** The reader's side of the game, from `useReleaseGame`. */
    state: ReleaseGameState;
}

/**
 * The two things to do with a game wherever the site shows what is coming or just out — the two-week line,
 * the calendar, Coming soon and Just out — the same on all four and drawn the same way, under the game's
 * words, as two square buttons: the heart that puts it on the wishlist or takes it off, pressed once it is
 * on it, in the wishlist's own pink; and a list with a plus that puts it in the Backlog, for a game in none
 * of the reader's lists, which goes once it is in one and the card says so. Each says when its change did
 * not stick, where the message stays put.
 *
 * Offered once somebody is signed in. The heart is disabled while the wishlist is unknown, so that a press
 * never writes over what it cannot see; the Backlog is not offered until the lists have loaded.
 */
export function ReleaseActions({ title, state }: ReleaseActionsProps) {
    if (!state.signedIn) return null;

    return (
        <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => void state.toggleWishlist()}
                    disabled={state.wishlistPending}
                    aria-pressed={state.wishlisted}
                    aria-label={`Wishlist ${title}`}
                    title={state.wishlisted ? 'Take off your wishlist' : 'Add to your wishlist'}
                    className={`flex shrink-0 items-center justify-center w-8 h-8 rounded-sm border transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 ${
                        state.wishlisted
                            ? 'bg-wishlist-700/90 text-fg-strong border-transparent'
                            : 'border-line-strong text-fg-muted hover:text-fg-strong hover:border-wishlist-600'
                    }`}
                >
                    <svg className="w-4 h-4" fill={state.wishlisted ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                </button>

                {state.canAddToBacklog && (
                    // A list with a plus, the heart's size and shape, so that the two read as a pair. The
                    // reader's own name for the Backlog is in its tooltip and its name rather than on it: the
                    // words first, so that saying them to a voice control reaches it, and the title after,
                    // so that a screen reader can tell one card's from the next.
                    <button
                        type="button"
                        onClick={state.addToBacklog}
                        disabled={state.backlogPending}
                        aria-label={`Add to ${state.backlogName}: ${title}`}
                        title={`Add to ${state.backlogName}`}
                        className="flex shrink-0 items-center justify-center w-8 h-8 rounded-sm border border-line-strong text-fg-muted transition-colors hover:text-fg-strong hover:border-primary-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h13M4 11h13M4 16h7M17 14v7M13.5 17.5h7" />
                        </svg>
                    </button>
                )}
            </div>

            {state.wishlistFailed && (
                <p className="mt-1 text-xs font-semibold text-danger-300" role="alert">Could not update your wishlist.</p>
            )}
            {state.backlogFailed && (
                <p className="mt-1 text-xs font-semibold text-danger-300" role="alert">Could not add it to {state.backlogName}.</p>
            )}
        </>
    );
}
