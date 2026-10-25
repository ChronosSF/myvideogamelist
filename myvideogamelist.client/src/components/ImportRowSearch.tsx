import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { ImportCandidateButton } from '@/components/ImportCandidateButton';
import {
    type GameSearch,
    MAX_SEARCH_LENGTH,
    MIN_SEARCH_LENGTH,
    SEARCH_PAGE_SIZE,
    type SearchAnswer,
    useGameSearch,
} from '@/hooks/useGameSearch';
import { formatCount } from '@/lib/format';
import type { GameDto } from '@/types/game';

/** One array for "nothing listed", so a render that lists nothing does not look like a new list. */
const NO_GAMES: GameDto[] = [];

interface ImportRowSearchProps {
    /** The row's title as its file spelled it: what the field starts with, and what the button names. */
    title: string;
    /** Said before the button, for a row that already offers games — "None of these?". */
    prompt?: string;
    /** Whether this row's search is the open one. The review keeps one open at a time. */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A game was chosen. The caller writes the decision, as it does for an offered candidate. */
    onChoose: (game: GameDto) => void;
}

/**
 * What the search says about where it is, read out as it changes and shown under the field.
 *
 * Only answers and failures. Nothing while it waits, or every pause in the typing would be read out
 * as "searching", and nothing about a term too short to ask, which the first keystroke over the
 * selected title always is. A full page is said as the first of more, because "20 games found"
 * would name the page's size as the search's, and the way to a game past it is more of its title.
 */
function announcement(search: GameSearch): string {
    switch (search.status) {
        case 'idle':
        case 'waiting':
            return '';
        case 'failed':
            // A 503's sentence asks for a moment and no retry is offered until the wait is over, so
            // the end of the wait is said too — the Try again that appears is otherwise silent.
            return search.busy && search.canRetry ? `${search.message} You can try again now.` : search.message;
        case 'answered': {
            const { games, hasMore } = search.answer;
            const term = `“${search.term}”`;
            // IGDB's search is not fuzzy (ADR 0040) — "Resedent Evil" finds nothing at all — and it
            // matches whole words, so a title with words IGDB's does not have finds nothing either:
            // "Portal 2 Game of the Year Edition" is ADR 0040's own example.
            if (games.length === 0) {
                return `No games found for ${term}. IGDB matches whole words and does not correct spelling, so check the spelling, or try fewer words.`;
            }
            if (hasMore) return `The first ${formatCount(games.length)} games for ${term}. Not among them? More of the title narrows the search.`;
            return `${formatCount(games.length)} ${games.length === 1 ? 'game' : 'games'} found for ${term}.`;
        }
    }
}

/**
 * Searching IGDB from a row nobody could place, and choosing its game there (§M4, issue 158).
 *
 * A row the matcher found nothing for, or offered only wrong games for, used to be resolved by
 * leaving the page to find an id. Here a plain action opens a field holding the row's title as the
 * file spelled it — which is what somebody corrects — and the results are the same buttons an
 * offered candidate is, so choosing one is the same act with the same words. Closed, the row stays
 * one line taller than it was.
 *
 * Results are IGDB's own order, unfiltered (ADR 0032): a search ranks nothing itself, and the
 * matcher's floors exist to keep a guess from being made on somebody's behalf, where here the
 * person is choosing. And a whole page of them, where the navbar's search lists six: the person is
 * choosing a game rather than glancing at suggestions, and IGDB's own order can put the game they
 * mean thirteenth (ADR 0040).
 */
export function ImportRowSearch({ title, prompt, open, onOpenChange, onChoose }: ImportRowSearchProps) {
    const [query, setQuery] = useState(() => title.trim().slice(0, MAX_SEARCH_LENGTH));
    const search = useGameSearch(query, open, { size: SEARCH_PAGE_SIZE });

    // The answer on screen. Kept while the next term waits for its own, so the results do not blank
    // out at every pause, and dropped once there is nothing to ask about or the asking failed, so a
    // new word — or a retry — does not open on an old word's games.
    const [shown, setShown] = useState<SearchAnswer | null>(null);
    if (search.status === 'answered' && shown !== search.answer) setShown(search.answer);
    if ((search.status === 'idle' || search.status === 'failed') && shown !== null) setShown(null);

    const games = shown?.games ?? NO_GAMES;
    const waiting = search.status === 'waiting';

    const id = useId();
    const panelId = `${id}-search`;
    const toggleRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    /**
     * Committed first, because the field is not there until it is, and focused within the press
     * itself, which is the only way a phone raises its keyboard for it. Selected, so typing a new
     * title replaces the file's and an arrow key keeps it to correct.
     */
    const openSearch = () => {
        flushSync(() => onOpenChange(true));
        inputRef.current?.focus();
        inputRef.current?.select();
    };

    /** Closed from inside, so focus goes back to the button that opened it rather than to the page. */
    const close = () => {
        toggleRef.current?.focus();
        onOpenChange(false);
    };

    // On the panel, so it works from a result or the retry as well as from the field. Prevented,
    // or a search field's own Escape would empty it as well.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        close();
    };

    return (
        <div className="mt-2">
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                {/* The space is for anything that reads the line as text; the gap lays it out. */}
                {prompt && <><span>{prompt}</span>{' '}</>}
                <button
                    ref={toggleRef}
                    type="button"
                    aria-label={`Search IGDB for ${title}`}
                    aria-expanded={open}
                    aria-controls={open ? panelId : undefined}
                    onClick={() => (open ? onOpenChange(false) : openSearch())}
                    className="font-semibold text-primary-400 hover:text-primary-300"
                >
                    Search IGDB
                </button>
            </p>

            {open && (
                <div
                    id={panelId}
                    className="mt-2 p-3 space-y-2 bg-page/60 border border-line rounded-lg"
                    onKeyDown={onKeyDown}
                >
                    <div className="flex items-center gap-2">
                        {/* Sixteen pixels below sm, or iOS zooms the page in on every open. The
                            outline is hidden rather than removed, so a forced-colours theme still
                            draws one where the ring cannot be (issue 287). */}
                        <input
                            ref={inputRef}
                            type="search"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            aria-label="Search IGDB"
                            placeholder="The game's title"
                            maxLength={MAX_SEARCH_LENGTH}
                            autoComplete="off"
                            spellCheck={false}
                            className="grow min-w-0 px-2 py-1.5 bg-page border border-line-strong rounded text-base sm:text-sm text-fg placeholder-fg-muted focus:outline-hidden focus:ring-2 focus:ring-focus focus:border-transparent"
                        />
                        <button
                            type="button"
                            onClick={close}
                            className="px-2 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg"
                        >
                            Close
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {/* Before the live region, which is empty while waiting and would otherwise
                            push this along by a gap. */}
                        {waiting && <p className="text-fg-muted">Searching…</p>}
                        {search.status === 'idle' && (
                            <p className="text-fg-muted">Type at least {MIN_SEARCH_LENGTH} letters to search.</p>
                        )}
                        <p role="status" className={search.status === 'failed' ? 'text-danger-300' : 'text-fg-muted'}>
                            {announcement(search)}
                        </p>
                        {search.status === 'failed' && search.canRetry && (
                            <button
                                type="button"
                                onClick={() => {
                                    // The field first: this button goes the moment the retry starts,
                                    // and focus left on it would fall to the page.
                                    inputRef.current?.focus();
                                    search.retry();
                                }}
                                className="font-semibold text-primary-400 hover:text-primary-300"
                            >
                                Try again
                            </button>
                        )}
                    </div>

                    {/* Inert while the next term waits: still drawn, so the panel does not jump at
                        every pause, but not pressable and not read out. A press here writes a game
                        into somebody's import, so it may only ever land on the answer to what is in
                        the field — and an answer from IGDB can take seconds, long enough to press a
                        game the field has already moved on from. The press itself is refused too,
                        for a browser that does not know `inert`. */}
                    {games.length > 0 && (
                        <ul
                            aria-label="IGDB results"
                            inert={waiting}
                            className={`flex flex-wrap gap-2 transition-opacity ${waiting ? 'opacity-50' : ''}`}
                        >
                            {games.map(game => (
                                <li key={game.id}>
                                    <ImportCandidateButton
                                        game={game}
                                        onChoose={() => {
                                            if (!waiting) onChoose(game);
                                        }}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
