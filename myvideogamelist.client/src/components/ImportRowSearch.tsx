import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { ImportCandidateButton } from '@/components/ImportCandidateButton';
import {
    MAX_SEARCH_LENGTH,
    MIN_SEARCH_LENGTH,
    type ImportSearch,
    type SearchAnswer,
    useImportSearch,
} from '@/hooks/useImportSearch';
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
 * What the search says about where it is: read out as it changes, and shown under the field.
 *
 * Nothing while it waits, or every pause in the typing would be read out as "searching". A full
 * page is said as the first of more, because "20 games found" would name the page's size as the
 * search's, and the way to a game past it is more of its title rather than another page.
 */
function announcement(search: ImportSearch): string {
    switch (search.status) {
        case 'idle':
            return `Type at least ${MIN_SEARCH_LENGTH} letters to search.`;
        case 'waiting':
            return '';
        case 'failed':
            return search.message;
        case 'answered': {
            const { games, hasMore } = search.answer;
            const term = `“${search.term}”`;
            // IGDB's search is not fuzzy (ADR 0040): "Resedent Evil" finds nothing at all, and a
            // misspelt title is exactly what leaves a row unmatched.
            if (games.length === 0) return `No games found for ${term}. IGDB does not correct spelling, so check the title.`;
            if (hasMore) return `The first ${formatCount(games.length)} games for ${term}. Not among them? More of the title narrows the search.`;
            return `${formatCount(games.length)} ${games.length === 1 ? 'game' : 'games'} found for ${term}.`;
        }
    }
}

/**
 * Searching IGDB from a row nobody could place, and choosing its game there (§M4).
 *
 * A row the matcher found nothing for, or offered only wrong games for, used to be resolved by
 * leaving the page to find an id. Here a plain action opens a field holding the row's own title —
 * the spelling IGDB was first asked with, which is what somebody corrects — and the results are
 * the same buttons an offered candidate is, so choosing one is the same act with the same words.
 * Closed, the row stays one line taller than it was.
 *
 * Results are IGDB's own order, unfiltered (ADR 0032): a search ranks nothing itself, and the
 * matcher's floors exist to keep a guess from being made on somebody's behalf, where here the
 * person is choosing.
 */
export function ImportRowSearch({ title, prompt, open, onOpenChange, onChoose }: ImportRowSearchProps) {
    const [query, setQuery] = useState(() => title.trim().slice(0, MAX_SEARCH_LENGTH));
    const search = useImportSearch(query, open);

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
                            enterKeyHint="search"
                            className="grow min-w-0 px-2 py-1.5 bg-page border border-line-strong rounded text-sm text-fg placeholder-fg-faint focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent"
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
                        <p role="status" className={search.status === 'failed' ? 'text-danger-300' : 'text-fg-muted'}>
                            {announcement(search)}
                        </p>
                        {waiting && <p className="text-fg-faint">Searching…</p>}
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
                        game the field has already moved on from. */}
                    {games.length > 0 && (
                        <ul
                            aria-label="IGDB results"
                            inert={waiting}
                            className={`flex flex-wrap gap-2 transition-opacity ${waiting ? 'opacity-50' : ''}`}
                        >
                            {games.map(game => (
                                <li key={game.id}>
                                    <ImportCandidateButton game={game} onChoose={() => onChoose(game)} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
