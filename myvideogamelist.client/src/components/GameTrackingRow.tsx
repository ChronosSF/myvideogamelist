import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';
import type { GameEntryContextValue } from '@/contexts/GameEntryContext';
import type { GameDto } from '@/types/game';
import { useAuthDialog } from '@/hooks/useAuthDialog';
import { useGameEntry } from '@/hooks/useGameEntry';
import { useLists } from '@/hooks/useLists';
import { formatCountOf } from '@/lib/format';
import { ListPicker } from '@/components/ListPicker';
import { Rosette } from '@/components/Rosette';
import { ScoreInput } from '@/components/ScoreInput';

const HEART = 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z';

/** The heart's and the rosette's size inside their squares. */
const ICON = 'w-[18px] h-[18px]';

interface GameTrackingRowProps {
    game: GameDto;
    /** Auth has not answered: every render on the server, and the first in the browser. */
    authLoading: boolean;
    /** Whether the line under the row links to the Your game tab, which it does from every other tab. */
    linkToYours: boolean;
}

/**
 * The reader's own controls for the game, in the game page's hero (ADR 0084): its list, the score, the
 * wishlist and the favourite, as one row, with a line under it saying what else is recorded.
 *
 * Drawn the same size in all three of its states, which is what lets it sit in the first screen of a page
 * cached for everybody. The server render and the first render in the browser cannot know who is reading,
 * so they draw the row with nothing in it; a reader who is signed out gets the same controls, live, each
 * asking them to sign in; a signed-in reader gets theirs. Only words change between the three, and the
 * line under the row is always one line, so nothing moves when auth answers.
 */
export function GameTrackingRow({ game, authLoading, linkToYours }: GameTrackingRowProps) {
    const entry = useGameEntry();
    const authDialog = useAuthDialog();
    const { nameFor, error: listsError, reload: reloadLists } = useLists();
    const favouriteHintId = useId();

    const signIn = () => authDialog.open('login');
    const signedOut = entry === null && !authLoading;

    // Bumped by a star pressed signed out, which remounts the stars: the browser checks the radio pressed,
    // and with no score to give, nothing else would take that back — a screen reader would hear one.
    const [starPrompts, setStarPrompts] = useState(0);

    const wishlisted = entry?.wishlisted ?? false;
    const favourite = entry?.favourite ?? false;

    return (
        <div className="mt-5">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
                <ListPicker
                    current={entry?.currentList ?? null}
                    nameFor={nameFor}
                    disabled={entry === null || !entry.listsKnown || entry.pending}
                    onMove={listId => void entry?.moveTo(listId)}
                    onTakeOut={() => void entry?.takeOut()}
                    onSignIn={signedOut ? signIn : undefined}
                />

                <span aria-hidden="true" className="hidden sm:block w-px h-7 bg-line-strong" />

                {/* Last on a phone, on a line of its own, so that the list, the heart and the rosette share
                    the first; between them from `sm` up, as one row. */}
                <div className="flex items-center gap-2 order-last sm:order-none w-full sm:w-auto">
                    {/* Signed out, a star asks the reader to sign in, as the other controls do; the score
                        itself stays empty, since there is nobody to give it. */}
                    <ScoreInput
                        key={starPrompts}
                        size="md"
                        score={entry?.score ?? null}
                        gameTitle={game.title}
                        disabled={authLoading || (entry !== null && (!entry.ready || entry.pending))}
                        onChange={next => {
                            if (entry !== null) {
                                void entry.changeScore(next);
                                return;
                            }
                            setStarPrompts(prompts => prompts + 1);
                            signIn();
                        }}
                    />
                    <span className="type-kicker text-fg-faint" aria-hidden="true">Your score</span>
                </div>

                <span aria-hidden="true" className="hidden sm:block w-px h-7 bg-line-strong" />

                <div className="flex items-center gap-2">
                    <SquareToggle
                        pressed={wishlisted}
                        label={wishlisted ? 'On your wishlist' : 'Add to wishlist'}
                        disabled={authLoading || (entry !== null && entry.wishlistPending)}
                        onPress={() => (entry === null ? signIn() : void entry.toggleWishlist())}
                        pressedClass="bg-wishlist-700 border-wishlist-700 text-fg-strong"
                        hoverClass="hover:border-wishlist-600"
                    >
                        <svg className={ICON} fill={wishlisted ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={HEART} />
                        </svg>
                    </SquareToggle>
                    {/* A third axis, beside the wishlist rather than folded into it: loving a game is not
                        wanting one, and a game can be both. A rosette, never a star — stars are the score
                        beside it and nothing else (ADR 0021). */}
                    <SquareToggle
                        pressed={favourite}
                        label={favourite ? 'One of your favourites' : 'Add to favourites'}
                        disabled={authLoading || (entry !== null && (entry.favouritePending || entry.favouritesFailed))}
                        onPress={() => (entry === null ? signIn() : void entry.toggleFavourite())}
                        pressedClass="bg-favourite-700 border-favourite-700 text-fg-strong"
                        hoverClass="hover:border-favourite-500"
                        describedBy={entry !== null ? favouriteHintId : undefined}
                    >
                        <Rosette filled={favourite} className={ICON} />
                    </SquareToggle>
                    {/* Where a favourite shows is the question worth answering, and the answer depends on
                        the one setting that decides it — as the review form's does. */}
                    {entry !== null && (
                        <span id={favouriteHintId} className="sr-only">
                            {entry.profileVisibility === 'public'
                                ? 'Favourites are shown on your public profile.'
                                : 'Shown on your own profile page. Your profile is private, so nobody else sees them.'}
                        </span>
                    )}
                </div>
            </div>

            <p className="mt-3 type-meta text-fg-faint min-h-[1lh]">
                {authLoading ? (
                    <>&nbsp;</>
                ) : entry === null ? (
                    <>
                        <button type="button" onClick={signIn} className="text-link">Sign in</button>
                        {' '}to keep this game in your lists, score it and wish for it.
                    </>
                ) : (
                    <EntrySummary entry={entry} linkToYours={linkToYours} />
                )}
            </p>

            {entry !== null && <TrackingErrors entry={entry} listsFailed={listsError !== null} onReloadLists={reloadLists} />}
        </div>
    );
}

/** What else the reader has recorded, which lives on the Your game tab, and the way there. */
function EntrySummary({ entry, linkToYours }: { entry: GameEntryContextValue; linkToYours: boolean }) {
    // Nothing is said of the entry until it has been read: "no playthroughs yet" over a read still out, or
    // one that failed, would be untrue, and the failure says so itself under the row.
    const parts: string[] = [];
    if (entry.ready) {
        const runs = entry.playthroughs.length;
        if (runs > 0) parts.push(formatCountOf(runs, 'playthrough', 'playthroughs'));
        if (entry.review !== null) parts.push(entry.review.visibility === 'public' ? 'Reviewed, for anyone' : 'Reviewed, for you only');
        if (entry.notes !== null) parts.push('Notes');
        if (parts.length === 0) parts.push('No playthroughs or review yet');
    }

    return (
        <>
            {parts.length > 0 ? parts.join(' · ') : <>&nbsp;</>}
            {linkToYours && (
                <>
                    {parts.length > 0 && ' · '}
                    <Link to={`/games/${entry.game.id}/yours`} className="text-link">Your game</Link>
                </>
            )}
        </>
    );
}

/** The row's refusals, each where the reader is looking, in the colour an error's words take. */
function TrackingErrors({ entry, listsFailed, onReloadLists }: {
    entry: GameEntryContextValue;
    listsFailed: boolean;
    onReloadLists: () => void;
}) {
    const messages = [entry.listError, entry.scoreError, entry.wishlistError, entry.favouriteError]
        .filter((message): message is string => message !== null);

    return (
        <>
            {messages.map(message => <Alert key={message}>{message}</Alert>)}
            {/* The list picker waits for the lists, since a game in one reads as in none until they come
                (`addToList`); after a read that failed it would wait for ever without saying why. */}
            {listsFailed && (
                <Alert onRetry={onReloadLists}>
                    Your lists could not be loaded, so this game cannot be moved between them just now.
                </Alert>
            )}
            {/* Unlike the wishlist, favourites have no page of their own to report a failed load and
                offer a retry, so the one control that is stuck says why. */}
            {entry.favouritesFailed && (
                <Alert onRetry={entry.reloadFavourites}>
                    Your favourites could not be loaded, so this cannot be changed just now.
                </Alert>
            )}
            {/* Not instead of the controls: shown empty, the score would invite a save over a score that
                only failed to arrive. */}
            {entry.entryStatus === 'failed' && (
                <Alert onRetry={entry.retryEntry}>
                    Your score, ownership, tags, notes, playthroughs and review for this game could not be
                    loaded, so they cannot be changed just now.
                </Alert>
            )}
        </>
    );
}

/** One of them, with a way to ask again where asking again could help. */
function Alert({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
    return (
        <p className="mt-2 text-sm text-danger-300" role="alert">
            {children}
            {onRetry && (
                <>
                    {' '}
                    <button type="button" onClick={onRetry} className="text-link">Try again</button>
                </>
            )}
        </p>
    );
}

interface SquareToggleProps {
    /** The icon, drawn filled once pressed. */
    children: ReactNode;
    pressed: boolean;
    label: string;
    disabled: boolean;
    onPress: () => void;
    pressedClass: string;
    hoverClass: string;
    describedBy?: string;
}

/** The heart and the rosette: square, the list button's height, filled in their own colour once pressed. */
function SquareToggle({ children, pressed, label, disabled, onPress, pressedClass, hoverClass, describedBy }: SquareToggleProps) {
    return (
        <button
            type="button"
            onClick={onPress}
            disabled={disabled}
            aria-pressed={pressed}
            aria-label={label}
            aria-describedby={describedBy}
            title={label}
            className={`flex h-10 w-10 items-center justify-center rounded-sm border transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-60 ${
                pressed ? pressedClass : `border-line-strong bg-sunken/60 text-fg-soft hover:text-fg-strong ${hoverClass}`
            }`}
        >
            {children}
        </button>
    );
}
