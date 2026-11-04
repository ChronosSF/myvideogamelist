import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { GameDto } from '@/types/game';
import { useAuthDialog } from '@/hooks/useAuthDialog';
import { useGameEntry } from '@/hooks/useGameEntry';
import { useLists } from '@/hooks/useLists';
import { ListPicker } from '@/components/ListPicker';
import { ScoreInput } from '@/components/ScoreInput';

const HEART = 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z';
const ROSETTE = 'M12 15a6 6 0 100-12 6 6 0 000 12zM8.2 13.7L7 21l5-3 5 3-1.2-7.3';

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
    const { nameFor } = useLists();
    const favouriteHintId = useId();

    const signIn = () => authDialog.open('login');
    const signedOut = entry === null && !authLoading;

    // Bumped by a star pressed signed out, which remounts the stars: the browser checks the radio pressed,
    // and with no score to give, nothing else would take that back — a screen reader would hear one.
    const [starPrompts, setStarPrompts] = useState(0);

    return (
        <div className="mt-5">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
                <ListPicker
                    current={entry?.currentList ?? null}
                    nameFor={nameFor}
                    disabled={entry === null || entry.pending}
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
                        path={HEART}
                        pressed={entry?.wishlisted ?? false}
                        label={entry?.wishlisted ? 'On your wishlist' : 'Add to wishlist'}
                        disabled={authLoading || (entry !== null && entry.wishlistPending)}
                        onPress={() => (entry === null ? signIn() : void entry.toggleWishlist())}
                        pressedClass="bg-wishlist-700 border-wishlist-700 text-fg-strong"
                        hoverClass="hover:border-wishlist-600"
                    />
                    {/* A third axis, beside the wishlist rather than folded into it: loving a game is not
                        wanting one, and a game can be both. A rosette, never a star — stars are the score
                        beside it and nothing else (ADR 0021). */}
                    <SquareToggle
                        path={ROSETTE}
                        pressed={entry?.favourite ?? false}
                        label={entry?.favourite ? 'One of your favourites' : 'Add to favourites'}
                        disabled={authLoading || (entry !== null && (entry.favouritePending || entry.favouritesFailed))}
                        onPress={() => (entry === null ? signIn() : void entry.toggleFavourite())}
                        pressedClass="bg-favourite-700 border-favourite-700 text-fg-strong"
                        hoverClass="hover:border-favourite-500"
                        describedBy={entry !== null ? favouriteHintId : undefined}
                    />
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
                    <EntrySummary linkToYours={linkToYours} gameId={game.id} />
                )}
            </p>

            {entry !== null && <TrackingErrors />}
        </div>
    );
}

/** What else the reader has recorded, which lives on the Your game tab, and the way there. */
function EntrySummary({ linkToYours, gameId }: { linkToYours: boolean; gameId: number }) {
    const entry = useGameEntry();
    if (entry === null) return null;

    // Nothing is said of the entry until it has been read: "no playthroughs yet" over a read still out, or
    // one that failed, would be untrue, and the failure says so itself under the row.
    const parts: string[] = [];
    if (entry.ready) {
        const runs = entry.playthroughs.length;
        if (runs > 0) parts.push(`${runs} playthrough${runs === 1 ? '' : 's'}`);
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
                    <Link to={`/games/${gameId}/yours`} className="text-link">Your game</Link>
                </>
            )}
        </>
    );
}

/** The row's refusals, each where the reader is looking, in the colour an error's words take. */
function TrackingErrors() {
    const entry = useGameEntry();
    if (entry === null) return null;

    const messages = [entry.listError, entry.scoreError, entry.wishlistError, entry.favouriteError]
        .filter((message): message is string => message !== null);

    return (
        <>
            {messages.map(message => (
                <p key={message} className="mt-2 text-sm text-danger-300" role="alert">{message}</p>
            ))}
            {/* Unlike the wishlist, favourites have no page of their own to report a failed load and
                offer a retry, so the one control that is stuck says why. */}
            {entry.favouritesFailed && (
                <p className="mt-2 text-sm text-danger-300" role="alert">
                    Your favourites could not be loaded, so this cannot be changed just now.{' '}
                    <button type="button" onClick={entry.reloadFavourites} className="text-link">Try again</button>
                </p>
            )}
            {/* Not instead of the controls: shown empty, the score would invite a save over a score that
                only failed to arrive. */}
            {entry.entryStatus === 'failed' && (
                <p className="mt-2 text-sm text-danger-300" role="alert">
                    Your score, ownership, tags, notes, playthroughs and review for this game could not be
                    loaded, so they cannot be changed just now.{' '}
                    <button type="button" onClick={entry.retryEntry} className="text-link">Try again</button>
                </p>
            )}
        </>
    );
}

interface SquareToggleProps {
    path: string;
    pressed: boolean;
    label: string;
    disabled: boolean;
    onPress: () => void;
    pressedClass: string;
    hoverClass: string;
    describedBy?: string;
}

/** The heart and the rosette: square, the list button's height, filled in their own colour once pressed. */
function SquareToggle({ path, pressed, label, disabled, onPress, pressedClass, hoverClass, describedBy }: SquareToggleProps) {
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
            <svg className="w-[18px] h-[18px]" fill={pressed ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
            </svg>
        </button>
    );
}
