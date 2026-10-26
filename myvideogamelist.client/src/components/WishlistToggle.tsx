import type { ReleaseGameState } from '@/hooks/useReleaseGame';

interface WishlistToggleProps {
    /** The game's title, which names the button. */
    title: string;
    /** The reader's side of the game, from `useReleaseGame`. */
    state: ReleaseGameState;
    /** `cover`, a round button over a cover's corner; `inline`, a small outlined one under a game's words. */
    variant: 'cover' | 'inline';
}

/**
 * The heart that puts a game on the wishlist or takes it off, on the home page's release panels, and what it
 * says when the change did not stick. Pressed once the game is on it, in the wishlist's own pink; the label
 * names the game, so that a screen reader can tell one card's from the next.
 *
 * Offered only once somebody is signed in, and disabled while the wishlist is unknown, so a press never
 * writes over what it cannot see.
 */
export function WishlistToggle({ title, state, variant }: WishlistToggleProps) {
    if (!state.signedIn) return null;

    const shape = variant === 'cover'
        ? 'absolute top-1.5 right-1.5 w-8 h-8 rounded-full border border-white/20 shadow-md'
        : 'w-8 h-8 rounded-sm border border-line-strong';
    const colours = state.wishlisted
        ? 'bg-wishlist-700/90 text-fg-strong border-transparent'
        : variant === 'cover'
            ? 'bg-sunken/80 text-fg-soft hover:bg-wishlist-600/85 hover:text-fg-strong'
            : 'text-fg-muted hover:text-fg-strong hover:border-wishlist-600';

    const button = (
        <button
            type="button"
            onClick={() => void state.toggleWishlist()}
            disabled={state.pending}
            aria-pressed={state.wishlisted}
            aria-label={`Wishlist ${title}`}
            title={state.wishlisted ? 'Take off your wishlist' : 'Add to your wishlist'}
            className={`flex shrink-0 items-center justify-center transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 ${shape} ${colours}`}
        >
            <svg className="w-4 h-4" fill={state.wishlisted ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
        </button>
    );

    return (
        <>
            {variant === 'inline' ? <div className="mt-2">{button}</div> : button}
            {state.failed && (
                <p className="mt-1 text-xs font-semibold text-danger-300" role="alert">
                    Could not update your wishlist.
                </p>
            )}
        </>
    );
}
